import {
  type L1Diagnostic,
  type L1AuditResult,
  type CompiledGraphProjection,
  type EntityType
} from '@shared/wiki/types'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import { RelationalLedgerStore } from './RelationalLedgerStore'
import './RelationalLedgerStorage'
import { detectSupersedenceCycle } from './TarjanCycleDetector'
import { type WikiWorkspaceAdapter, MemoryWikiWorkspaceAdapter } from './adapter'
import type { DocumentPayload } from '@workspace/persistence/editorContent'
import { type GraphCanvasDTO, GraphCanvasDTOSchema } from '@workspace/persistence/graphCanvasDto'
import {
  DEFAULT_WIKI_NODE_WIDTH,
  DEFAULT_WIKI_NODE_HEIGHT,
  DEFAULT_WIKI_GRID_COLUMNS,
  DEFAULT_WIKI_GRID_COL_WIDTH,
  DEFAULT_WIKI_GRID_ROW_HEIGHT
} from '@shared/constants'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Normalizes an entity title for collision detection and loose symbol resolution.
 */
export function normalizeEntityTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[-_\s]+/g, ' ')
}

const IGNORED_ROOT_DOC_FILES = new Set(['package.json', 'manifest.json', 'state.json'])

function isIgnoredDocumentFile(fileName: string): boolean {
  if (IGNORED_ROOT_DOC_FILES.has(fileName)) return true
  if (fileName.startsWith('tsconfig') && fileName.endsWith('.json')) return true
  if (fileName.startsWith('ledger')) return true
  return false
}

/**
 * Creates a file-system backed WikiWorkspaceAdapter for a given directory.
 */
export async function createFsWikiWorkspaceAdapter(
  workspaceDir: string
): Promise<WikiWorkspaceAdapter> {
  const ledgerStore = new RelationalLedgerStore()

  // Attempt to discover ledger JSON file in candidate locations
  const candidateLedgerPaths = [
    path.join(workspaceDir, '.collar', 'instances', 'ledger-default.json'),
    path.join(workspaceDir, 'instances', 'ledger-default.json'),
    path.join(workspaceDir, 'ledger-default.json'),
    path.join(workspaceDir, 'ledger.json')
  ]

  for (const candidate of candidateLedgerPaths) {
    try {
      const content = await fs.readFile(candidate, 'utf-8')
      const parsed = JSON.parse(content) as unknown
      if (Array.isArray(parsed)) {
        ledgerStore.loadFromSnapshot(parsed)
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        'edges' in parsed &&
        Array.isArray((parsed as { edges: unknown }).edges)
      ) {
        ledgerStore.loadFromSnapshot((parsed as { edges: unknown[] }).edges)
      }
      break
    } catch {
      // Continue to next candidate
    }
  }

  // Discover document instances: strictly restricted to instance subdirectories
  const candidateDocDirs = [
    path.join(workspaceDir, '.collar', 'instances'),
    path.join(workspaceDir, 'instances')
  ]

  // Fallback to workspaceDir only if manifest.json exists (verifying it is a workspace directory)
  try {
    const hasManifest = await fs
      .stat(path.join(workspaceDir, 'manifest.json'))
      .then((s) => s.isFile())
      .catch(() => false)
    if (hasManifest) {
      candidateDocDirs.push(workspaceDir)
    }
  } catch {
    // Ignore stat error
  }

  const docsMap = new Map<string, DocumentPayload>()
  const docList: Array<{ name: string; instanceId: string }> = []

  for (const dir of candidateDocDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || isIgnoredDocumentFile(entry.name)) {
          continue
        }
        try {
          const filePath = path.join(dir, entry.name)
          const content = await fs.readFile(filePath, 'utf-8')
          const parsed = JSON.parse(content) as unknown
          if (
            parsed &&
            typeof parsed === 'object' &&
            'blocks' in parsed &&
            Array.isArray((parsed as { blocks: unknown }).blocks)
          ) {
            const docName = entry.name.replace(/\.json$/, '')
            docsMap.set(docName, parsed as DocumentPayload)
            docList.push({ name: docName, instanceId: docName })
          }
        } catch {
          // Skip invalid JSON
        }
      }
      if (docList.length > 0) break
    } catch {
      // Directory doesn't exist, try next
    }
  }

  return {
    async getDocument(name: string): Promise<DocumentPayload | null> {
      return docsMap.get(name) ?? null
    },
    async saveDocument(name: string, payload: DocumentPayload): Promise<void> {
      docsMap.set(name, payload)
    },
    async listDocuments(): Promise<Array<{ name: string; instanceId: string }>> {
      return [...docList]
    },
    async getCanvas(name: string = 'concept-canvas'): Promise<GraphCanvasDTO | null> {
      for (const dir of candidateDocDirs) {
        try {
          const filePath = path.join(dir, `${name}.json`)
          const content = await fs.readFile(filePath, 'utf-8')
          const parsed = JSON.parse(content) as unknown
          const validated = GraphCanvasDTOSchema.safeParse(parsed)
          if (validated.success) return validated.data
        } catch {
          // Continue to next directory
        }
      }
      return null
    },
    async saveCanvas(name: string, payload: GraphCanvasDTO): Promise<string> {
      const targetDir = candidateDocDirs[0]
      await fs.mkdir(targetDir, { recursive: true })
      await fs.writeFile(
        path.join(targetDir, `${name}.json`),
        JSON.stringify(payload, null, 2),
        'utf-8'
      )
      return name
    },
    getLedgerStore(): RelationalLedgerStore {
      return ledgerStore
    },
    async flush(): Promise<void> {
      return Promise.resolve()
    }
  }
}

