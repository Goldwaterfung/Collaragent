import { describe, it, expect } from 'vitest'
import { clearCanvasClusters, runCanvasClustering } from '../clusteringLifecycle'
import type { CanvasState } from '@workspace/canvas/types'
import {
  asGraphId,
  asNodeId,
  asRelationshipId,
  buildGraph,
  createEmptyGraph
} from '@workspace/canvas/domain'

function createMockCanvasState(): CanvasState {
  const n1 = asNodeId('n1')
  const n2 = asNodeId('n2')
  const r1 = asRelationshipId('r1')

  const graphRes = buildGraph({
    id: asGraphId('graph-1'),
    nodesById: {
      [n1]: {
        id: n1,
        type: 'card',
        name: 'Node 1',
        attrs: {
          memo: 'Hello world',
          clusterId: 'Cluster-A',
          clusterPath: ['L0:1', 'L1:0'],
          clusterRunId: 'run-123'
        },
        ports: {}
      },
      [n2]: {
        id: n2,
        type: 'card',
        name: 'Node 2',
        attrs: {
          clusterId: 'Cluster-B',
          group: 'Cluster-B'
        },
        ports: {}
      }
    },
    relationshipsById: {
      [r1]: {
        id: r1,
        from: { nodeId: n1 },
        to: { nodeId: n2 },
        attrs: {}
      }
    }
  })

  if (!graphRes.ok) {
    throw new Error('Failed to build test graph')
  }

  return {
    domain: {
      graph: graphRes.value
    },
    layout: {
      layoutByNodeId: {
        [n1]: { x: 100, y: 100, width: 300, height: 200 },
        [n2]: { x: 500, y: 100, width: 300, height: 200 }
      }
    },
    ui: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: { nodeIds: [], relationshipIds: [] },
      interaction: { connect: { status: 'idle' } },
      expandedNodeIds: {}
    },
    history: {
      undoStack: [],
      redoStack: [],
      maxSize: 100
    }
  }
}

describe('clusteringLifecycle', () => {
  describe('clearCanvasClusters', () => {
    it('strips all clustering attributes while preserving memo and layout', () => {
      const state = createMockCanvasState()
      const clearedDto = clearCanvasClusters(state)

      const node1 = clearedDto.graph.nodes['n1']
      const node2 = clearedDto.graph.nodes['n2']

      expect(node1).toBeDefined()
      expect(node2).toBeDefined()

      // Clustering attributes should be deleted
      expect(node1.attrs?.clusterId).toBeUndefined()
      expect(node1.attrs?.clusterPath).toBeUndefined()
      expect(node1.attrs?.clusterRunId).toBeUndefined()
      expect(node2.attrs?.clusterId).toBeUndefined()
      expect(node2.attrs?.group).toBeUndefined()

      // Other attributes and layout should be retained
      expect(node1.attrs?.memo).toBe('Hello world')
      expect(clearedDto.layout.layoutByNodeId['n1']).toEqual({
        x: 100,
        y: 100,
        width: 300,
        height: 200
      })
      expect(clearedDto.layout.layoutByNodeId['n2']).toEqual({
        x: 500,
        y: 100,
        width: 300,
        height: 200
      })
    })
  })

  describe('runCanvasClustering', () => {
    it('returns empty DTO immediately if canvas has 0 nodes', async () => {
      const state: CanvasState = {
        ...createMockCanvasState(),
        domain: {
          graph: createEmptyGraph(asGraphId('empty-graph'))
        },
        layout: { layoutByNodeId: {} }
      }

      const result = await runCanvasClustering({
        state,
        mode: 'rearrange'
      })

      expect(Object.keys(result.dto.graph.nodes)).toHaveLength(0)
      expect(Object.keys(result.clusterAttrsByNodeId)).toHaveLength(0)
    })

    it('rejects immediately if AbortSignal is already aborted', async () => {
      const state = createMockCanvasState()
      const controller = new AbortController()
      controller.abort()

      await expect(
        runCanvasClustering({
          state,
          mode: 'rearrange',
          signal: controller.signal
        })
      ).rejects.toThrow('Clustering aborted')
    })
  })
})
