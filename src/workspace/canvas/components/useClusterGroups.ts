import { useMemo } from 'react'
import {
  DEFAULT_CLUSTER_PADDING,
  CLUSTER_HEADER_HEIGHT,
  DEFAULT_CLUSTER_PALETTE
} from '@shared/constants'
import type { NodeEntity } from '@shared/canvas/entities'
import type { NodeLayout } from '@workspace/canvas/domain/types'

export interface ClusterBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ClusterGroup {
  clusterId: string
  label: string
  nodeIds: string[]
  colorVar: string
  bounds: ClusterBounds
}

/**
 * Deterministically derives a palette token (var(--color-cluster-N))
 * based on a stable hash of the cluster ID.
 */
export function getClusterColor(clusterId: string): string {
  let hash = 0
  for (let i = 0; i < clusterId.length; i++) {
    hash = (hash << 5) - hash + clusterId.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % DEFAULT_CLUSTER_PALETTE.length
  return DEFAULT_CLUSTER_PALETTE[index]
}

/**
 * Pure calculation function that inspects canvas domain nodes and layout records
 * to derive visual cluster envelopes and membership lists.
 * Optionally projects community assignments from a specific hierarchical level
 * (L0, L1, L2, etc.) from `node.attrs.clusterPath`.
 */
export function deriveClusterGroups(
  nodesById: Record<string, NodeEntity>,
  layoutByNodeId: Record<string, NodeLayout>,
  displayLevel?: number
): ClusterGroup[] {
  const clusterMap = new Map<string, string[]>()

  // 1. Partition nodes by clusterId (or clusterPath[displayLevel])
  for (const [nodeId, node] of Object.entries(nodesById)) {
    let clusterId: string | undefined

    if (
      displayLevel !== undefined &&
      Array.isArray(node.attrs?.clusterPath) &&
      typeof node.attrs.clusterPath[displayLevel] === 'string' &&
      node.attrs.clusterPath[displayLevel].trim().length > 0
    ) {
      clusterId = node.attrs.clusterPath[displayLevel].trim()
    } else if (
      typeof node.attrs?.clusterId === 'string' &&
      node.attrs.clusterId.trim().length > 0
    ) {
      clusterId = node.attrs.clusterId.trim()
    } else if (typeof node.attrs?.group === 'string' && node.attrs.group.trim().length > 0) {
      clusterId = node.attrs.group.trim()
    }

    if (clusterId && clusterId !== '__unassigned__') {
      const list = clusterMap.get(clusterId) ?? []
      list.push(nodeId)
      clusterMap.set(clusterId, list)
    }
  }

  const groups: ClusterGroup[] = []

  // 2. Compute aggregate bounding boxes for each cluster
  for (const [clusterId, memberIds] of clusterMap.entries()) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    let hasValidMember = false

    for (const nodeId of memberIds) {
      const layout = layoutByNodeId[nodeId]
      if (!layout) continue

      hasValidMember = true
      if (layout.x < minX) minX = layout.x
      if (layout.y < minY) minY = layout.y
      const right = layout.x + layout.width
      const bottom = layout.y + layout.height
      if (right > maxX) maxX = right
      if (bottom > maxY) maxY = bottom
    }

    if (!hasValidMember || minX === Infinity || minY === Infinity) {
      continue
    }

    const x = minX - DEFAULT_CLUSTER_PADDING
    const y = minY - DEFAULT_CLUSTER_PADDING - CLUSTER_HEADER_HEIGHT
    const width = maxX - minX + 2 * DEFAULT_CLUSTER_PADDING
    const height = maxY - minY + 2 * DEFAULT_CLUSTER_PADDING + CLUSTER_HEADER_HEIGHT

    groups.push({
      clusterId,
      label: clusterId,
      nodeIds: memberIds,
      colorVar: getClusterColor(clusterId),
      bounds: { x, y, width, height }
    })
  }

  // Sort by clusterId for deterministic render order
  return groups.sort((a, b) => a.clusterId.localeCompare(b.clusterId))
}

/**
 * React hook wrapper around deriveClusterGroups.
 */
export function useClusterGroups(
  nodesById: Record<string, NodeEntity>,
  layoutByNodeId: Record<string, NodeLayout>,
  displayLevel?: number
): ClusterGroup[] {
  return useMemo(
    () => deriveClusterGroups(nodesById, layoutByNodeId, displayLevel),
    [nodesById, layoutByNodeId, displayLevel]
  )
}
