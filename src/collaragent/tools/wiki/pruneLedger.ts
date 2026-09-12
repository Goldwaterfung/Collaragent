import { tool } from '@langchain/core/tools'
import {
  PruneLedgerInputSchema,
  type PruneLedgerInput,
  type PruneLedgerResult,
  type PrunedEdgeDetail
} from '@shared/wiki'
import {
  normalizeEntityTitle,
  createFsWikiWorkspaceAdapter
} from '@workspace/wiki/L1StructuralLinter'
import {
  type WikiWorkspaceAdapter,
  MemoryWikiWorkspaceAdapter,
  LiveWikiWorkspaceAdapter
} from './adapters'
import { type ToolConnectionContext, extractErrorInfo } from '../WorkspaceTools'

/**
 * Executes pruning of ledger edges (specific edge, all degraded edges, unresolvable edges, or matching query).
 */
export async function executePruneLedger(
  input: PruneLedgerInput,
  adapter: WikiWorkspaceAdapter
): Promise<PruneLedgerResult> {
  const ledgerStore = adapter.getLedgerStore()
  const candidateMap = new Map<string, PrunedEdgeDetail>()
  const allEdges = ledgerStore.getAllEdges()

  // 1. Specific edgeId or edgeIds
  const targetIds = new Set<string>()
  if (input.edgeId) targetIds.add(input.edgeId)
  if (input.edgeIds) {
    for (const id of input.edgeIds) {
      targetIds.add(id)
    }
  }

  for (const id of targetIds) {
    const edge = ledgerStore.getEdge(id)
    if (edge) {
      candidateMap.set(edge.id, {
        id: edge.id,
        sourceEntityId: edge.sourceEntityId,
        targetEntityId: edge.targetEntityId,
        rel: edge.rel,
        provenance: edge.provenance,
        status: edge.status,
        reason: 'explicit_id'
      })
    }
  }

  // 2. Incident entityId or entityIds (removes all connected edges for given entities)
  const targetEntities = new Set<string>()
  if (input.entityId) targetEntities.add(input.entityId)
  if (input.entityIds) {
    for (const name of input.entityIds) {
      targetEntities.add(name)
    }
  }

  if (targetEntities.size > 0) {
    for (const edge of allEdges) {
      if (candidateMap.has(edge.id)) continue
      if (targetEntities.has(edge.sourceEntityId) || targetEntities.has(edge.targetEntityId)) {
        candidateMap.set(edge.id, {
          id: edge.id,
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          rel: edge.rel,
          provenance: edge.provenance,
          status: edge.status,
          reason: 'incident_entity'
        })
      }
    }
  }

  // 3. pruneUnresolved: scan documents to find edges pointing to nonexistent documents
  if (input.pruneUnresolved) {
    let docItems: Array<{ name: string; instanceId?: string }> = []
    if (adapter.listDocuments) {
      docItems = await adapter.listDocuments()
    } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
      docItems = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
    }

    const known = new Set<string>()
    // Register standard meta documents
    known.add('index.md')
    known.add('log.md')
    known.add('index')
    known.add('log')

    for (const d of docItems) {
      known.add(d.name)
      if (d.instanceId) known.add(d.instanceId)
      known.add(normalizeEntityTitle(d.name))
    }

    for (const edge of allEdges) {
      if (candidateMap.has(edge.id)) continue
      const sourceExists =
        known.has(edge.sourceEntityId) || known.has(normalizeEntityTitle(edge.sourceEntityId))
      const targetExists =
        known.has(edge.targetEntityId) || known.has(normalizeEntityTitle(edge.targetEntityId))

      if (!sourceExists || !targetExists) {
        candidateMap.set(edge.id, {
          id: edge.id,
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          rel: edge.rel,
          provenance: edge.provenance,
          status: edge.status,
          reason: !sourceExists ? 'unresolved_source' : 'unresolved_target'
        })
      }
    }
  }

  // 4. pruneAllDegraded: purge all edges with status: 'anchor_lost'
  if (input.pruneAllDegraded) {
    for (const edge of allEdges) {
      if (candidateMap.has(edge.id)) continue
      if (edge.status === 'anchor_lost') {
        candidateMap.set(edge.id, {
          id: edge.id,
          sourceEntityId: edge.sourceEntityId,
          targetEntityId: edge.targetEntityId,
          rel: edge.rel,
          provenance: edge.provenance,
          status: edge.status,
          reason: 'anchor_lost'
        })
      }
    }
  }

  // 5. Query-based pruning (sourceEntityId, targetEntityId, rel, provenance)
  if (input.sourceEntityId || input.targetEntityId || input.rel || input.provenance) {
    for (const edge of allEdges) {
      if (candidateMap.has(edge.id)) continue
      if (input.sourceEntityId && edge.sourceEntityId !== input.sourceEntityId) continue
      if (input.targetEntityId && edge.targetEntityId !== input.targetEntityId) continue
      if (input.rel && edge.rel !== input.rel) continue
      if (input.provenance && edge.provenance !== input.provenance) continue

      candidateMap.set(edge.id, {
        id: edge.id,
        sourceEntityId: edge.sourceEntityId,
        targetEntityId: edge.targetEntityId,
        rel: edge.rel,
        provenance: edge.provenance,
        status: edge.status,
        reason: 'query_match'
      })
    }
  }

  const prunedEdges = Array.from(candidateMap.values())
  const prunedEdgeIds = prunedEdges.map((e) => e.id)
  const isDryRun = Boolean(input.dryRun)

  if (!isDryRun && prunedEdges.length > 0) {
    for (const item of prunedEdges) {
      ledgerStore.removeEdge(item.id)
    }
    if (adapter.saveLedger) {
      await adapter.saveLedger(ledgerStore)
    }
  }

  const remainingEdgesCount = isDryRun
    ? allEdges.length - prunedEdges.length
    : ledgerStore.getAllEdges().length

  const actionText = isDryRun
    ? `[Dry Run] Simulated pruning of ${prunedEdges.length} edge(s) from relational ledger.`
    : `Pruned ${prunedEdges.length} edge(s) from relational ledger.`

  const reportLines: string[] = [
    `# 🧹 Prune Ledger Report${isDryRun ? ' (DRY RUN SIMULATION)' : ''}`,
    '',
    `**Action**: ${actionText}`,
    `**Remaining Edges**: ${remainingEdgesCount}`,
    ''
  ]

  if (prunedEdges.length > 0) {
    reportLines.push('## Pruned Edges Breakdown:')
    for (const edge of prunedEdges) {
      reportLines.push(
        `- \`${edge.id}\`: \`${edge.sourceEntityId}\` -> \`${edge.rel}\` -> \`${edge.targetEntityId}\` (Reason: *${edge.reason}*, Provenance: *${edge.provenance}*, Status: *${edge.status}*)`
      )
    }
  } else {
    reportLines.push('No edges matched the pruning criteria.')
  }

  return {
    status: 'success',
    action: actionText,
    dryRun: isDryRun,
    edgesPruned: prunedEdges.length,
    prunedEdgeIds,
    prunedEdges,
    remainingEdgesCount,
    report: reportLines.join('\n')
  }
}

