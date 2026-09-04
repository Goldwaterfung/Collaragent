import { describe, it, expect } from 'vitest'
import { deriveClusterGroups } from '../useClusterGroups'
import { asNodeId } from '@workspace/canvas/domain'
import type { NodeEntity } from '@shared/canvas/entities'
import type { NodeLayout } from '@workspace/canvas/domain/types'
import { DEFAULT_CLUSTER_PADDING, CLUSTER_HEADER_HEIGHT } from '@shared/constants'

describe('useClusterGroups / deriveClusterGroups', () => {
  const n1 = asNodeId('n1')
  const n2 = asNodeId('n2')
  const n3 = asNodeId('n3')

  const sampleNodes: Record<string, NodeEntity> = {
    [n1]: {
      id: n1,
      type: 'card',
      name: 'Node 1',
      attrs: {
        clusterId: 'L1:0',
        clusterPath: ['L0:1', 'L1:0']
      },
      ports: {}
    },
    [n2]: {
      id: n2,
      type: 'card',
      name: 'Node 2',
      attrs: {
        clusterId: 'L1:0',
        clusterPath: ['L0:2', 'L1:0']
      },
      ports: {}
    },
    [n3]: {
      id: n3,
      type: 'card',
      name: 'Node 3',
      attrs: {
        clusterId: 'L1:1',
        clusterPath: ['L0:3', 'L1:1']
      },
      ports: {}
    }
  }

  const sampleLayouts: Record<string, NodeLayout> = {
    [n1]: { x: 100, y: 100, width: 200, height: 100 },
    [n2]: { x: 350, y: 100, width: 200, height: 100 },
    [n3]: { x: 700, y: 100, width: 200, height: 100 }
  }

  it('partitions nodes by default clusterId when displayLevel is undefined', () => {
    const groups = deriveClusterGroups(sampleNodes, sampleLayouts)

    expect(groups).toHaveLength(2)
    expect(groups[0].clusterId).toBe('L1:0')
    expect(groups[0].nodeIds).toEqual(['n1', 'n2'])
    expect(groups[1].clusterId).toBe('L1:1')
    expect(groups[1].nodeIds).toEqual(['n3'])

    // Check bounds calculation for L1:0 encompassing n1 and n2
    const expectedX = 100 - DEFAULT_CLUSTER_PADDING
    const expectedY = 100 - DEFAULT_CLUSTER_PADDING - CLUSTER_HEADER_HEIGHT
    const expectedWidth = 350 + 200 - 100 + 2 * DEFAULT_CLUSTER_PADDING
    const expectedHeight = 100 + 2 * DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT

    expect(groups[0].bounds).toEqual({
      x: expectedX,
      y: expectedY,
      width: expectedWidth,
      height: expectedHeight
    })
  })

  it('partitions nodes by fine-grained L0 level when displayLevel = 0', () => {
    const groups = deriveClusterGroups(sampleNodes, sampleLayouts, 0)

    // At level 0, each node has its own subcluster (L0:1, L0:2, L0:3)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.clusterId)).toEqual(['L0:1', 'L0:2', 'L0:3'])
    expect(groups[0].nodeIds).toEqual(['n1'])
    expect(groups[1].nodeIds).toEqual(['n2'])
    expect(groups[2].nodeIds).toEqual(['n3'])
  })

  it('partitions nodes by coarse L1 level when displayLevel = 1', () => {
    const groups = deriveClusterGroups(sampleNodes, sampleLayouts, 1)

    // At level 1, n1 and n2 merge into L1:0, n3 in L1:1
    expect(groups).toHaveLength(2)
    expect(groups[0].clusterId).toBe('L1:0')
    expect(groups[0].nodeIds).toEqual(['n1', 'n2'])
    expect(groups[1].clusterId).toBe('L1:1')
    expect(groups[1].nodeIds).toEqual(['n3'])
  })

  it('falls back to node.attrs.clusterId when displayLevel is out of bounds', () => {
    const groups = deriveClusterGroups(sampleNodes, sampleLayouts, 99)

    expect(groups).toHaveLength(2)
    expect(groups[0].clusterId).toBe('L1:0')
    expect(groups[1].clusterId).toBe('L1:1')
  })

  it('ignores nodes with __unassigned__ or missing cluster attributes', () => {
    const unassignedId = asNodeId('unassigned')
    const nodesWithUnassigned: Record<string, NodeEntity> = {
      ...sampleNodes,
      [unassignedId]: {
        id: unassignedId,
        type: 'card',
        name: 'Unassigned',
        attrs: { clusterId: '__unassigned__' },
        ports: {}
      }
    }
    const layoutsWithUnassigned: Record<string, NodeLayout> = {
      ...sampleLayouts,
      [unassignedId]: { x: 0, y: 0, width: 100, height: 100 }
    }

    const groups = deriveClusterGroups(nodesWithUnassigned, layoutsWithUnassigned)
    expect(groups.some((g) => g.nodeIds.includes('unassigned'))).toBe(false)
  })
})
