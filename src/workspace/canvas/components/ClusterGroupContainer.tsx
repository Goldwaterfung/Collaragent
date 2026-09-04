import React, { useRef, useState, useCallback, useEffect } from 'react'
import {
  CLUSTER_HEADER_HEIGHT,
  CLUSTER_CONTAINER_Z_INDEX,
  CLUSTER_LABEL_MAX_WIDTH_PX,
  CLUSTER_FILL_OPACITY_PERCENT
} from '@shared/constants'
import { useCanvas } from '../store'
import type { ClusterGroup } from './useClusterGroups'
import type { CanvasCommand } from '../commands/types'
import { asNodeId } from '@workspace/canvas/domain/ids'

export interface ClusterGroupContainerProps {
  group: ClusterGroup
}

export const ClusterGroupContainer: React.FC<ClusterGroupContainerProps> = React.memo(
  ({ group }) => {
    const { state, dispatch, dispatchTransaction } = useCanvas()
    const [isDragging, setIsDragging] = useState(false)
    const lastMousePos = useRef<{ x: number; y: number } | null>(null)
    const stateRef = useRef(state)
    stateRef.current = state

    const handleSelectAll = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        dispatch({
          type: 'SET_SELECTION',
          payload: {
            nodeIds: group.nodeIds.map(asNodeId),
            relationshipIds: []
          }
        })
      },
      [dispatch, group.nodeIds]
    )

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      // Only primary button initiates drag
      if (e.button !== 0) return
      e.stopPropagation()

      setIsDragging(true)
      lastMousePos.current = { x: e.clientX, y: e.clientY }
    }, [])

    useEffect(() => {
      if (!isDragging) return

      const handleMouseMove = (e: MouseEvent) => {
        if (!lastMousePos.current) return

        const currentState = stateRef.current
        const zoom = currentState.ui.viewport.zoom
        const dx = (e.clientX - lastMousePos.current.x) / zoom
        const dy = (e.clientY - lastMousePos.current.y) / zoom

        if (dx === 0 && dy === 0) return

        lastMousePos.current = { x: e.clientX, y: e.clientY }

        const moveCommands: CanvasCommand[] = []
        for (const nodeId of group.nodeIds) {
          const layout = currentState.layout.layoutByNodeId[nodeId]
          if (layout) {
            moveCommands.push({
              type: 'MoveNode',
              payload: {
                nodeId: asNodeId(nodeId),
                x: layout.x + dx,
                y: layout.y + dy
              }
            })
          }
        }

        if (moveCommands.length > 0) {
          dispatchTransaction(moveCommands)
        }
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        lastMousePos.current = null
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)

      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }, [isDragging, group.nodeIds, dispatchTransaction])

    const { x, y, width, height } = group.bounds

    return (
      <div
        style={{
          position: 'absolute',
          transform: `translate3d(${x}px, ${y}px, 0px)`,
          width,
          height,
          borderColor: group.colorVar,
          backgroundColor: `color-mix(in srgb, ${group.colorVar} ${CLUSTER_FILL_OPACITY_PERCENT}%, transparent)`,
          pointerEvents: 'none',
          zIndex: CLUSTER_CONTAINER_Z_INDEX
        }}
        className="rounded-2xl border-2 border-dashed transition-all duration-75"
      >
        {/* Cluster Header / Action Bar */}
        <div
          onMouseDown={handleMouseDown}
          style={{
            height: CLUSTER_HEADER_HEIGHT,
            borderColor: group.colorVar,
            pointerEvents: 'auto'
          }}
          className={`w-full flex items-center justify-between px-3 rounded-t-xl bg-surface-50/80 border-b backdrop-blur-xs select-none ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span
              style={{ backgroundColor: group.colorVar }}
              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
            />
            <span
              style={{ maxWidth: `${CLUSTER_LABEL_MAX_WIDTH_PX}px` }}
              className="text-xs font-semibold text-gray-800 truncate"
            >
              {group.label}
            </span>
            <span className="text-[10px] text-gray-500 font-mono">
              ({group.nodeIds.length} cards)
            </span>
          </div>

          <button
            type="button"
            onClick={handleSelectAll}
            title="Select all cards in this cluster"
            className="text-[10px] font-medium text-gray-600 hover:text-black px-1.5 py-0.5 rounded hover:bg-surface-200/70 transition-colors cursor-pointer focus:outline-none"
          >
            Select All
          </button>
        </div>
      </div>
    )
  }
)
