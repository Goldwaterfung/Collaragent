import { connectToCanvas } from '@workspace/sync/ClientConnection'
import { CanvasDiffEngine } from '@collaragent/runtime'
import { createGraphPayload, generateNodeId, generateRelationshipId } from './createGraphPayload'
import {
  assertUniqueNodeEntities,
  type NodeSpec,
  type EdgeSpec,
  type DeleteEdgeSpec,
  type WriteGraphSpec,
  WriteGraphSpecSchema
} from './graphSchemaConverter'
import { isCanonicalNodeId } from '@workspace/persistence/graphCanvasDto'
import type { CanvasSnapshot } from '@workspace/canvas/domain/types'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

// ─────────────────────────────────────────────────────────────────────────────
// 1. readGraph
// ─────────────────────────────────────────────────────────────────────────────

export type ReadGraphOptions = {
  instanceId: string
  wsPort?: number
  includeMemo?: boolean
}

export interface ReadGraphNode {
  nodeId: string
  entity: string
  hasMemo: boolean
  group?: string
  memo?: string
}

export interface ReadGraphGroupSummary {
  name: string
  nodeCount: number
  entities: string[]
}

export interface ReadGraphEdge {
  from: string
  to: string
  label?: string
}

export interface ReadGraphResult {
  nodes: ReadGraphNode[]
  edges: ReadGraphEdge[]
  groups?: ReadGraphGroupSummary[]
  instanceId: string
  clientId: string
}

export type RawGraphNode = {
  id: string
  name?: string
  attrs?: Record<string, unknown>
}

export type RawGraphRelationship = {
  id: string
  from: { nodeId: string; portId?: string }
  to: { nodeId: string; portId?: string }
  attrs?: Record<string, unknown>
}

/**
 * Extracts raw node and relationship records from either wire DTO or domain graph snapshots.
 */
export function extractGraphRecords(snapshot: unknown): {
  nodes: RawGraphNode[]
  relationships: RawGraphRelationship[]
} {
  if (!snapshot || typeof snapshot !== 'object') {
    return { nodes: [], relationships: [] }
  }

  const snapRecord = snapshot as Record<string, unknown>
  const graph = snapRecord.graph
  if (!graph || typeof graph !== 'object') {
    return { nodes: [], relationships: [] }
  }

  const graphRecord = graph as Record<string, unknown>

  // Handle both domain graph (nodesById, relationshipsById) and wire DTO (nodes, relationships)
  const rawNodesObj =
    typeof graphRecord.nodesById === 'object' && graphRecord.nodesById !== null
      ? (graphRecord.nodesById as Record<string, unknown>)
      : typeof graphRecord.nodes === 'object' && graphRecord.nodes !== null
        ? (graphRecord.nodes as Record<string, unknown>)
        : {}

  const rawRelsObj =
    typeof graphRecord.relationshipsById === 'object' && graphRecord.relationshipsById !== null
      ? (graphRecord.relationshipsById as Record<string, unknown>)
      : typeof graphRecord.relationships === 'object' && graphRecord.relationships !== null
        ? (graphRecord.relationships as Record<string, unknown>)
        : {}

  const nodes: RawGraphNode[] = []
  for (const nodeVal of Object.values(rawNodesObj)) {
    if (!nodeVal || typeof nodeVal !== 'object') continue
    const n = nodeVal as Record<string, unknown>
    if (typeof n.id === 'string' || typeof n.id === 'number') {
      nodes.push({
        id: String(n.id),
        name: typeof n.name === 'string' ? n.name : undefined,
        attrs:
          typeof n.attrs === 'object' && n.attrs !== null
            ? (n.attrs as Record<string, unknown>)
            : undefined
      })
    }
  }

  const relationships: RawGraphRelationship[] = []
  for (const relVal of Object.values(rawRelsObj)) {
    if (!relVal || typeof relVal !== 'object') continue
    const r = relVal as Record<string, unknown>
    if (
      (typeof r.id === 'string' || typeof r.id === 'number') &&
      typeof r.from === 'object' &&
      r.from !== null &&
      typeof r.to === 'object' &&
      r.to !== null
    ) {
      const fromObj = r.from as Record<string, unknown>
      const toObj = r.to as Record<string, unknown>
      if (typeof fromObj.nodeId === 'string' && typeof toObj.nodeId === 'string') {
        relationships.push({
          id: String(r.id),
          from: {
            nodeId: fromObj.nodeId,
            portId: typeof fromObj.portId === 'string' ? fromObj.portId : undefined
          },
          to: {
            nodeId: toObj.nodeId,
            portId: typeof toObj.portId === 'string' ? toObj.portId : undefined
          },
          attrs:
            typeof r.attrs === 'object' && r.attrs !== null
              ? (r.attrs as Record<string, unknown>)
              : undefined
        })
      }
    }
  }

  return { nodes, relationships }
}

