import { z } from 'zod'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SEP,
  DEFAULT_RANK_SEP,
  MIN_NODE_EXPANDED_HEIGHT
} from '@shared/constants'
import { createPortId, getBestDirection } from '@workspace/canvas/domain/portUtils'
import type { NodeLayout } from '@workspace/canvas/domain/types'
import {
  getHeaderWidthForName,
  calculateHeaderHeight
} from '@workspace/canvas/components/nodeLayout'
import {
  computeClusterAutoLayout,
  getNodeClusterId
} from '@workspace/canvas/domain/analysis/clustering/clusterLayout'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

// ─────────────────────────────────────────────────────────────────────────────
// Schema Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const DirectionSchema = z.enum(['LR', 'TD', 'RADIAL'])
export type Direction = z.infer<typeof DirectionSchema>

export const ModeSchema = z.enum(['replace', 'merge'])
export type Mode = z.infer<typeof ModeSchema>

export const NodeSpecSchema = z
  .object({
    entity: z.string().min(1).describe('Unique name for this node (stable ID or alias).'),
    name: z.string().optional().describe('Display name for the node.'),
    memo: z.string().optional().describe('Optional memo text (always in markdown format).'),
    clearMemo: z.boolean().optional().describe('Set to true to clear existing memo content.'),
    group: z.string().optional().describe('Optional semantic group or cluster name for this node.')
  })
  .passthrough()
export type NodeSpec = z.infer<typeof NodeSpecSchema>

export function mergeClusterAttrs(
  existingAttrs: Record<string, unknown> | undefined,
  spec: { group?: string }
): Record<string, unknown> {
  const attrs = { ...(existingAttrs || {}) }
  if (typeof spec.group === 'string') {
    const trimmed = spec.group.trim()
    if (trimmed.length > 0) {
      attrs.clusterId = trimmed
    } else {
      delete attrs.clusterId
    }
  }
  return attrs
}

export function mergeMemoAttrs(
  existingAttrs: Record<string, unknown> | undefined,
  spec: {
    memo?: string
    clearMemo?: boolean
  }
): Record<string, unknown> {
  const attrs = { ...(existingAttrs || {}) }
  let changed = false

  if (spec.clearMemo) {
    if ('memo' in attrs) changed = true
    delete attrs.memo
    if ('memoFormat' in attrs) changed = true
    delete attrs.memoFormat
  } else if (spec.memo !== undefined) {
    if (attrs.memo !== spec.memo) changed = true
    attrs.memo = spec.memo

    if (attrs.memoFormat !== 'markdown') {
      attrs.memoFormat = 'markdown'
      changed = true
    }
  }

  if (changed) {
    attrs.memoUpdatedAt = new Date().toISOString()
  }

  return attrs
}

export type MindMapNode = {
  entity: string
  memo?: string
  clearMemo?: boolean
  children?: MindMapNode[]
}

// Dynamically generate a deep schema to avoid $ref (which breaks some LLM APIs)
// while allowing practically unlimited depth (here unrolled to 10 levels deep).
const MAX_DEPTH = 10

let DynamicMindMapNodeSchema: z.ZodTypeAny = z.object({
  entity: z.string().min(1).describe('Entity name and label.'),
  memo: z.string().optional().describe('Optional memo text (always in markdown format).'),
  clearMemo: z.boolean().optional().describe('Set to true to clear existing memo content.')
})

for (let i = 0; i < MAX_DEPTH; i++) {
  DynamicMindMapNodeSchema = z.object({
    entity: z.string().min(1).describe('Entity name and label.'),
    memo: z.string().optional().describe('Optional memo text (always in markdown format).'),
    clearMemo: z.boolean().optional().describe('Set to true to clear existing memo content.'),
    children: z.array(DynamicMindMapNodeSchema).optional().describe('Child nodes.')
  })
}

export const MindMapNodeSchema: z.ZodType<MindMapNode> =
  DynamicMindMapNodeSchema as z.ZodType<MindMapNode>

export const EdgeSpecSchema = z.object({
  from: z.string().min(1).describe('Source node alias.'),
  to: z.string().min(1).describe('Target node alias.'),
  label: z.string().optional().describe('Optional relationship label.')
})
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>

export const DeleteEdgeSpecSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
})
export type DeleteEdgeSpec = z.infer<typeof DeleteEdgeSpecSchema>

