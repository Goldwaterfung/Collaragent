import { RelationalLedgerEntry } from '@shared/wiki'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

export interface SupersedenceCycleResult {
  hasCycle: boolean
  cycleEntities: string[]
  cycleEdgeIds: string[]
}

interface EdgeRef {
  target: string
  edgeId: string
}

/**
 * Executes Tarjan's Strongly Connected Components (SCC) algorithm restricted
 * to the directed subgraph of edges where rel === 'supersedes' and status !== 'archived'.
 *
 * A directed edge A -> B indicates that entity A supersedes entity B.
 * Any cycle (e.g. A -> B -> C -> A) breaks temporal causality and must fail closed.
 */
export function detectSupersedenceCycle(
  existingEdges: RelationalLedgerEntry[],
  candidateEdge?: RelationalLedgerEntry
): SupersedenceCycleResult {
  const edges: RelationalLedgerEntry[] = []

  let candidateAdded = false
  for (const edge of existingEdges) {
    if (candidateEdge && edge.id === candidateEdge.id) {
      edges.push(candidateEdge)
      candidateAdded = true
    } else {
      edges.push(edge)
    }
  }
  if (candidateEdge && !candidateAdded) {
    edges.push(candidateEdge)
  }

  // Filter to active supersedes edges
  const supersedesEdges = edges.filter((e) => e.rel === 'supersedes' && e.status !== 'archived')

  // Build adjacency list
  const adj = new Map<string, EdgeRef[]>()
  const allNodes = new Set<string>()

  for (const edge of supersedesEdges) {
    allNodes.add(edge.sourceEntityId)
    allNodes.add(edge.targetEntityId)

    let list = adj.get(edge.sourceEntityId)
    if (!list) {
      list = []
      adj.set(edge.sourceEntityId, list)
    }
    list.push({ target: edge.targetEntityId, edgeId: edge.id })
  }

  // Tarjan's algorithm
  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccs: string[][] = []

  function strongConnect(u: string): void {
    indices.set(u, index)
    lowlinks.set(u, index)
    index++
    stack.push(u)
    onStack.add(u)

    const neighbors = adj.get(u) || []
    for (const { target: v } of neighbors) {
      if (!indices.has(v)) {
        strongConnect(v)
        const vLow = lowlinks.get(v) ?? 0
        const uLow = lowlinks.get(u) ?? 0
        lowlinks.set(u, Math.min(uLow, vLow))
      } else if (onStack.has(v)) {
        const vIndex = indices.get(v) ?? 0
        const uLow = lowlinks.get(u) ?? 0
        lowlinks.set(u, Math.min(uLow, vIndex))
      }
    }

    if (lowlinks.get(u) === indices.get(u)) {
      const scc: string[] = []
      while (stack.length > 0) {
        const w = stack.pop()!
        onStack.delete(w)
        scc.push(w)
        if (w === u) break
      }
      sccs.push(scc)
    }
  }

  for (const node of allNodes) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  // Find any SCC that contains a cycle:
  // Either |SCC| > 1, or |SCC| == 1 with a self-loop (u -> u)
  for (const scc of sccs) {
    if (scc.length > 1) {
      const sccSet = new Set(scc)
      const cycleInfo = extractCyclePath(scc[0], sccSet, adj)
      if (cycleInfo) {
        const canonical = canonicalizeCycle(cycleInfo.entities, cycleInfo.edgeIds)
        return {
          hasCycle: true,
          cycleEntities: canonical.entities,
          cycleEdgeIds: canonical.edgeIds
        }
      }
    } else if (scc.length === 1) {
      const u = scc[0]
      const selfLoop = (adj.get(u) || []).find((e) => e.target === u)
      if (selfLoop) {
        return {
          hasCycle: true,
          cycleEntities: [u, u],
          cycleEdgeIds: [selfLoop.edgeId]
        }
      }
    }
  }

  return {
    hasCycle: false,
    cycleEntities: [],
    cycleEdgeIds: []
  }
}

function extractCyclePath(
  startNode: string,
  sccSet: Set<string>,
  adj: Map<string, EdgeRef[]>
): { entities: string[]; edgeIds: string[] } | null {
  const visited = new Set<string>()
  const path: string[] = [startNode]
  const edgeIds: string[] = []

  function dfs(curr: string): boolean {
    visited.add(curr)
    const neighbors = (adj.get(curr) || []).filter((e) => sccSet.has(e.target))
    for (const { target, edgeId } of neighbors) {
      edgeIds.push(edgeId)
      path.push(target)

      if (
        target === startNode ||
        (visited.has(target) && path.indexOf(target) !== path.length - 1)
      ) {
        const cycleStartIndex = path.indexOf(target)
        path.splice(0, cycleStartIndex)
        edgeIds.splice(0, cycleStartIndex)
        return true
      }

      if (!visited.has(target)) {
        if (dfs(target)) return true
      }

      path.pop()
      edgeIds.pop()
    }
    return false
  }

  if (dfs(startNode)) {
    return { entities: path, edgeIds }
  }

  return null
}

function canonicalizeCycle(
  entities: string[],
  edgeIds: string[]
): { entities: string[]; edgeIds: string[] } {
  if (entities.length <= 2) {
    return { entities, edgeIds }
  }

  // entities has format [v0, v1, ..., vn-1, v0]
  const n = entities.length - 1
  const vertices = entities.slice(0, n)

  let minIdx = 0
  for (let i = 1; i < n; i++) {
    if (vertices[i] < vertices[minIdx]) {
      minIdx = i
    }
  }

  if (minIdx === 0) {
    return { entities, edgeIds }
  }

  const rotatedVertices = [...vertices.slice(minIdx), ...vertices.slice(0, minIdx)]
  const rotatedEntities = [...rotatedVertices, rotatedVertices[0]]
  const rotatedEdgeIds = [...edgeIds.slice(minIdx), ...edgeIds.slice(0, minIdx)]

  return { entities: rotatedEntities, edgeIds: rotatedEdgeIds }
}

export function assertNoSupersedenceCycle(
  existingEdges: RelationalLedgerEntry[],
  candidateEdge: RelationalLedgerEntry
): void {
  if (candidateEdge.rel !== 'supersedes' || candidateEdge.status === 'archived') {
    return
  }

  const result = detectSupersedenceCycle(existingEdges, candidateEdge)
  if (result.hasCycle) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE,
      `Circular supersedence cycle detected: ${result.cycleEntities.join(' -> ')}`,
      {
        subsystem: 'WORKSPACE',
        details: {
          cycle: result.cycleEntities,
          edgeIds: result.cycleEdgeIds,
          triggerEdgeId: candidateEdge.id,
          recommendFix: `Remove or reverse the supersedence relation between "${candidateEdge.sourceEntityId}" and "${candidateEdge.targetEntityId}", or archive one of the cyclic edges (${result.cycleEdgeIds.join(', ')}).`
        }
      }
    )
  }
}
