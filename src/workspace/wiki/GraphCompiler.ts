import {
  type GraphCanvasDTO,
  type GraphCanvasNodeDTO,
  type GraphCanvasRelationshipDTO,
  type NodeLayout,
  generateCanonicalNodeId
} from '@workspace/persistence/graphCanvasDto'
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SEP,
  DEFAULT_RANK_SEP,
  DEFAULT_WIKI_GRID_OFFSET
} from '@shared/constants'
import type { LedgerCommand } from '@shared/commands/types'
import { RelationalLedgerStore } from './RelationalLedgerStore'
import { type WikiWorkspaceAdapter, MemoryWikiWorkspaceAdapter } from './adapter'
import { createFsWikiWorkspaceAdapter, normalizeEntityTitle } from './L1StructuralLinter'

export interface GraphCompileOptions {
  ledgerStore: RelationalLedgerStore
  layoutSnapshot?: GraphCanvasDTO | null
  documents?: Array<{ name: string; instanceId?: string }>
}

/**
 * Finds or generates a nodeId corresponding to an entity name in the graph canvas.
 */
function resolveNodeIdForEntity(
  entityName: string,
  nodes: Record<string, GraphCanvasNodeDTO>,
  nameToIdMap: Map<string, string>
): string {
  const normalized = normalizeEntityTitle(entityName)
  const existingId = nameToIdMap.get(normalized)
  if (existingId) {
    return existingId
  }

  // Check if entityName directly matches a nodeId
  if (nodes[entityName]) {
    nameToIdMap.set(normalized, entityName)
    return entityName
  }

  // Generate a new canonical ID
  const newId = generateCanonicalNodeId()
  nameToIdMap.set(normalized, newId)
  return newId
}

/**
 * Calculates a non-colliding layout position for newly provisioned nodes.
 */
function allocateNextLayoutPosition(
  existingLayouts: Record<string, NodeLayout>,
  provisionIndex: number
): NodeLayout {
  let maxX = 0
  let maxY = 0

  for (const layout of Object.values(existingLayouts)) {
    const right = layout.x + layout.width
    const bottom = layout.y + layout.height
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  }

  const startX = maxX === 0 ? DEFAULT_WIKI_GRID_OFFSET : maxX + DEFAULT_RANK_SEP
  const startY = DEFAULT_WIKI_GRID_OFFSET
  const verticalOffset = provisionIndex * (DEFAULT_NODE_HEIGHT + DEFAULT_NODE_SEP)

  return {
    x: startX,
    y: startY + verticalOffset,
    width: DEFAULT_NODE_WIDTH,
    height: DEFAULT_NODE_HEIGHT
  }
}

/**
 * Compiles topological ground truth from RelationalLedgerStore and layout snapshot into a GraphCanvasDTO.
 */
