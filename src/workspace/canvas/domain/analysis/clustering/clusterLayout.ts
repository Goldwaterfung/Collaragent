import dagre from '@dagrejs/dagre'
import {
  DEFAULT_CLUSTER_PADDING,
  DEFAULT_CLUSTER_MARGIN,
  CLUSTER_HEADER_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SEP,
  DEFAULT_RANK_SEP,
  MAX_CLUSTER_GRID_COLUMNS
} from '@shared/constants'
import type { NodeLayout } from '@workspace/canvas/domain/types'
import {
  type NodeSpec,
  type EdgeSpec,
  type Direction,
  computeAutoLayout,
  estimateNodeDimensions
} from '@workspace/wstools/graphSchemaConverter'

export interface ClusterBounds {
  clusterId: string
  x: number
  y: number
  width: number
  height: number
  nodeCount: number
}

export interface ClusterAutoLayoutResult {
  layoutByNodeId: Record<string, NodeLayout>
  clusterBoundsById: Record<string, ClusterBounds>
}

/**
 * Extracts a normalized cluster ID from a NodeSpec, prioritizing spec.group
 * and falling back to attrs.clusterId.
 */
export function getNodeClusterId(node: NodeSpec): string | undefined {
  if (typeof node.group === 'string' && node.group.trim().length > 0) {
    return node.group.trim()
  }
  if (node.attrs && typeof node.attrs === 'object' && node.attrs !== null) {
    const attrs = node.attrs as Record<string, unknown>
    if (typeof attrs.clusterId === 'string' && attrs.clusterId.trim().length > 0) {
      return attrs.clusterId.trim()
    }
  }
  return undefined
}

interface LocalClusterLayout {
  clusterId: string
  nodes: NodeSpec[]
  localLayoutByEntity: Record<string, NodeLayout>
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * Computes intra-cluster layout (Tier 1) for a single cluster subgraph.
 */
function computeIntraClusterLayout(
  clusterId: string,
  clusterNodes: NodeSpec[],
  internalEdges: EdgeSpec[],
  direction: Direction,
  existingLayouts?: Record<string, NodeLayout>
): LocalClusterLayout {
  if (clusterNodes.length === 0) {
    return {
      clusterId,
      nodes: [],
      localLayoutByEntity: {},
      minX: 0,
      minY: 0,
      width: 0,
      height: 0
    }
  }

  let localLayoutByEntity: Record<string, NodeLayout>

  if (internalEdges.length > 0) {
    // Has internal connectivity: run standard Dagre within cluster boundaries
    localLayoutByEntity = computeAutoLayout(
      clusterNodes,
      internalEdges,
      direction,
      0,
      0,
      undefined,
      existingLayouts
    )
  } else {
    // No internal edges: arrange in a clean compact grid flow
    localLayoutByEntity = {}
    const isHorizontal = direction === 'LR'
    const gridSize = Math.max(
      1,
      Math.min(MAX_CLUSTER_GRID_COLUMNS, Math.ceil(Math.sqrt(clusterNodes.length)))
    )

    let curCol = 0
    let curRow = 0
    let colOffsetX = 0
    let rowOffsetY = 0
    let maxColWidth = 0
    let maxRowHeight = 0

    for (let i = 0; i < clusterNodes.length; i++) {
      const node = clusterNodes[i]
      const dims = estimateNodeDimensions(node, existingLayouts?.[node.entity])

      if (isHorizontal) {
        // LR: grow downwards up to gridSize rows, then advance column
        if (curRow >= gridSize) {
          curRow = 0
          curCol++
          colOffsetX += maxColWidth + DEFAULT_NODE_SEP
          rowOffsetY = 0
          maxColWidth = 0
        }
      } else {
        // TD: grow rightwards up to gridSize columns, then advance row
        if (curCol >= gridSize) {
          curCol = 0
          curRow++
          rowOffsetY += maxRowHeight + DEFAULT_RANK_SEP
          colOffsetX = 0
          maxRowHeight = 0
        }
      }

      localLayoutByEntity[node.entity] = {
        x: colOffsetX,
        y: rowOffsetY,
        width: dims.width,
        height: dims.height
      }

      maxColWidth = Math.max(maxColWidth, dims.width)
      maxRowHeight = Math.max(maxRowHeight, dims.height)

      if (isHorizontal) {
        curRow++
        rowOffsetY += dims.height + DEFAULT_RANK_SEP
      } else {
        curCol++
        colOffsetX += dims.width + DEFAULT_NODE_SEP
      }
    }
  }

  // Calculate local bounding box envelope
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of clusterNodes) {
    const layout = localLayoutByEntity[node.entity]
    if (!layout) continue
    if (layout.x < minX) minX = layout.x
    if (layout.y < minY) minY = layout.y
    const right = layout.x + layout.width
    const bottom = layout.y + layout.height
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  }