export const WriteGraphSpecSchema = z
  .object({
    instanceId: z.string().min(1).describe('Target graph canvas instance ID.'),
    direction: DirectionSchema.describe('Layout direction: LR, TD, or RADIAL.'),
    mode: ModeSchema.describe('replace = overwrite entire graph, merge = extend existing graph.'),
    startFrom: z
      .string()
      .optional()
      .describe('(merge mode) Entity alias to anchor new nodes from.'),
    root: MindMapNodeSchema.optional().describe('Recursive root node for mind maps.'),
    nodes: z
      .array(NodeSpecSchema)
      .optional()
      .default([])
      .describe('List of nodes to create (if not using root).'),
    edges: z
      .array(EdgeSpecSchema)
      .optional()
      .default([])
      .describe('List of edges to create (if not using root).'),
    deleteNodes: z.array(z.string()).optional().describe('(merge mode) Entity aliases to delete.'),
    deleteEdges: z.array(DeleteEdgeSpecSchema).optional().describe('(merge mode) Edges to delete.'),
    staged: z.boolean().optional().describe('Whether to stage the changes for review.')
  })
  .passthrough()
export type WriteGraphSpec = z.infer<typeof WriteGraphSpecSchema>

/**
 * Flattens a hierarchical mind map into a flat list of nodes and edges.
 */
export function flattenMindMap(root: MindMapNode): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
  if (!root || typeof root.entity !== 'string' || root.entity.trim().length === 0) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_ROOT_EMPTY,
      'The root node of a mind map must have a non-empty entity name.'
    )
  }

  const nodes: NodeSpec[] = []
  const edges: EdgeSpec[] = []
  const visited = new Set<MindMapNode>()

  function traverse(node: MindMapNode, currentGroup?: string) {
    if (visited.has(node)) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_CYCLE_DETECTED,
        `Circular reference detected in mind map hierarchy at node "${node.entity}".`
      )
    }
    visited.add(node)

    nodes.push({
      entity: node.entity,
      name: node.entity,
      memo: node.memo,
      clearMemo: node.clearMemo,
      group: currentGroup
    })

    if (node.children) {
      for (const child of node.children) {
        edges.push({
          from: node.entity,
          to: child.entity
        })
        const nextGroup = currentGroup ?? child.entity
        traverse(child, nextGroup)
      }
    }
  }

  traverse(root, undefined)
  return { nodes, edges }
}

export function assertUniqueNodeEntities(nodes: NodeSpec[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const node of nodes) {
    const entity = node.entity.trim()
    if (seen.has(entity)) {
      duplicates.add(entity)
      continue
    }
    seen.add(entity)
  }

  if (duplicates.size > 0) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_GRAPH_DUPLICATE_NODE_ALIAS,
      `Duplicate node entity aliases are not allowed: ${Array.from(duplicates).join(', ')}`
    )
  }
}

function assertEdgeEndpointsExist(edges: EdgeSpec[], nodeIds: ReadonlySet<string>): void {
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      const missing =
        !nodeIds.has(edge.from) && !nodeIds.has(edge.to)
          ? `both "${edge.from}" and "${edge.to}"`
          : !nodeIds.has(edge.from)
            ? `source "${edge.from}"`
            : `target "${edge.to}"`
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED,
        `Edge references unknown node alias (${missing}): ${edge.from} -> ${edge.to}`
      )
    }
  }
}

function collectConnectedNodeIds(
  seedNodeIds: Iterable<string>,
  edges: EdgeSpec[],
  validNodeIds: ReadonlySet<string>
): Set<string> {
  // Build an undirected adjacency view so we can find the full affected
  // component regardless of edge direction.
  const adjacency = new Map<string, Set<string>>()

  for (const edge of edges) {
    if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to)) {
      continue
    }

    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set<string>())
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set<string>())

    adjacency.get(edge.from)!.add(edge.to)
    adjacency.get(edge.to)!.add(edge.from)
  }

  const visited = new Set<string>()
  const queue: string[] = []

  for (const nodeId of seedNodeIds) {
    if (!validNodeIds.has(nodeId) || visited.has(nodeId)) {
      continue
    }

    visited.add(nodeId)
    queue.push(nodeId)
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    for (const neighborId of adjacency.get(nodeId) || []) {
      if (visited.has(neighborId)) {
        continue
      }

      visited.add(neighborId)
      queue.push(neighborId)
    }
  }

  return visited
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout Constants
// ─────────────────────────────────────────────────────────────────────────────