/**
 * Parses snapshot data into structured ReadGraphNode and ReadGraphEdge lists.
 */
export function parseGraphFromSnapshot(
  snapshot: unknown,
  options?: { includeMemo?: boolean }
): {
  nodes: ReadGraphNode[]
  edges: ReadGraphEdge[]
  groups?: ReadGraphGroupSummary[]
} {
  const { nodes: rawNodes, relationships: rawRelationships } = extractGraphRecords(snapshot)

  const groupsMap = new Map<string, string[]>()
  const nodeNameById = new Map<string, string>()
  const nodes: ReadGraphNode[] = []

  for (const rawNode of rawNodes) {
    const nodeId = rawNode.id
    const nodeName = rawNode.name ?? nodeId
    if (nodeId && nodeName) {
      nodeNameById.set(nodeId, nodeName)
    }

    const attrs = rawNode.attrs
    const memo = typeof attrs?.memo === 'string' ? attrs.memo : undefined
    const hasMemo = typeof memo === 'string' && memo.trim().length > 0

    let clusterId: string | undefined
    if (typeof attrs?.clusterId === 'string' && attrs.clusterId.trim().length > 0) {
      clusterId = attrs.clusterId.trim()
    } else if (typeof attrs?.group === 'string' && attrs.group.trim().length > 0) {
      clusterId = attrs.group.trim()
    }

    const resultNode: ReadGraphNode = {
      nodeId,
      entity: nodeName,
      hasMemo
    }

    if (clusterId && clusterId !== '__unassigned__') {
      resultNode.group = clusterId
      const list = groupsMap.get(clusterId) || []
      list.push(nodeName)
      groupsMap.set(clusterId, list)
    }

    if (options?.includeMemo && hasMemo) {
      resultNode.memo = memo
    }

    nodes.push(resultNode)
  }

  const groups: ReadGraphGroupSummary[] = Array.from(groupsMap.entries()).map(
    ([name, entities]) => ({
      name,
      nodeCount: entities.length,
      entities
    })
  )

  const edges: ReadGraphEdge[] = rawRelationships.map((relationship) => {
    const fromId = relationship.from.nodeId
    const toId = relationship.to.nodeId
    return {
      from: nodeNameById.get(fromId) || fromId,
      to: nodeNameById.get(toId) || toId,
      label: typeof relationship.attrs?.label === 'string' ? relationship.attrs.label : undefined
    }
  })

  return {
    nodes,
    edges,
    groups: groups.length > 0 ? groups : undefined
  }
}

/**
 * Reads the full graph state from the server via WebSocket.
 */