  if (minX === Infinity) minX = 0
  if (minY === Infinity) minY = 0
  if (maxX === -Infinity) maxX = DEFAULT_NODE_WIDTH
  if (maxY === -Infinity) maxY = DEFAULT_NODE_HEIGHT

  const contentWidth = Math.max(0, maxX - minX)
  const contentHeight = Math.max(0, maxY - minY)

  // Add padding around nodes and header allowance at the top
  const width = contentWidth + 2 * DEFAULT_CLUSTER_PADDING
  const height = contentHeight + 2 * DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT

  return {
    clusterId,
    nodes: clusterNodes,
    localLayoutByEntity,
    minX,
    minY,
    width,
    height
  }
}

interface MacroComponent {
  clusterIds: string[]
  edges: Array<{ from: string; to: string }>
  width: number
  height: number
  relativeCoords: Record<string, { x: number; y: number }>
}

/**
 * Partitions macro-graph into weakly connected components and solves each component.
 */
function solveMacroComponents(
  localClusters: LocalClusterLayout[],
  macroEdges: Array<{ from: string; to: string }>,
  direction: Direction
): MacroComponent[] {
  const clusterMap = new Map<string, LocalClusterLayout>()
  for (const lc of localClusters) {
    clusterMap.set(lc.clusterId, lc)
  }

  // Build undirected adjacency graph for component detection
  const adj = new Map<string, Set<string>>()
  for (const lc of localClusters) {
    adj.set(lc.clusterId, new Set())
  }
  for (const me of macroEdges) {
    adj.get(me.from)?.add(me.to)
    adj.get(me.to)?.add(me.from)
  }

  const visited = new Set<string>()
  const components: MacroComponent[] = []

  for (const lc of localClusters) {
    const startId = lc.clusterId
    if (visited.has(startId)) continue

    // BFS to find connected component
    const componentClusters: string[] = []
    const queue = [startId]
    visited.add(startId)

    while (queue.length > 0) {
      const current = queue.shift()!
      componentClusters.push(current)
      const neighbors = adj.get(current)
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n)
            queue.push(n)
          }
        }
      }
    }

    const componentClusterSet = new Set(componentClusters)
    const componentEdges = macroEdges.filter(
      (e) => componentClusterSet.has(e.from) && componentClusterSet.has(e.to)
    )

    if (componentClusters.length > 1 && componentEdges.length > 0) {
      // Run Dagre on this macro component
      const g = new dagre.graphlib.Graph()
      g.setGraph({
        rankdir: direction,
        nodesep: DEFAULT_CLUSTER_MARGIN,
        ranksep: DEFAULT_CLUSTER_MARGIN,
        marginx: 0,
        marginy: 0
      })
      g.setDefaultEdgeLabel(() => ({}))

      for (const cId of componentClusters) {
        const cluster = clusterMap.get(cId)!
        g.setNode(cId, { width: cluster.width, height: cluster.height })
      }

      for (const e of componentEdges) {
        g.setEdge(e.from, e.to)
      }

      dagre.layout(g)

      let cMinX = Infinity
      let cMinY = Infinity
      let cMaxX = -Infinity
      let cMaxY = -Infinity

      const coords: Record<string, { x: number; y: number }> = {}

      g.nodes().forEach((v) => {
        const n = g.node(v)
        const topLeftX = n.x - n.width / 2
        const topLeftY = n.y - n.height / 2

        if (topLeftX < cMinX) cMinX = topLeftX
        if (topLeftY < cMinY) cMinY = topLeftY
        if (topLeftX + n.width > cMaxX) cMaxX = topLeftX + n.width
        if (topLeftY + n.height > cMaxY) cMaxY = topLeftY + n.height

        coords[v] = { x: topLeftX, y: topLeftY }
      })

      if (cMinX === Infinity) cMinX = 0
      if (cMinY === Infinity) cMinY = 0

      // Normalize relative to (0, 0)
      const relativeCoords: Record<string, { x: number; y: number }> = {}
      for (const [v, pos] of Object.entries(coords)) {
        relativeCoords[v] = {
          x: pos.x - cMinX,
          y: pos.y - cMinY
        }
      }

      components.push({
        clusterIds: componentClusters,
        edges: componentEdges,
        width: Math.max(0, cMaxX - cMinX),
        height: Math.max(0, cMaxY - cMinY),
        relativeCoords
      })
    } else {
      // Single cluster or isolated disconnected clusters: unit component
      const cluster = clusterMap.get(componentClusters[0])!
      components.push({
        clusterIds: componentClusters,
        edges: [],
        width: cluster.width,
        height: cluster.height,
        relativeCoords: {
          [componentClusters[0]]: { x: 0, y: 0 }
        }
      })
    }
  }

  return components
}