const NODE_SEP_VAL = DEFAULT_NODE_SEP
const RANK_SEP_VAL = DEFAULT_RANK_SEP

// Step sizes for layout spacing
const STEP_X = DEFAULT_NODE_WIDTH + NODE_SEP_VAL
const STEP_Y = DEFAULT_NODE_HEIGHT + RANK_SEP_VAL

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Layout Algorithm
// ─────────────────────────────────────────────────────────────────────────────

import dagre from '@dagrejs/dagre'
import { tree, hierarchy } from 'd3-hierarchy'

/**
 * Computes node positions using a radial tree layout via d3-hierarchy.
 * Best for mind maps and hierarchical data.
 */
export function computeRadialLayout(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  anchorX = 0,
  anchorY = 0
): Record<string, NodeLayout> {
  if (nodes.length === 0) return {}

  // 1. Build a parent-child map and a name lookup
  const parentMap = new Map<string, string[]>()
  const childToParent = new Map<string, string>()
  const nodeSet = new Set(nodes.map((n) => n.entity))
  const nameMap = new Map(nodes.map((n) => [n.entity, n.name || n.entity]))

  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue
    const children = parentMap.get(edge.from) || []
    children.push(edge.to)
    parentMap.set(edge.from, children)
    childToParent.set(edge.to, edge.from)
  }

  // 2. Find the root (node with no parent)
  const rootEntity = nodes.find((n) => !childToParent.has(n.entity))?.entity || nodes[0].entity

  // 3. Create d3 hierarchy
  const d3Root = hierarchy(rootEntity, (d) => parentMap.get(d) || [])

  // 4. Compute Tree Layout
  // Size is [angle in radians, radius]
  const depth = d3Root.height || 1
  const radiusScale = Math.max(STEP_X, STEP_Y) * 0.9
  const treeLayout = tree<string>().size([2 * Math.PI, depth * radiusScale])
  const layoutRoot = treeLayout(d3Root)

  // 5. Convert Polar to Cartesian
  const layoutByNodeId: Record<string, NodeLayout> = {}
  layoutRoot.descendants().forEach((d) => {
    const entityId = d.data
    const name = nameMap.get(entityId) || entityId

    // Calculate dynamic dimensions for this specific node
    const w = getHeaderWidthForName(name)
    const h = calculateHeaderHeight(name, w)

    const angle = d.x - Math.PI / 2
    const dist = d.y

    const x = anchorX + (dist ?? 0) * Math.cos(angle ?? 0)
    const y = anchorY + (dist ?? 0) * Math.sin(angle ?? 0)

    layoutByNodeId[entityId] = {
      x: x - w / 2,
      y: y - h / 2,
      width: w,
      height: h
    }
  })

  return layoutByNodeId
}

function getNodeMemoAttr(node: NodeSpec): unknown {
  if (
    'attrs' in node &&
    typeof node.attrs === 'object' &&
    node.attrs !== null &&
    'memo' in node.attrs
  ) {
    return (node.attrs as Record<string, unknown>).memo
  }
  return undefined
}

/**
 * Estimates visual dimensions for a node based on its header content and memo presence.
 * - Header height is calculated dynamically based on text wrapping (56px–120px).
 * - If memo content is present, expands height to account for memo body (min 120px body).
 * - Preserves custom dimensions from existingLayout if already defined.
 */
export function estimateNodeDimensions(
  node: NodeSpec,
  existingLayout?: NodeLayout
): { width: number; height: number } {
  const width = existingLayout?.width ?? DEFAULT_NODE_WIDTH
  const headerHeight = calculateHeaderHeight(node.name || node.entity, width)
  const memoAttr = getNodeMemoAttr(node)
  const hasMemo =
    (typeof node.memo === 'string' && node.memo.trim().length > 0) ||
    (typeof memoAttr === 'string' ? memoAttr.trim().length > 0 : Boolean(memoAttr))

  if (hasMemo) {
    const height = Math.max(
      headerHeight + MIN_NODE_EXPANDED_HEIGHT,
      existingLayout?.height ?? headerHeight + DEFAULT_NODE_HEIGHT
    )
    return { width, height }
  }

  if (existingLayout?.height !== undefined && Number.isFinite(existingLayout.height)) {
    return { width, height: Math.max(headerHeight, existingLayout.height) }
  }

  return { width, height: headerHeight }
}

