import { describe, it, expect } from 'vitest'
import { computeVerticalPushDown } from '../domain/collision'
import { asNodeId } from '../domain/ids'
import type { NodeLayout, NodeEntity } from '../domain/types'
import { NODE_COLLISION_MARGIN } from '@shared/constants'

describe('Collision Engine - computeVerticalPushDown', () => {
  const createMockNode = (id: string, name: string): NodeEntity => ({
    id: asNodeId(id),
    type: 'card',
    name,
    attrs: {},
    ports: {}
  })

  it('pushes downstream node downward when expanding node overlaps vertically', () => {
    const layoutByNodeId: Record<string, NodeLayout> = {
      'node-a': { x: 100, y: 100, width: 300, height: 200 },
      'node-b': { x: 100, y: 200, width: 300, height: 100 }
    }
    const nodesById: Record<string, NodeEntity> = {
      'node-a': createMockNode('node-a', 'Node A'),
      'node-b': createMockNode('node-b', 'Node B')
    }

    // Node A expands to new visible height 250
    // Node A bottom is 100 + 250 = 350. With margin 32, obstacle bottom is 382.
    // Node B is at y = 200, so it should be pushed down to 382.
    const shifts = computeVerticalPushDown(
      'node-a',
      250,
      layoutByNodeId,
      nodesById,
      {},
      NODE_COLLISION_MARGIN
    )

    expect(shifts).toHaveLength(1)
    expect(shifts[0]).toEqual({
      nodeId: asNodeId('node-b'),
      x: 100,
      y: 382
    })
  })

  it('cascades push-down transitively across multiple downstream nodes', () => {
    const layoutByNodeId: Record<string, NodeLayout> = {
      'node-a': { x: 100, y: 100, width: 300, height: 200 },
      'node-b': { x: 100, y: 200, width: 300, height: 100 },
      'node-c': { x: 100, y: 400, width: 300, height: 100 }
    }
    const nodesById: Record<string, NodeEntity> = {
      'node-a': createMockNode('node-a', 'Node A'),
      'node-b': createMockNode('node-b', 'Node B'),
      'node-c': createMockNode('node-c', 'Node C')
    }

    // Node A expands to 250 -> pushes B to 382.
    // Node B is collapsed: visible height = calculateHeaderHeight('Node B', 300) = 56.
    // Node B bottom = 382 + 56 + 32 = 470.
    // Node C is at 400 < 470, so Node C is pushed to 470.
    const shifts = computeVerticalPushDown(
      'node-a',
      250,
      layoutByNodeId,
      nodesById,
      {},
      NODE_COLLISION_MARGIN
    )

    expect(shifts).toHaveLength(2)
    expect(shifts).toContainEqual({
      nodeId: asNodeId('node-b'),
      x: 100,
      y: 382
    })
    expect(shifts.find((s) => s.nodeId === asNodeId('node-c'))?.y).toBe(470)
  })

  it('does not push nodes that are horizontally outside the collision margin', () => {
    const layoutByNodeId: Record<string, NodeLayout> = {
      'node-a': { x: 100, y: 100, width: 300, height: 200 },
      'node-b': { x: 450, y: 200, width: 300, height: 100 } // x = 450 > 100 + 300 + 32 (432)
    }
    const nodesById: Record<string, NodeEntity> = {
      'node-a': createMockNode('node-a', 'Node A'),
      'node-b': createMockNode('node-b', 'Node B')
    }

    const shifts = computeVerticalPushDown(
      'node-a',
      250,
      layoutByNodeId,
      nodesById,
      {},
      NODE_COLLISION_MARGIN
    )

    expect(shifts).toHaveLength(0)
  })

  it('does not push nodes located above the expanding node', () => {
    const layoutByNodeId: Record<string, NodeLayout> = {
      'node-a': { x: 100, y: 300, width: 300, height: 200 },
      'node-above': { x: 100, y: 50, width: 300, height: 100 }
    }
    const nodesById: Record<string, NodeEntity> = {
      'node-a': createMockNode('node-a', 'Node A'),
      'node-above': createMockNode('node-above', 'Node Above')
    }

    const shifts = computeVerticalPushDown(
      'node-a',
      250,
      layoutByNodeId,
      nodesById,
      {},
      NODE_COLLISION_MARGIN
    )

    expect(shifts).toHaveLength(0)
  })

  it('returns empty array if expanding node is not found', () => {
    const shifts = computeVerticalPushDown('non-existent', 250, {}, {})
    expect(shifts).toEqual([])
  })
})
