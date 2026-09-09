import { tool } from '@langchain/core/tools'
import { PruneLedgerInputSchema, type PruneLedgerInput, type PruneLedgerResult } from '@shared/wiki'
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
  const prunedEdgeIds: string[] = []

  // 1. If edgeId specified, remove that edge
  if (input.edgeId) {
    const removed = ledgerStore.removeEdge(input.edgeId)
    if (removed) {
      prunedEdgeIds.push(removed.id)
    }
  }

  // 2. If pruneAllDegraded is true, purge all edges with status: 'anchor_lost'
  if (input.pruneAllDegraded) {
    const degraded = ledgerStore.pruneDegradedEdges()
    for (const edge of degraded) {
      if (!prunedEdgeIds.includes(edge.id)) {
        prunedEdgeIds.push(edge.id)
      }
    }
  }

  // 3. If pruneUnresolved is true, purge all edges whose source or target document does not exist
  if (input.pruneUnresolved) {
    let docItems: Array<{ name: string; instanceId?: string }> = []
    if (adapter.listDocuments) {
      docItems = await adapter.listDocuments()
    } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
      docItems = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
    }

    const known = new Set<string>()
    for (const d of docItems) {
      known.add(d.name)
      known.add(normalizeEntityTitle(d.name))
    }

    const unresolved = ledgerStore.pruneUnresolvedEdges(known)
    for (const edge of unresolved) {
      if (!prunedEdgeIds.includes(edge.id)) {
        prunedEdgeIds.push(edge.id)
      }
    }
  }

  // 4. Query-based pruning (sourceEntityId, targetEntityId, rel) if no edgeId or bulk flags
  if (
    !input.edgeId &&
    !input.pruneAllDegraded &&
    !input.pruneUnresolved &&
    (input.sourceEntityId || input.targetEntityId || input.rel)
  ) {
    const matched = ledgerStore.removeEdgesByQuery({
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      rel: input.rel
    })
    for (const edge of matched) {
      if (!prunedEdgeIds.includes(edge.id)) {
        prunedEdgeIds.push(edge.id)
      }
    }
  }

  // 5. Persist updated ledger if adapter supports saveLedger
  if (prunedEdgeIds.length > 0 && adapter.saveLedger) {
    await adapter.saveLedger(ledgerStore)
  }

  const remainingEdgesCount = ledgerStore.getAllEdges().length
  const reportLines: string[] = [
    '# 🧹 Prune Ledger Report',
    '',
    `**Action**: Pruned ${prunedEdgeIds.length} edge(s) from relational ledger.`,
    `**Remaining Edges**: ${remainingEdgesCount}`,
    ''
  ]

  if (prunedEdgeIds.length > 0) {
    reportLines.push('## Pruned Edge IDs:')
    for (const id of prunedEdgeIds) {
      reportLines.push(`- \`${id}\``)
    }
  } else {
    reportLines.push('No edges matched the pruning criteria.')
  }

  return {
    status: 'success',
    action: `Pruned ${prunedEdgeIds.length} edge(s) from relational ledger.`,
    edgesPruned: prunedEdgeIds.length,
    prunedEdgeIds,
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
      return await executePruneLedger(input, adapter)
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to prune ledger',
        edgesPruned: 0,
        prunedEdgeIds: [],
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
    description: `Removes invalid, degraded (anchor_lost), or obsolete edges from the workspace relational ledger. Can prune by specific edgeId, sourceEntityId/targetEntityId/rel query, all degraded edges (pruneAllDegraded: true), or all edges pointing to nonexistent documents (pruneUnresolved: true).`,
    schema: PruneLedgerInputSchema
  }
)