/**
 * Computes node positions using the Sugiyama algorithms via Dagre.
 * This is the same layout engine used by Mermaid for flowcharts.
 *
 * @param nodes List of nodes to layout
 * @param edges List of edges defining the hierarchy
 * @param direction Layout direction ("LR" or "TD")
 * @param anchorX X offset for the entire layout
 * @param anchorY Y offset for the entire layout
 * @param _startFrom Kept for interface compatibility, though Dagre handles this globally
 * @param existingLayouts Optional map of existing node layouts to preserve custom dimensions
 */
export function computeAutoLayout(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  direction: Direction,
  anchorX = 0,
  anchorY = 0,
  _startFrom?: string, // Kept for interface compatibility, though Dagre handles this globally
  existingLayouts?: Record<string, NodeLayout>
): Record<string, NodeLayout> {
  if (nodes.length === 0) {
    return {}
  }

  // 1. Initialize Dagre Graph
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: direction,
    nodesep: NODE_SEP_VAL, // Spacing between nodes within the same rank
    ranksep: RANK_SEP_VAL, // Spacing between successive ranks
    marginx: 0,
    marginy: 0
  })
  g.setDefaultEdgeLabel(() => ({}))

  // 2. Add Nodes
  for (const node of nodes) {
    const dims = estimateNodeDimensions(node, existingLayouts?.[node.entity])
    g.setNode(node.entity, dims)
  }

  // 3. Add Edges
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to)
  }

  // 4. Compute Layout
  dagre.layout(g)

  // 5. Extract Positions
  // Dagre returns center coordinates (x,y), but our system uses top-left (x,y)
  const layoutByNodeId: Record<string, NodeLayout> = {}

  // If we are merging (have an anchor), we need to offset the whole graph
  // Dagre always starts at 0,0 locally.

  // Find the min x/y to normalize if needed (usually 0, but good to be safe)
  let minX = Infinity
  let minY = Infinity

  g.nodes().forEach((v) => {
    const node = g.node(v)
    // dagre node stats
    const topLeftX = node.x - node.width / 2
    const topLeftY = node.y - node.height / 2

    if (topLeftX < minX) minX = topLeftX
    if (topLeftY < minY) minY = topLeftY
  })

  if (minX === Infinity) minX = 0
  if (minY === Infinity) minY = 0

  g.nodes().forEach((v) => {
    const node = g.node(v)
    // Convert center-based to top-left-based and apply anchor/offset
    const x = node.x - node.width / 2 - minX + anchorX
    const y = node.y - node.height / 2 - minY + anchorY

    layoutByNodeId[v] = {
      x,
      y,
      width: node.width,
      height: node.height
    }
  })

  return layoutByNodeId
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Spec Application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique relationship ID based on from/to entities.
 * Format: "rel-{from}-{to}" for deterministic IDs.
 */
function generateRelationshipId(from: string, to: string): string {
  return `rel-${from}-${to}`
}

/**
 * Determines port IDs based on node positions.
 */
function getPortId(
  fromNodeId: string,
  toNodeId: string,
  layoutByNodeId: Record<string, NodeLayout>
) {
  const fromLayout = layoutByNodeId[fromNodeId]
  const toLayout = layoutByNodeId[toNodeId]

  if (!fromLayout || !toLayout) {
    // Fallback to east/west if layout is missing for some reason
    return {
      fromPort: createPortId(fromNodeId, 'east'),
      toPort: createPortId(toNodeId, 'west')
    }
  }

  const fromDir = getBestDirection(fromLayout, toLayout)
  const toDir = getBestDirection(toLayout, fromLayout)

  return {
    fromPort: createPortId(fromNodeId, fromDir),
    toPort: createPortId(toNodeId, toDir)
  }
}

/**
 * Applies a WriteGraphSpec to create or update a GraphCanvasDTO.
 *
 * @param existingPayload - Current graph state (null for new graph)
 * @param spec - The declarative graph specification
 * @returns Updated GraphCanvasDTO
 */