export async function executeReadGraph(options: ReadGraphOptions): Promise<ReadGraphResult> {
  const targetId = options.instanceId?.trim() || ''

  // Connect as a client to get the snapshot
  const client = await connectToCanvas(targetId, { port: options.wsPort })

  // Get the derived state
  const snapshot = client.getSnapshot()

  const { nodes, edges, groups } = parseGraphFromSnapshot(snapshot, {
    includeMemo: options.includeMemo
  })

  // Clean up
  const clientId = client.getClientId()
  client.disconnect()

  return {
    nodes,
    edges,
    groups,
    instanceId: options.instanceId,
    clientId
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. writeGraph
// ─────────────────────────────────────────────────────────────────────────────

export type WriteGraphOptions = WriteGraphSpec & {
  wsPort?: number
  apiPort?: number
  staged?: boolean
}

function resolveGraphSpecIdentity(
  spec: WriteGraphSpec,
  currentGraph: CanvasSnapshot | null | undefined
): WriteGraphSpec {
  assertUniqueNodeEntities(spec.nodes || [])

  const { nodes: currentNodes } = extractGraphRecords(currentGraph)

  // 1. Build lookup tables for existing nodes
  const byNameEntries = currentNodes
    .map((n): [string | undefined, string] => [n.name?.trim().toLowerCase(), String(n.id)])
    .filter((entry): entry is [string, string] => !!entry[0])
  const byName = new Map<string, string>(byNameEntries)
  const byId = new Map<string, RawGraphNode>(currentNodes.map((n) => [String(n.id), n]))

  const aliasToNodeId = new Map<string, string>()
  const resolvedNodesById = new Map<string, NodeSpec>()
  const aliasByResolvedNodeId = new Map<string, string>()

  const normalizeNodeRef = (ref: string) => ref.trim().toLowerCase()

  for (const node of spec.nodes || []) {
    const alias = node.entity

    // 2. Resolve identity: Name Match > ID Match > New UUID
    const resolvedNodeId: string =
      byName.get(alias.toLowerCase()) ||
      (isCanonicalNodeId(alias) && byId.has(alias) ? alias : undefined) ||
      generateNodeId()

    const existingAlias = aliasByResolvedNodeId.get(resolvedNodeId)
    if (existingAlias && existingAlias !== alias) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_NODE_ALIAS_COLLISION,
        `Multiple node aliases resolved to the same node: "${existingAlias}", "${alias}"`
      )
    }

    aliasToNodeId.set(alias, resolvedNodeId)
    aliasByResolvedNodeId.set(resolvedNodeId, alias)
    resolvedNodesById.set(resolvedNodeId, {
      ...node,
      entity: resolvedNodeId,
      name: node.name || node.entity // Preserve display name
    })
  }

  const resolveRef = (ref: string) =>
    aliasToNodeId.get(ref) || byName.get(normalizeNodeRef(ref)) || (byId.has(ref) ? ref : undefined)

  const resolvedStartFrom = spec.startFrom ? resolveRef(spec.startFrom) : undefined
  if (spec.startFrom && !resolvedStartFrom) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_GRAPH_START_NODE_NOT_FOUND,
      `Cannot find 'startFrom' anchor entity: "${spec.startFrom}". Run readGraph to see existing entities.`
    )
  }

  const resolvedDeleteNodes = (spec.deleteNodes || [])
    .map(resolveRef)
    .filter((v): v is string => !!v)

  const resolvedEdges: EdgeSpec[] = []
  for (const edge of spec.edges || []) {
    const from = resolveRef(edge.from)
    const to = resolveRef(edge.to)
    if (!from || !to) {
      const missing =
        !from && !to
          ? `both "${edge.from}" and "${edge.to}"`
          : !from
            ? `source "${edge.from}"`
            : `target "${edge.to}"`
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED,
        `Unable to resolve edge endpoint(s) (${missing}): ${edge.from} -> ${edge.to}`
      )
    }
    resolvedEdges.push({ ...edge, from, to })
  }

  const resolvedDeleteEdges: DeleteEdgeSpec[] = []
  for (const edge of spec.deleteEdges || []) {
    const from = resolveRef(edge.from)
    const to = resolveRef(edge.to)
    if (from && to) {
      resolvedDeleteEdges.push({ ...edge, from, to })
    }
  }

  return {
    ...spec,
    startFrom: resolvedStartFrom,
    nodes: Array.from(resolvedNodesById.values()),
    edges: resolvedEdges,
    deleteNodes: resolvedDeleteNodes,
    deleteEdges: resolvedDeleteEdges
  }
}

/**
 * Writes a graph using a declarative specification.
 *
 * In "replace" mode, the entire graph is overwritten with the new spec.
 * In "merge" mode, new nodes/edges are added to the existing graph,
 * optionally starting from a specified anchor node.
 *
 * @param options The declarative graph specification
 * @returns The updated graph payload
 */
export async function executeWriteGraph(options: WriteGraphOptions) {
  const validatedSpec = WriteGraphSpecSchema.parse(options)
  const { instanceId } = validatedSpec
  const targetId = instanceId?.trim() || ''

  // 1. Connect to the Realtim System
  const client = await connectToCanvas(targetId, { port: options.wsPort })

  // 2. Observe Current State & Provision New Instances
  // The client automatically syncs state on connect
  const currentGraph = client.getSnapshot()

  if (!currentGraph) {
    client.disconnect()
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_GRAPH_SNAPSHOT_FAILED,
      `Failed to retrieve graph snapshot for instance "${targetId}".`
    )
  }

  // Removed auto document provisioning for canvas nodes.
  // They are now memo-backed directly in the graph serialization.

  const resolvedSpec = resolveGraphSpecIdentity(validatedSpec, currentGraph)

  // 3. Compute Diff (Atomic Commands)
  // We assume currentGraph is the source of truth
  const commands = CanvasDiffEngine.computeDiff(currentGraph, resolvedSpec)

  // 4. Execute Commands
  // Send them in batch sequentially and await acknowledgments
  const staged = options.staged ?? true
  try {
    if (commands.length > 0) {
      await client.sendBatch(commands.map((cmd) => ({ ...cmd, staged })))
    }
  } finally {
    // 5. Cleanup
    client.disconnect()
  }

  // 6. Return success
  return {
    instanceId,
    status: 'success'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for MCP Server
// ─────────────────────────────────────────────────────────────────────────────

export { createGraphPayload, generateNodeId, generateRelationshipId }
export { WriteGraphSpecSchema } from './graphSchemaConverter'