/**
 * Executes a deterministic L1 compiler audit against a wiki workspace adapter or directory.
 * Spec §7.4 & §7.6.
 */
export async function runL1Audit(
  workspace: WikiWorkspaceAdapter | string,
  options?: { signal?: AbortSignal; flushBeforeAudit?: boolean }
): Promise<L1AuditResult> {
  const adapter: WikiWorkspaceAdapter =
    typeof workspace === 'string' ? await createFsWikiWorkspaceAdapter(workspace) : workspace

  const shouldFlush =
    options?.flushBeforeAudit ??
    (typeof adapter.flush === 'function' && options?.flushBeforeAudit !== false)

  if (shouldFlush && typeof adapter.flush === 'function') {
    await adapter.flush(undefined, { signal: options?.signal })
  }

  if (typeof adapter.loadLedger === 'function') {
    await adapter.loadLedger({ signal: options?.signal, flushBeforeRead: true })
  }

  const ledgerStore = adapter.getLedgerStore()
  const errors: L1Diagnostic[] = []
  const warnings: L1Diagnostic[] = []

  // 1. Gather document instances
  let docItems: Array<{ name: string; instanceId: string }> = []
  if (adapter.listDocuments) {
    docItems = await adapter.listDocuments({ signal: options?.signal })
  } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
    docItems = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
  }

  // 2. Entity Collision Check (WORKSPACE_WIKI_ENTITY_COLLISION)
  const normalizedMap = new Map<string, string[]>()
  const knownEntityNames = new Set<string>()
  const knownNormalizedEntities = new Set<string>()

  // Register standard meta documents
  knownEntityNames.add('index.md')
  knownEntityNames.add('log.md')
  knownEntityNames.add('index')
  knownEntityNames.add('log')
  knownNormalizedEntities.add('index')
  knownNormalizedEntities.add('log')

  for (const item of docItems) {
    knownEntityNames.add(item.name)
    knownEntityNames.add(item.instanceId)
    const norm = normalizeEntityTitle(item.name)
    knownNormalizedEntities.add(norm)

    const existing = normalizedMap.get(norm)
    if (existing) {
      existing.push(item.name)
    } else {
      normalizedMap.set(norm, [item.name])
    }
  }

  for (const [norm, names] of normalizedMap.entries()) {
    if (names.length > 1) {
      errors.push({
        code: WorkspaceErrorCode.WORKSPACE_WIKI_ENTITY_COLLISION,
        severity: 'error',
        message: `Entity collision detected: titles [${names.join(', ')}] resolve to identical normalized title "${norm}".`,
        entityId: names[0]
      })
    }
  }

  // 3. Circular Supersedence Check (WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE)
  const allEdges = ledgerStore.getAllEdges()
  const cycleResult = detectSupersedenceCycle(allEdges)
  if (cycleResult.hasCycle) {
    errors.push({
      code: WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE,
      severity: 'error',
      message: `Circular supersedence cycle detected: ${cycleResult.cycleEntities.join(' -> ')} (edges: ${cycleResult.cycleEdgeIds.join(', ')}).`,
      entityId: cycleResult.cycleEntities[0]
    })
  }

  // 4. Edge Validation & Unresolved Symbols & Anchors
  for (const edge of allEdges) {
    // Check source entity existence
    const sourceExists =
      knownEntityNames.has(edge.sourceEntityId) ||
      knownNormalizedEntities.has(normalizeEntityTitle(edge.sourceEntityId))

    // Check target entity existence
    const targetExists =
      knownEntityNames.has(edge.targetEntityId) ||
      knownNormalizedEntities.has(normalizeEntityTitle(edge.targetEntityId))

    // Degraded edge: emit a warning with actionable pruneLedger remediation instead of fatal compile error
    if (edge.status === 'anchor_lost') {
      const missingEntity = !sourceExists
        ? edge.sourceEntityId
        : !targetExists
          ? edge.targetEntityId
          : undefined

      const missingDetail = missingEntity
        ? ` (entity "${missingEntity}" not found in workspace)`
        : ''

      warnings.push({
        code: WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND,
        severity: 'warning',
        message: `Claim edge "${edge.id}" (${edge.sourceEntityId} -> ${edge.rel} -> ${edge.targetEntityId}) is degraded with status: 'anchor_lost'${missingDetail}. Use pruneLedger tool (e.g. pruneLedger({ edgeId: "${edge.id}" }) or pruneLedger({ pruneAllDegraded: true })) to clean up.`,
        entityId: edge.sourceEntityId,
        edgeId: edge.id
      })
      continue
    }

    if (!sourceExists) {
      errors.push({
        code: WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
        severity: 'error',
        message: `Unresolved symbol "${edge.sourceEntityId}": referenced as source of edge "${edge.id}" (${edge.rel} -> ${edge.targetEntityId}), but no corresponding document exists.`,
        entityId: edge.sourceEntityId,
        edgeId: edge.id
      })
    }

    if (!targetExists) {
      errors.push({
        code: WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
        severity: 'error',
        message: `Unresolved symbol "${edge.targetEntityId}": referenced as target of edge "${edge.id}" (${edge.sourceEntityId} -> ${edge.rel}), but no corresponding document exists.`,
        entityId: edge.targetEntityId,
        edgeId: edge.id
      })
    }

    // Anchor block verification for active document_claim edges
    if (edge.provenance === 'document_claim' && edge.status === 'active') {
      if (!edge.anchor?.blockId) {
        errors.push({
          code: WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND,
          severity: 'error',
          message: `Active claim edge "${edge.id}" missing anchor block metadata.`,
          entityId: edge.sourceEntityId,
          edgeId: edge.id
        })
      } else if (sourceExists) {
        const doc = await adapter.getDocument(edge.sourceEntityId)
        if (doc && 'blocks' in doc && Array.isArray(doc.blocks)) {
          const hasBlock = doc.blocks.some(
            (b: unknown) =>
              typeof b === 'object' &&
              b !== null &&
              'id' in b &&
              (b as { id: string }).id === edge.anchor?.blockId
          )
          if (!hasBlock) {
            errors.push({
              code: WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND,
              severity: 'error',
              message: `Anchor block "${edge.anchor.blockId}" for claim edge "${edge.id}" was not found in source document "${edge.sourceEntityId}".`,
              entityId: edge.sourceEntityId,
              edgeId: edge.id,
              anchorBlockId: edge.anchor.blockId
            })
          }
        }
      }
    }
  }

  // 5. Orphan and Unreferenced Sources Warnings
  for (const item of docItems) {
    const isMetaDoc =
      item.name === 'index.md' ||
      item.name === 'log.md' ||
      item.name === 'index' ||
      item.name === 'log'
    if (isMetaDoc) continue

    const isSource =
      item.name.startsWith('sources/') ||
      item.name.startsWith('source/') ||
      item.name.startsWith('sources-')

    if (isSource) {
      const outlinks = ledgerStore.getOutlinks(item.name)
      if (outlinks.length === 0) {
        warnings.push({
          code: WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
          severity: 'warning',
          message: `Unreferenced source "${item.name}": source document has no extracted claims or outbound edges.`,
          entityId: item.name
        })
      }
    } else {
      const backlinks = ledgerStore.getBacklinks(item.name)
      if (backlinks.length === 0) {
        warnings.push({
          code: WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
          severity: 'warning',
          message: `Orphan document "${item.name}": document has no inbound references (backlinks).`,
          entityId: item.name
        })
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    compiledAt: new Date().toISOString()
  }
}

/**
 * Compiles a snapshot projection of all entities and relationships.
 * Spec §7.6.
 */
export async function compileWorkspaceProjection(
  workspace: WikiWorkspaceAdapter | string
): Promise<CompiledGraphProjection> {
  const adapter: WikiWorkspaceAdapter =
    typeof workspace === 'string' ? await createFsWikiWorkspaceAdapter(workspace) : workspace

  const ledgerStore = adapter.getLedgerStore()
  let docItems: Array<{ name: string; instanceId: string }> = []
  if (adapter.listDocuments) {
    docItems = await adapter.listDocuments()
  } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
    docItems = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
  }

  const entities: Record<string, { id: string; title: string; type: EntityType }> = {}
  const nodes: CompiledGraphProjection['nodes'] = []
  const knownEntityNames = new Set<string>()

  let index = 0
  for (const doc of docItems) {
    const isSource =
      doc.name.startsWith('sources/') ||
      doc.name.startsWith('source/') ||
      doc.name.startsWith('sources-')
    const type: EntityType = isSource ? 'source' : 'concept'

    entities[doc.name] = {
      id: doc.instanceId,
      title: doc.name,
      type
    }
    knownEntityNames.add(doc.name)

    nodes.push({
      id: doc.instanceId,
      entity: doc.name,
      group: type,
      layout: {
        x: (index % DEFAULT_WIKI_GRID_COLUMNS) * DEFAULT_WIKI_GRID_COL_WIDTH,
        y: Math.floor(index / DEFAULT_WIKI_GRID_COLUMNS) * DEFAULT_WIKI_GRID_ROW_HEIGHT,
        width: DEFAULT_WIKI_NODE_WIDTH,
        height: DEFAULT_WIKI_NODE_HEIGHT
      },
      hasMemo: false
    })
    index++
  }

  const allEdges = ledgerStore.getAllEdges()
  const edges: CompiledGraphProjection['edges'] = []
  const unresolvedSymbols: CompiledGraphProjection['unresolvedSymbols'] = []

  for (const e of allEdges) {
    const targetKnown =
      knownEntityNames.has(e.targetEntityId) ||
      knownEntityNames.has(normalizeEntityTitle(e.targetEntityId))

    if (!targetKnown) {
      unresolvedSymbols.push({
        fromEntity: e.sourceEntityId,
        targetEntity: e.targetEntityId,
        edgeId: e.id
      })
    }

    edges.push({
      id: e.id,
      from: e.sourceEntityId,
      to: e.targetEntityId,
      rel: e.rel,
      label: e.anchor?.justification,
      provenance: e.provenance,
      anchorBlockId: e.anchor?.blockId,
      status: e.status === 'anchor_lost' ? 'anchor_lost' : 'active'
    })
  }

  return {
    workspaceId: 'default',
    entities,
    nodes,
    edges,
    unresolvedSymbols,
    compiledAt: new Date().toISOString()
  }
}