export function applyGraphSpec(
  existingPayload: GraphCanvasDTO | null,
  spec: WriteGraphSpec
): GraphCanvasDTO {
  const now = new Date().toISOString()

  // If root is provided, it takes precedence over flat nodes/edges
  if (spec.root) {
    const { nodes, edges } = flattenMindMap(spec.root)
    spec = {
      ...spec,
      nodes: [...(spec.nodes || []), ...nodes],
      edges: [...(spec.edges || []), ...edges]
    }
  }

  assertUniqueNodeEntities(spec.nodes || [])

  if (spec.mode === 'replace' || !existingPayload) {
    // Replace mode: create fresh graph
    return createFreshGraph(spec, now)
  }

  // Merge mode: extend existing graph
  return mergeIntoGraph(existingPayload, spec, now)
}

function createFreshGraph(spec: WriteGraphSpec, timestamp: string): GraphCanvasDTO {
  const nodeIds = new Set((spec.nodes || []).map((node) => node.entity))
  assertEdgeEndpointsExist(spec.edges || [], nodeIds)

  const hasClusters = (spec.nodes || []).some((node) => Boolean(getNodeClusterId(node)))

  const layoutByNodeId =
    spec.direction === 'RADIAL'
      ? computeRadialLayout(spec.nodes || [], spec.edges || [])
      : hasClusters
        ? computeClusterAutoLayout(spec.nodes || [], spec.edges || [], spec.direction)
            .layoutByNodeId
        : computeAutoLayout(spec.nodes || [], spec.edges || [], spec.direction)

  // Build nodes and relationships records
  const nodes: GraphCanvasDTO['graph']['nodes'] = {}
  for (const nodeSpec of spec.nodes || []) {
    nodes[nodeSpec.entity] = buildGraphNode(nodeSpec)
  }
  const relationships = buildRelationshipRecord(spec.edges || [], layoutByNodeId, nodeIds)

  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: { nodes, relationships },
    layout: { layoutByNodeId },
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp
    }
  }
}

