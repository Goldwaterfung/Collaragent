import { describe, it, expect } from 'vitest'
import { computeClusterAutoLayout, getNodeClusterId } from '../clusterLayout'
import { DEFAULT_CLUSTER_PADDING, CLUSTER_HEADER_HEIGHT } from '@shared/constants'
import type { NodeSpec, EdgeSpec } from '@workspace/wstools/graphSchemaConverter'

describe('clusterLayout', () => {
  describe('getNodeClusterId', () => {
    it('extracts cluster id from spec.group', () => {
      const node: NodeSpec = {
        entity: 'ui',
        name: 'UI Card',
        group: 'Frontend'
      }
      expect(getNodeClusterId(node)).toBe('Frontend')
    })

    it('extracts cluster id from attrs.clusterId when group is omitted', () => {
      const node: NodeSpec = {
        entity: 'api',
        name: 'API Card',
        attrs: { clusterId: 'Backend' }
      }
      expect(getNodeClusterId(node)).toBe('Backend')
    })

    it('trims whitespace and ignores empty string cluster assignments', () => {
      const nodeA: NodeSpec = { entity: 'a', group: '   ' }
      const nodeB: NodeSpec = { entity: 'b', attrs: { clusterId: '   ' } }
      expect(getNodeClusterId(nodeA)).toBeUndefined()
      expect(getNodeClusterId(nodeB)).toBeUndefined()
    })
  })

  describe('computeClusterAutoLayout', () => {
    it('returns empty results for empty node array', () => {
      const result = computeClusterAutoLayout([], [])
      expect(result.layoutByNodeId).toEqual({})
      expect(result.clusterBoundsById).toEqual({})
    })

    it('falls back to single layout when all nodes are unassigned', () => {
      const nodes: NodeSpec[] = [
        { entity: 'node-1', name: 'Node 1' },
        { entity: 'node-2', name: 'Node 2' }
      ]
      const edges: EdgeSpec[] = [{ from: 'node-1', to: 'node-2' }]

      const result = computeClusterAutoLayout(nodes, edges, 'LR')
      expect(result.layoutByNodeId['node-1']).toBeDefined()
      expect(result.layoutByNodeId['node-2']).toBeDefined()
      expect(result.clusterBoundsById).toEqual({})
    })

    it('positions connected clusters hierarchically along macro edges in LR direction', () => {
      const nodes: NodeSpec[] = [
        { entity: 'fe-1', name: 'UI View', group: 'Frontend' },
        { entity: 'fe-2', name: 'UI Store', group: 'Frontend' },
        { entity: 'be-1', name: 'API Server', group: 'Backend' },
        { entity: 'be-2', name: 'Database', group: 'Backend' }
      ]
      const edges: EdgeSpec[] = [
        { from: 'fe-1', to: 'fe-2' }, // internal to Frontend
        { from: 'be-1', to: 'be-2' }, // internal to Backend
        { from: 'fe-2', to: 'be-1' } // macro edge: Frontend -> Backend
      ]

      const result = computeClusterAutoLayout(nodes, edges, 'LR')

      const feBounds = result.clusterBoundsById['Frontend']
      const beBounds = result.clusterBoundsById['Backend']

      expect(feBounds).toBeDefined()
      expect(beBounds).toBeDefined()
      expect(feBounds.nodeCount).toBe(2)
      expect(beBounds.nodeCount).toBe(2)

      // In LR direction, Frontend must be placed to the left of Backend
      expect(feBounds.x + feBounds.width).toBeLessThanOrEqual(beBounds.x)

      // Nodes must be contained within their respective cluster bounds
      for (const entity of ['fe-1', 'fe-2']) {
        const layout = result.layoutByNodeId[entity]
        expect(layout.x).toBeGreaterThanOrEqual(feBounds.x + DEFAULT_CLUSTER_PADDING)
        expect(layout.x + layout.width).toBeLessThanOrEqual(feBounds.x + feBounds.width)
        expect(layout.y).toBeGreaterThanOrEqual(
          feBounds.y + DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT
        )
        expect(layout.y + layout.height).toBeLessThanOrEqual(feBounds.y + feBounds.height)
      }

      for (const entity of ['be-1', 'be-2']) {
        const layout = result.layoutByNodeId[entity]
        expect(layout.x).toBeGreaterThanOrEqual(beBounds.x + DEFAULT_CLUSTER_PADDING)
        expect(layout.x + layout.width).toBeLessThanOrEqual(beBounds.x + beBounds.width)
        expect(layout.y).toBeGreaterThanOrEqual(
          beBounds.y + DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT
        )
        expect(layout.y + layout.height).toBeLessThanOrEqual(beBounds.y + beBounds.height)
      }
    })

    it('packs disconnected clusters using shelf packing to prevent overlap', () => {
      const nodes: NodeSpec[] = [
        { entity: 'cl-a-1', name: 'Card A1', group: 'ClusterA' },
        { entity: 'cl-a-2', name: 'Card A2', group: 'ClusterA' },
        { entity: 'cl-b-1', name: 'Card B1', group: 'ClusterB' },
        { entity: 'cl-b-2', name: 'Card B2', group: 'ClusterB' }
      ]
      // No inter-cluster edges between ClusterA and ClusterB
      const edges: EdgeSpec[] = [
        { from: 'cl-a-1', to: 'cl-a-2' },
        { from: 'cl-b-1', to: 'cl-b-2' }
      ]

      const result = computeClusterAutoLayout(nodes, edges, 'LR')

      const aBounds = result.clusterBoundsById['ClusterA']
      const bBounds = result.clusterBoundsById['ClusterB']

      expect(aBounds).toBeDefined()
      expect(bBounds).toBeDefined()

      // Bounding boxes must not overlap
      const hasHorizontalOverlap =
        aBounds.x < bBounds.x + bBounds.width && aBounds.x + aBounds.width > bBounds.x
      const hasVerticalOverlap =
        aBounds.y < bBounds.y + bBounds.height && aBounds.y + aBounds.height > bBounds.y

      const isOverlapping = hasHorizontalOverlap && hasVerticalOverlap
      expect(isOverlapping).toBe(false)
    })

    it('arranges clusters without internal edges in a compact grid flow', () => {
      const nodes: NodeSpec[] = [
        { entity: 'tag-1', name: 'Tag 1', group: 'Tags' },
        { entity: 'tag-2', name: 'Tag 2', group: 'Tags' },
        { entity: 'tag-3', name: 'Tag 3', group: 'Tags' },
        { entity: 'tag-4', name: 'Tag 4', group: 'Tags' }
      ]
      // No edges at all
      const result = computeClusterAutoLayout(nodes, [], 'LR')

      const bounds = result.clusterBoundsById['Tags']
      expect(bounds).toBeDefined()
      expect(bounds.nodeCount).toBe(4)

      // All 4 nodes must have distinct coordinates
      const positions = nodes.map((n) => result.layoutByNodeId[n.entity])
      const posKeys = new Set(positions.map((p) => `${p.x},${p.y}`))
      expect(posKeys.size).toBe(4)
    })

    it('respects global anchorX and anchorY offsets', () => {
      const nodes: NodeSpec[] = [
        { entity: 'c1', name: 'Card 1', group: 'G1' },
        { entity: 'c2', name: 'Card 2', group: 'G2' }
      ]
      const edges: EdgeSpec[] = [{ from: 'c1', to: 'c2' }]

      const anchorX = 500
      const anchorY = 300
      const result = computeClusterAutoLayout(nodes, edges, 'LR', anchorX, anchorY)

      const g1 = result.clusterBoundsById['G1']
      expect(g1.x).toBeGreaterThanOrEqual(anchorX)
      expect(g1.y).toBeGreaterThanOrEqual(anchorY)

      const c1Layout = result.layoutByNodeId['c1']
      expect(c1Layout.x).toBeGreaterThanOrEqual(anchorX)
      expect(c1Layout.y).toBeGreaterThanOrEqual(anchorY)
    })

    it('positions connected clusters vertically along macro edges in TD direction', () => {
      const nodes: NodeSpec[] = [
        { entity: 'top-1', name: 'Top Card', group: 'TopCluster' },
        { entity: 'bottom-1', name: 'Bottom Card', group: 'BottomCluster' }
      ]
      const edges: EdgeSpec[] = [{ from: 'top-1', to: 'bottom-1' }]

      const result = computeClusterAutoLayout(nodes, edges, 'TD')

      const topBounds = result.clusterBoundsById['TopCluster']
      const bottomBounds = result.clusterBoundsById['BottomCluster']

      expect(topBounds).toBeDefined()
      expect(bottomBounds).toBeDefined()
      expect(topBounds.y + topBounds.height).toBeLessThanOrEqual(bottomBounds.y)
    })

    it('ensures single-cluster bounds start at positive coordinates at anchor (0, 0)', () => {
      const nodes: NodeSpec[] = [
        { entity: 'solo-1', name: 'Solo 1', group: 'SingleCluster' },
        { entity: 'solo-2', name: 'Solo 2', group: 'SingleCluster' }
      ]
      const edges: EdgeSpec[] = [{ from: 'solo-1', to: 'solo-2' }]

      const result = computeClusterAutoLayout(nodes, edges, 'LR', 0, 0)
      const bounds = result.clusterBoundsById['SingleCluster']

      expect(bounds).toBeDefined()
      expect(bounds.x).toBe(0)
      expect(bounds.y).toBe(0)
      expect(result.layoutByNodeId['solo-1'].x).toBeGreaterThanOrEqual(0)
      expect(result.layoutByNodeId['solo-1'].y).toBeGreaterThanOrEqual(0)
    })
  })
})