/**
 * LangChain tool wrapper for pruneLedger.
 */
export const pruneLedger = tool(
  async (input, config) => {
    const context = config.configurable as
      | (ToolConnectionContext & {
          adapter?: WikiWorkspaceAdapter
        })
      | undefined
    try {
      let adapter = context?.adapter
      if (!adapter) {
        if (input.workspacePath) {
          adapter = await createFsWikiWorkspaceAdapter(input.workspacePath)
        } else {
          adapter = new LiveWikiWorkspaceAdapter(context)
        }
      }
      if (adapter instanceof LiveWikiWorkspaceAdapter) {
        await adapter.loadLedger()
      }
      return await executePruneLedger(input, adapter)
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to prune ledger',
        dryRun: Boolean(input.dryRun),
        edgesPruned: 0,
        prunedEdgeIds: [],
        prunedEdges: [],
        remainingEdgesCount: 0,
        code,
        message,
        recommendFix,
        report: `# 🛑 Prune Ledger Error\n\n[${code}] ${message}\n\n${recommendFix ? `**Recommendation**: ${recommendFix}` : ''}`
      }
    }
  },
  {
    name: 'pruneLedger',
    description: `Removes invalid, degraded (anchor_lost), obsolete, or orphan edges from the workspace relational ledger. Supports dryRun simulation, specific edge UUIDs (edgeId, edgeIds), entity-level cascading deletion (entityId, entityIds), query filters (sourceEntityId, targetEntityId, rel, provenance), all degraded edges (pruneAllDegraded: true), or all edges referencing deleted/nonexistent documents (pruneUnresolved: true).`,
    schema: PruneLedgerInputSchema
  }
)