function mergeIntoGraph(
  existing: GraphCanvasDTO,
  spec: WriteGraphSpec,
  timestamp: string
): GraphCanvasDTO {
  // Start with copies of existing data
  const nodes = { ...existing.graph.nodes }
  const relationships = { ...existing.graph.relationships }
  const layoutByNodeId = { ...existing.layout.layoutByNodeId }

  // Step 1: Process deletions first
  if (spec.deleteNodes) {
    for (const entityToDelete of spec.deleteNodes) {
      delete nodes[entityToDelete]
      delete layoutByNodeId[entityToDelete]

      // Cascade: remove relationships connected to deleted node
      for (const [relId, rel] of Object.entries(relationships)) {
        if (rel.from.nodeId === entityToDelete || rel.to.nodeId === entityToDelete) {
          delete relationships[relId]
        }
      }
    }
  }

  if (spec.deleteEdges) {
    for (const edgeToDelete of spec.deleteEdges) {
      const relId = generateRelationshipId(edgeToDelete.from, edgeToDelete.to)
      delete relationships[relId]
    }
  }

  const nextNodeIds = new Set<string>([
    ...Object.keys(nodes),
    ...(spec.nodes || []).map((node) => node.entity)
  ])
  assertEdgeEndpointsExist(spec.edges || [], nextNodeIds)

  const mergedNodeSpecsById = new Map<string, NodeSpec>()

  for (const existingNode of Object.values(nodes)) {
    mergedNodeSpecsById.set(existingNode.id, {
      entity: existingNode.id,
      name: existingNode.name,
      attrs: existingNode.attrs
    })
  }

  for (const node of spec.nodes || []) {
    const prev = mergedNodeSpecsById.get(node.entity)
    if (prev) {
      const existingAttrs = prev.attrs as Record<string, unknown> | undefined
      const memoAttrs = mergeMemoAttrs(existingAttrs, node)
      const mergedAttrs = mergeClusterAttrs(memoAttrs, node)
      mergedNodeSpecsById.set(node.entity, {
        ...prev,
        ...node,
        name: node.name || prev.name,
        attrs: mergedAttrs
      })
    } else {
      mergedNodeSpecsById.set(node.entity, node)
    }
  }

  const existingEdgesForLayout: EdgeSpec[] = Object.values(relationships).map((relationship) => ({
    from: relationship.from.nodeId,
    to: relationship.to.nodeId,
    label: (relationship.attrs?.label as string) || undefined
  }))
  const mergedEdgesForLayout: EdgeSpec[] = [...existingEdgesForLayout, ...(spec.edges || [])]
  const affectedSeedNodeIds = new Set<string>([
    ...(spec.nodes || []).map((node) => node.entity),
    ...(spec.edges || []).flatMap((edge) => [edge.from, edge.to]),
    ...(spec.startFrom ? [spec.startFrom] : [])
  ])
  // Re-layout scope is limited to the connected component touched by this
  // merge, keeping unrelated graph regions stable.
  const affectedNodeIds = collectConnectedNodeIds(
    affectedSeedNodeIds,
    mergedEdgesForLayout,
    nextNodeIds
  )
  const affectedNodes = Array.from(affectedNodeIds)
    .map((nodeId) => mergedNodeSpecsById.get(nodeId))
    .filter((node): node is NodeSpec => !!node)
  const affectedEdges = mergedEdgesForLayout.filter(
    (edge) => affectedNodeIds.has(edge.from) && affectedNodeIds.has(edge.to)
  )

  // Step 2: Calculate anchor position for new nodes
  let anchorX = 0
  let anchorY = 0

  if (spec.startFrom && layoutByNodeId[spec.startFrom]) {
    const anchorLayout = layoutByNodeId[spec.startFrom]
    // Position new nodes starting from anchor, offset by node dimensions in the direction
    if (spec.direction === 'LR') {
      anchorX = anchorLayout.x + anchorLayout.width + RANK_SEP_VAL
      anchorY = anchorLayout.y
    } else {
      anchorX = anchorLayout.x
      anchorY = anchorLayout.y + anchorLayout.height + RANK_SEP_VAL
    }
  } else {
    // No anchor: find the bounding box of existing layout and place new nodes outside
    const existingLayouts = Object.values(layoutByNodeId)
    if (existingLayouts.length > 0) {
      let maxX = -Infinity
      let maxY = -Infinity
      for (const l of existingLayouts) {
        const right = l.x + (Number.isFinite(l.width) && l.width > 0 ? l.width : DEFAULT_NODE_WIDTH)
        const bottom =
          l.y + (Number.isFinite(l.height) && l.height > 0 ? l.height : DEFAULT_NODE_HEIGHT)
        if (right > maxX) maxX = right
        if (bottom > maxY) maxY = bottom
      }

      if (spec.direction === 'LR') {
        anchorX = (Number.isFinite(maxX) && maxX !== -Infinity ? maxX : 0) + RANK_SEP_VAL
        anchorY = 0
      } else {
        anchorX = 0
        anchorY = (Number.isFinite(maxY) && maxY !== -Infinity ? maxY : 0) + RANK_SEP_VAL
      }
    }
  }

  const anchorNodeId =
    (spec.startFrom && affectedNodeIds.has(spec.startFrom) && layoutByNodeId[spec.startFrom]
      ? spec.startFrom
      : undefined) || Array.from(affectedNodeIds).find((nodeId) => !!layoutByNodeId[nodeId])

  // Step 4: Compute layout
  let newLayout: Record<string, NodeLayout>
  if (spec.direction === 'RADIAL') {
    // For Radial/Mindmap, the layout depends on the total structure to prevent overlaps.
    // We perform a global re-calculation of the layout for ALL nodes.
    const allNodesForLayout: NodeSpec[] = Object.values(nodes).map((n) => ({
      entity: n.id
    }))

    const allEdgesForLayout: EdgeSpec[] = Object.values(relationships).map((r) => ({
      from: r.from.nodeId,
      to: r.to.nodeId,
      label: (r.attrs?.label as string) || undefined
    }))

    const globalLayout = computeRadialLayout(allNodesForLayout, allEdgesForLayout, 0, 0)

    // Use the global layout for everyone (updating existing and new)
    newLayout = globalLayout
  } else {
    if (affectedNodes.length === 0) {
      newLayout = {}
    } else if (anchorNodeId) {
      const hasAffectedClusters = affectedNodes.some((n) => Boolean(getNodeClusterId(n)))
      const localLayout = hasAffectedClusters
        ? computeClusterAutoLayout(
            affectedNodes,
            affectedEdges,
            spec.direction,
            0,
            0,
            layoutByNodeId
          ).layoutByNodeId
        : computeAutoLayout(
            affectedNodes,
            affectedEdges,
            spec.direction,
            0,
            0,
            undefined,
            layoutByNodeId
          )
      const anchorLayout = layoutByNodeId[anchorNodeId]
      const localAnchorLayout = localLayout[anchorNodeId]
      if (anchorLayout && localAnchorLayout) {
        // Preserve spatial continuity by pinning one existing node and
        // translating the newly computed component around it.
        const offsetX = anchorLayout.x - localAnchorLayout.x
        const offsetY = anchorLayout.y - localAnchorLayout.y

        newLayout = {}
        for (const [nodeId, layout] of Object.entries(localLayout)) {
          newLayout[nodeId] = {
            ...layout,
            x: layout.x + offsetX,
            y: layout.y + offsetY
          }
        }
      } else {
        newLayout = localLayout
      }
    } else {
      const hasAffectedClusters = affectedNodes.some((n) => Boolean(getNodeClusterId(n)))
      newLayout = hasAffectedClusters
        ? computeClusterAutoLayout(
            affectedNodes,
            affectedEdges,
            spec.direction,
            anchorX,
            anchorY,
            layoutByNodeId
          ).layoutByNodeId
        : computeAutoLayout(
            affectedNodes,
            affectedEdges,
            spec.direction,
            anchorX,
            anchorY,
            undefined,
            layoutByNodeId
          )
    }
  }

  // Step 5: Add new nodes or update existing nodes
  for (const nodeSpec of spec.nodes || []) {
    const existingNode = nodes[nodeSpec.entity]
    if (!existingNode) {
      nodes[nodeSpec.entity] = buildGraphNode(nodeSpec)
    } else {
      const nextName = nodeSpec.name || existingNode.name
      const existingAttrs = existingNode.attrs as Record<string, unknown> | undefined
      const memoAttrs = mergeMemoAttrs(existingAttrs, nodeSpec)
      const attrs = mergeClusterAttrs(memoAttrs, nodeSpec)
      nodes[nodeSpec.entity] = {
        ...existingNode,
        name: nextName,
        attrs
      }
    }
  }

  // Update ALL layout positions if we did a global re-layout, or just new ones if partial
  for (const [entityId, layout] of Object.entries(newLayout)) {
    layoutByNodeId[entityId] = layout
  }

  // Step 6: Add/update relationships
  Object.assign(
    relationships,
    buildRelationshipRecord(spec.edges || [], layoutByNodeId, nextNodeIds)
  )

  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: { nodes, relationships },
    layout: { layoutByNodeId },
    meta: {
      createdAt: existing.meta?.createdAt,
      updatedAt: timestamp
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Builders
// ─────────────────────────────────────────────────────────────────────────────

function getNodeAttrs(spec: NodeSpec): Record<string, unknown> {
  if ('attrs' in spec && typeof spec.attrs === 'object' && spec.attrs !== null) {
    return spec.attrs as Record<string, unknown>
  }
  return {}
}

function buildGraphNode(spec: NodeSpec) {
  const baseAttrs = getNodeAttrs(spec)
  const memoAttrs = mergeMemoAttrs(baseAttrs, spec)
  const attrs = mergeClusterAttrs(memoAttrs, spec)
  return {
    id: spec.entity,
    type: 'card' as const,
    name: spec.name || spec.entity,
    attrs
  }
}

function buildRelationshipRecord(
  edges: EdgeSpec[],
  layoutByNodeId: Record<string, NodeLayout>,
  nodeIds: ReadonlySet<string>
): GraphCanvasDTO['graph']['relationships'] {
  const relationships: GraphCanvasDTO['graph']['relationships'] = {}
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED,
        `Edge references unknown node alias: ${edge.from} -> ${edge.to}`
      )
    }
    const relId = generateRelationshipId(edge.from, edge.to)
    const { fromPort, toPort } = getPortId(edge.from, edge.to, layoutByNodeId)

    relationships[relId] = {
      id: relId,
      from: { nodeId: edge.from, portId: fromPort },
      to: { nodeId: edge.to, portId: toPort },
      attrs: edge.label ? { label: edge.label } : undefined
    }
  }
  return relationships
}
