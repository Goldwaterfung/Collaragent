import type { NodeLayout, NodeEntity } from './types'
import { asNodeId, type NodeId } from './ids'
import { calculateHeaderHeight } from '../components/nodeLayout'
import { NODE_COLLISION_MARGIN } from '@shared/constants'

export interface CollisionShift {
  nodeId: NodeId
  x: number
  y: number
}

interface Obstacle {
  id: string
  x1: number
  x2: number
  yTop: number
  bottom: number
}

/**
 * Pure calculation function that determines the vertical push-down displacements
 * for downstream colliding nodes when a node expands or resizes vertically.
 */
export function computeVerticalPushDown(
  expandingNodeId: string,
  newVisibleHeight: number,
  layoutByNodeId: Record<string, NodeLayout>,
  nodesById: Record<string, NodeEntity>,
  expandedNodeIds: Record<string, boolean> = {},
  margin: number = NODE_COLLISION_MARGIN
): CollisionShift[] {
  const layoutA = layoutByNodeId[expandingNodeId]
  if (!layoutA) {
    return []
  }

  const currentYByNodeId = new Map<string, number>()
  for (const [id, layout] of Object.entries(layoutByNodeId)) {
    currentYByNodeId.set(id, layout.y)
  }

  const queue: Obstacle[] = [
    {
      id: expandingNodeId,
      x1: layoutA.x,
      x2: layoutA.x + layoutA.width,
      yTop: layoutA.y,
      bottom: layoutA.y + newVisibleHeight + margin
    }
  ]

  while (queue.length > 0) {
    const obstacle = queue.shift()
    if (!obstacle) {
      break
    }

    for (const [id, layoutB] of Object.entries(layoutByNodeId)) {
      if (id === obstacle.id) {
        continue
      }

      const overlapsX =
        Math.max(obstacle.x1, layoutB.x) < Math.min(obstacle.x2, layoutB.x + layoutB.width) + margin

      const currentYB = currentYByNodeId.get(id) ?? layoutB.y
      const isBelowObstacleTop = currentYB >= obstacle.yTop

      if (overlapsX && isBelowObstacleTop && currentYB < obstacle.bottom) {
        const shift = obstacle.bottom - currentYB
        const newYB = currentYB + shift
        currentYByNodeId.set(id, newYB)

        const isBExpanded = !!expandedNodeIds[id]
        const headerHB = calculateHeaderHeight(nodesById[id]?.name ?? '', layoutB.width)
        const visibleHB = isBExpanded ? headerHB + layoutB.height : headerHB

        queue.push({
          id,
          x1: layoutB.x,
          x2: layoutB.x + layoutB.width,
          yTop: newYB,
          bottom: newYB + visibleHB + margin
        })
      }
    }
  }

  const shifts: CollisionShift[] = []
  for (const [id, initialLayout] of Object.entries(layoutByNodeId)) {
    const currentY = currentYByNodeId.get(id)
    if (currentY !== undefined && currentY !== initialLayout.y) {
      shifts.push({
        nodeId: asNodeId(id),
        x: initialLayout.x,
        y: currentY
      })
    }
  }

  return shifts
}