export function compileGraphProjection(options: GraphCompileOptions): GraphCanvasDTO {
  const { ledgerStore, layoutSnapshot, documents } = options

  const nodes: Record<string, GraphCanvasNodeDTO> = {}
  const relationships: Record<string, GraphCanvasRelationshipDTO> = {}
  const layoutByNodeId: Record<string, NodeLayout> = {}

  const nameToIdMap = new Map<string, string>()

  // 1. Ingest existing nodes & layout from snapshot if present
  if (layoutSnapshot?.graph?.nodes) {
    for (const [nodeId, node] of Object.entries(layoutSnapshot.graph.nodes)) {
      nodes[nodeId] = {
        id: node.id,
        type: node.type || 'card',
        name: node.name,
        attrs: node.attrs ? { ...node.attrs } : {}
      }
      nameToIdMap.set(normalizeEntityTitle(node.name), nodeId)
    }
  }

  if (layoutSnapshot?.layout?.layoutByNodeId) {
    for (const [nodeId, layout] of Object.entries(layoutSnapshot.layout.layoutByNodeId)) {
      layoutByNodeId[nodeId] = {
        x: layout.x,
        y: layout.y,
        width: layout.width > 0 ? layout.width : DEFAULT_NODE_WIDTH,
        height: layout.height > 0 ? layout.height : DEFAULT_NODE_HEIGHT
      }
    }
  }

  let newlyProvisionedCount = 0

  // Helper to ensure node exists in projection
  const ensureNode = (entityName: string): string => {
    const nodeId = resolveNodeIdForEntity(entityName, nodes, nameToIdMap)
    if (!nodes[nodeId]) {
      nodes[nodeId] = {
        id: nodeId,
        type: 'card',
        name: entityName,
        attrs: {}
      }
    }
    if (!layoutByNodeId[nodeId]) {
      layoutByNodeId[nodeId] = allocateNextLayoutPosition(layoutByNodeId, newlyProvisionedCount++)
    }
    return nodeId
  }

  // 2. Ingest all document items from workspace
  const hasDocumentList = documents !== undefined
  const knownDocumentNames = new Set<string>()
  if (documents) {
    for (const doc of documents) {
      knownDocumentNames.add(doc.name)
      knownDocumentNames.add(normalizeEntityTitle(doc.name))
      ensureNode(doc.name)
    }
  }

  const isEntityResolvable = (entityName: string): boolean => {
    if (!hasDocumentList) return true
    const normalized = normalizeEntityTitle(entityName)
    if (knownDocumentNames.has(entityName) || knownDocumentNames.has(normalized)) {
      return true
    }
    if (layoutSnapshot?.graph?.nodes) {
      for (const node of Object.values(layoutSnapshot.graph.nodes)) {
        if (node.name === entityName || normalizeEntityTitle(node.name) === normalized) {
          return true
        }
      }
    }
    return false
  }

  // 3. Project active ledger edges into canvas relationships
  const activeEdges = ledgerStore.getAllEdges().filter((e) => e.status !== 'archived')
  for (const edge of activeEdges) {
    // Flaw #5: Do not fabricate phantom canvas cards for unresolvable targets
    if (!isEntityResolvable(edge.sourceEntityId) || !isEntityResolvable(edge.targetEntityId)) {
      continue
    }

    const fromNodeId = ensureNode(edge.sourceEntityId)
    const toNodeId = ensureNode(edge.targetEntityId)

    relationships[edge.id] = {
      id: edge.id,
      from: { nodeId: fromNodeId },
      to: { nodeId: toNodeId },
      attrs: {
        rel: edge.rel,
        provenance: edge.provenance,
        status: edge.status,
        ...(edge.anchor?.blockId ? { anchorBlockId: edge.anchor.blockId } : {}),
        ...(edge.anchor?.justification ? { justification: edge.anchor.justification } : {}),
        label: edge.rel
      }
    }
  }

  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: {
      nodes,
      relationships
    },
    layout: {
      layoutByNodeId
    },
    meta: {
      createdAt: layoutSnapshot?.meta?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
}

/**
 * Incrementally applies a single ledger command to a projected canvas without re-scanning.
 */
export function compileIncrementalProjection(
  currentProjection: GraphCanvasDTO,
  command: LedgerCommand
): GraphCanvasDTO {
  const nextNodes: Record<string, GraphCanvasNodeDTO> = { ...currentProjection.graph.nodes }
  const nextRelationships: Record<string, GraphCanvasRelationshipDTO> = {
    ...currentProjection.graph.relationships
  }
  const nextLayout: Record<string, NodeLayout> = { ...currentProjection.layout.layoutByNodeId }

  const nameToIdMap = new Map<string, string>()
  for (const node of Object.values(nextNodes)) {
    nameToIdMap.set(normalizeEntityTitle(node.name), node.id)
  }

  let provisionCount = 0
  const ensureNode = (entityName: string): string => {
    const nodeId = resolveNodeIdForEntity(entityName, nextNodes, nameToIdMap)
    if (!nextNodes[nodeId]) {
      nextNodes[nodeId] = {
        id: nodeId,
        type: 'card',
        name: entityName,
        attrs: {}
      }
    }
    if (!nextLayout[nodeId]) {
      nextLayout[nodeId] = allocateNextLayoutPosition(nextLayout, provisionCount++)
    }
    return nodeId
  }

  switch (command.type) {
    case 'ledger:upsert_edge': {
      const entry = command.entry
      if (entry.status === 'archived') {
        delete nextRelationships[entry.id]
      } else {
        const fromNodeId = ensureNode(entry.sourceEntityId)
        const toNodeId = ensureNode(entry.targetEntityId)

        nextRelationships[entry.id] = {
          id: entry.id,
          from: { nodeId: fromNodeId },
          to: { nodeId: toNodeId },
          attrs: {
            rel: entry.rel,
            provenance: entry.provenance,
            status: entry.status,
            ...(entry.anchor?.blockId ? { anchorBlockId: entry.anchor.blockId } : {}),
            ...(entry.anchor?.justification ? { justification: entry.anchor.justification } : {}),
            label: entry.rel
          }
        }
      }
      break
    }
    case 'ledger:remove_edge': {
      delete nextRelationships[command.edgeId]
      break
    }
    case 'ledger:degrade_edge': {
      const existing = nextRelationships[command.edgeId]
      if (existing) {
        nextRelationships[command.edgeId] = {
          ...existing,
          attrs: {
            ...(existing.attrs ?? {}),
            status: 'anchor_lost'
          }
        }
      }
      break
    }
    case 'ledger:restore_edge': {
      const existing = nextRelationships[command.edgeId]
      if (existing) {
        nextRelationships[command.edgeId] = {
          ...existing,
          attrs: {
            ...(existing.attrs ?? {}),
            status: 'active',
            anchorBlockId: command.anchor.blockId,
            justification: command.anchor.justification
          }
        }
      }
      break
    }
  }

  return {
    ...currentProjection,
    graph: {
      nodes: nextNodes,
      relationships: nextRelationships
    },
    layout: {
      layoutByNodeId: nextLayout
    },
    meta: {
      ...currentProjection.meta,
      updatedAt: new Date().toISOString()
    }
  }
}

/**
 * High-level function to compile a workspace directory or adapter into a full GraphCanvasDTO.
 */
export async function compileWorkspace(
  workspace: string | WikiWorkspaceAdapter,
  existingCanvas?: GraphCanvasDTO | null,
  canvasName?: string
): Promise<GraphCanvasDTO> {
  const adapter =
    typeof workspace === 'string' ? await createFsWikiWorkspaceAdapter(workspace) : workspace

  const ledgerStore = adapter.getLedgerStore()
  let documents: Array<{ name: string; instanceId: string }> = []

  if (adapter.listDocuments) {
    documents = await adapter.listDocuments()
  } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
    documents = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
  }

  const layoutSnapshot =
    existingCanvas !== undefined
      ? existingCanvas
      : adapter.getCanvas
        ? await adapter.getCanvas(canvasName)
        : null

  return compileGraphProjection({
    ledgerStore,
    layoutSnapshot,
    documents
  })
}