/**
 * Packs macro components into a 2D grid/shelf arrangement.
 */
function packMacroComponents(
  components: MacroComponent[],
  direction: Direction
): Map<MacroComponent, { x: number; y: number }> {
  const componentPositions = new Map<MacroComponent, { x: number; y: number }>()
  if (components.length === 0) return componentPositions

  if (components.length === 1) {
    componentPositions.set(components[0], { x: 0, y: 0 })
    return componentPositions
  }

  const isHorizontal = direction === 'LR'
  const maxPerRowOrCol = Math.max(
    1,
    Math.min(MAX_CLUSTER_GRID_COLUMNS, Math.ceil(Math.sqrt(components.length)))
  )

  let curX = 0
  let curY = 0
  let shelfBreadth = 0
  let itemCounter = 0

  for (const comp of components) {
    if (isHorizontal) {
      // LR: Stack in shelves vertically or horizontally
      if (itemCounter >= maxPerRowOrCol) {
        itemCounter = 0
        curX += shelfBreadth + DEFAULT_CLUSTER_MARGIN
        curY = 0
        shelfBreadth = 0
      }

      componentPositions.set(comp, { x: curX, y: curY })
      shelfBreadth = Math.max(shelfBreadth, comp.width)
      curY += comp.height + DEFAULT_CLUSTER_MARGIN
      itemCounter++
    } else {
      // TD: Stack in shelves horizontally then wrap downwards
      if (itemCounter >= maxPerRowOrCol) {
        itemCounter = 0
        curY += shelfBreadth + DEFAULT_CLUSTER_MARGIN
        curX = 0
        shelfBreadth = 0
      }

      componentPositions.set(comp, { x: curX, y: curY })
      shelfBreadth = Math.max(shelfBreadth, comp.height)
      curX += comp.width + DEFAULT_CLUSTER_MARGIN
      itemCounter++
    }
  }

  return componentPositions
}

/**
 * Two-Tier Hierarchical Auto-Layout Engine (`computeClusterAutoLayout`)
 *
 * Tier 1: Intra-cluster local Dagre / grid layout for each cluster partition.
 * Tier 2: Inter-cluster macro graph Dagre with 2D shelf packing for disconnected clusters.
 *
 * @param nodes List of node specifications
 * @param edges List of edge specifications
 * @param direction Flow direction ("LR" or "TD")
 * @param anchorX Global horizontal offset
 * @param anchorY Global vertical offset
 * @param existingLayouts Optional map of existing node layouts
 * @returns Projected absolute positions for all nodes and cluster boundary envelopes
 */
export function computeClusterAutoLayout(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  direction: Direction = 'LR',
  anchorX = 0,
  anchorY = 0,
  existingLayouts?: Record<string, NodeLayout>
): ClusterAutoLayoutResult {
  if (nodes.length === 0) {
    return { layoutByNodeId: {}, clusterBoundsById: {} }
  }

  // 1. Partition nodes by cluster
  const nodesByCluster = new Map<string, NodeSpec[]>()
  const clusterByNodeEntity = new Map<string, string>()

  for (const node of nodes) {
    const clusterId = getNodeClusterId(node) ?? '__unassigned__'
    clusterByNodeEntity.set(node.entity, clusterId)

    const list = nodesByCluster.get(clusterId) ?? []
    list.push(node)
    nodesByCluster.set(clusterId, list)
  }

  // Fallback: If 0 or 1 cluster, delegate directly to standard Dagre
  if (nodesByCluster.size <= 1) {
    const [soleClusterId] = Array.from(nodesByCluster.keys())
    const hasCluster = soleClusterId && soleClusterId !== '__unassigned__'

    const nodeAnchorX = hasCluster ? anchorX + DEFAULT_CLUSTER_PADDING : anchorX
    const nodeAnchorY = hasCluster
      ? anchorY + DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT
      : anchorY

    const singleLayout = computeAutoLayout(
      nodes,
      edges,
      direction,
      nodeAnchorX,
      nodeAnchorY,
      undefined,
      existingLayouts
    )

    const clusterBoundsById: Record<string, ClusterBounds> = {}
    if (hasCluster) {
      let bMinX = Infinity
      let bMinY = Infinity
      let bMaxX = -Infinity
      let bMaxY = -Infinity

      for (const l of Object.values(singleLayout)) {
        if (l.x < bMinX) bMinX = l.x
        if (l.y < bMinY) bMinY = l.y
        if (l.x + l.width > bMaxX) bMaxX = l.x + l.width
        if (l.y + l.height > bMaxY) bMaxY = l.y + l.height
      }

      if (bMinX !== Infinity && bMinY !== Infinity) {
        clusterBoundsById[soleClusterId] = {
          clusterId: soleClusterId,
          x: anchorX,
          y: anchorY,
          width: Math.max(0, bMaxX - anchorX + DEFAULT_CLUSTER_PADDING),
          height: Math.max(0, bMaxY - anchorY + DEFAULT_CLUSTER_PADDING),
          nodeCount: nodes.length
        }
      }
    }

    return { layoutByNodeId: singleLayout, clusterBoundsById }
  }

  // 2. Tier 1: Intra-cluster local layout
  const localClusters: LocalClusterLayout[] = []

  for (const [clusterId, clusterNodes] of nodesByCluster.entries()) {
    const clusterEntitySet = new Set(clusterNodes.map((n) => n.entity))
    const internalEdges = edges.filter(
      (e) => clusterEntitySet.has(e.from) && clusterEntitySet.has(e.to)
    )

    const localLayout = computeIntraClusterLayout(
      clusterId,
      clusterNodes,
      internalEdges,
      direction,
      existingLayouts
    )
    localClusters.push(localLayout)
  }

  // 3. Build inter-cluster macro edges
  const macroEdgeSet = new Set<string>()
  const macroEdges: Array<{ from: string; to: string }> = []

  for (const edge of edges) {
    const fromCluster = clusterByNodeEntity.get(edge.from)
    const toCluster = clusterByNodeEntity.get(edge.to)
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const key = `${fromCluster}->${toCluster}`
      if (!macroEdgeSet.has(key)) {
        macroEdgeSet.add(key)
        macroEdges.push({ from: fromCluster, to: toCluster })
      }
    }
  }

  // 4. Tier 2: Solve macro components and shelf pack
  const components = solveMacroComponents(localClusters, macroEdges, direction)
  const componentPositions = packMacroComponents(components, direction)

  // 5. Assemble global coordinates and cluster bounds
  const layoutByNodeId: Record<string, NodeLayout> = {}
  const clusterBoundsById: Record<string, ClusterBounds> = {}

  for (const comp of components) {
    const compPos = componentPositions.get(comp) ?? { x: 0, y: 0 }

    for (const cId of comp.clusterIds) {
      const localCluster = localClusters.find((lc) => lc.clusterId === cId)!
      const clusterRel = comp.relativeCoords[cId] ?? { x: 0, y: 0 }

      const clusterAbsX = compPos.x + clusterRel.x + anchorX
      const clusterAbsY = compPos.y + clusterRel.y + anchorY

      if (cId !== '__unassigned__') {
        clusterBoundsById[cId] = {
          clusterId: cId,
          x: clusterAbsX,
          y: clusterAbsY,
          width: localCluster.width,
          height: localCluster.height,
          nodeCount: localCluster.nodes.length
        }
      }

      // Project each member node's coordinates
      for (const node of localCluster.nodes) {
        const localNodeLayout = localCluster.localLayoutByEntity[node.entity]
        if (!localNodeLayout) continue

        const deltaX = localNodeLayout.x - localCluster.minX
        const deltaY = localNodeLayout.y - localCluster.minY

        layoutByNodeId[node.entity] = {
          x: clusterAbsX + DEFAULT_CLUSTER_PADDING + deltaX,
          y: clusterAbsY + DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT + deltaY,
          width: localNodeLayout.width,
          height: localNodeLayout.height
        }
      }
    }
  }

  return { layoutByNodeId, clusterBoundsById }
}
