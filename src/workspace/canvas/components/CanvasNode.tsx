import React, { useState, useRef, useEffect } from 'react'
import type { NodeLayout } from '../types'
import type { CanvasCommand } from '../commands/types'
import { useCanvas } from '../store'
import { NodeFrame } from './NodeFrame'
import { NodeHeader } from './NodeHeader'
import { getClusterColor } from './useClusterGroups'
import { ResizeHandle } from './ResizeHandle'
import { PortContainer } from './PortContainer'
import { createCardinalPorts, type CardinalDirection } from '@workspace/canvas/domain/portUtils'
import { calculateHeaderHeight, NODE_HEADER_MAX_HEIGHT } from './nodeLayout'
import type { NodeEntity, PortEntity } from '@workspace/canvas/domain/types'
import { instanceService } from '@shared/services/InstanceService'
import {
  MIN_NODE_EXPANDED_HEIGHT,
  MAX_NODE_EXPANDED_HEIGHT,
  MIN_NODE_WIDTH,
  MAX_NODE_WIDTH,
  NODE_MEMO_GAP
} from '@shared/constants'

/**
 * Props for a single canvas node component.
 */
interface CanvasNodeProps {
  /** The node domain entity */
  node: NodeEntity
  /** The layout information for the node (position and dimensions) */
  layout: NodeLayout
  /** Child content to render inside the node */
  children: React.ReactNode
}

export const CanvasNode: React.FC<CanvasNodeProps> = ({ node, layout, children }) => {
  const { dispatch, dispatchCommand, dispatchTransaction, state } = useCanvas()
  const isExpanded = !!state.ui.expandedNodeIds[node.id]
  const [isDragging, setIsDragging] = useState(false)
  const [resizeHandle, setResizeHandle] = useState<'s' | 'e' | 'se' | null>(null)
  const lastMousePos = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const hasDraggedRef = useRef<boolean>(false)
  const wasSelectedOnMouseDownRef = useRef<boolean>(false)

  const isSelected = state.ui.selection.nodeIds.includes(node.id)

  const displayName = node.name

  // Local state for the input to avoid jitter while typing
  const [localName, setLocalName] = useState(displayName)

  const nodeWidth = layout.width
  const memoWidth = layout.memoWidth ?? layout.width
  const headerHeight = calculateHeaderHeight(localName, nodeWidth)
  const memoHeight = layout.height

  const clusterDisplayLevel = state.ui.clusterDisplayLevel
  const clusterIdFromPath =
    clusterDisplayLevel !== undefined &&
    Array.isArray(node.attrs?.clusterPath) &&
    typeof node.attrs.clusterPath[clusterDisplayLevel] === 'string' &&
    node.attrs.clusterPath[clusterDisplayLevel].trim().length > 0
      ? node.attrs.clusterPath[clusterDisplayLevel].trim()
      : undefined

  const clusterId =
    clusterIdFromPath ??
    (typeof node.attrs?.clusterId === 'string' && node.attrs.clusterId.trim().length > 0
      ? node.attrs.clusterId.trim()
      : typeof node.attrs?.group === 'string' && node.attrs.group.trim().length > 0
        ? node.attrs.group.trim()
        : undefined)
  const clusterColor = clusterId ? getClusterColor(clusterId) : undefined

  const currentPorts = React.useMemo(
    () => createCardinalPorts(node.id, nodeWidth, headerHeight),
    [node.id, nodeWidth, headerHeight]
  )

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, NODE_HEADER_MAX_HEIGHT)
    textarea.style.height = `${newHeight}px`
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [localName, nodeWidth])

  // Sync local state when external data changes
  useEffect(() => {
    setLocalName(displayName)
  }, [displayName])

  const commitNameUpdate = async () => {
    if (localName !== displayName) {
      dispatchCommand({
        type: 'UpdateNode',
        payload: {
          nodeId: node.id,
          patch: { name: localName }
        }
      })
    }
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation() // Prevent canvas pan, zoom, and delete hotkeys

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitNameUpdate()
      ;(e.target as HTMLTextAreaElement).blur()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setLocalName(displayName)
      ;(e.target as HTMLTextAreaElement).blur()
      return
    }
  }

  const handleTextareaMouseDown = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.stopPropagation() // Allow text selection, prevent node drag
  }

  const handleToggleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handleToggleClick = () => {
    dispatch({ type: 'TOGGLE_EXPAND_NODE', payload: { nodeId: node.id } })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent canvas panning
    if (e.button !== 0) return

    hasDraggedRef.current = false
    wasSelectedOnMouseDownRef.current = isSelected

    if (e.shiftKey) {
      dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: true } })
    } else {
      if (!isSelected) {
        dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: false } })
      }
    }

    // Start dragging immediately on selection (unified behavior)
    setIsDragging(true)
    lastMousePos.current = { x: e.clientX, y: e.clientY }
  }

  const handleResizeStart = (e: React.MouseEvent, handle: 's' | 'e' | 'se') => {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return

    setResizeHandle(handle)
    lastMousePos.current = { x: e.clientX, y: e.clientY }
  }

  /**
   * Handles completing a connection when releasing mouse on this node.
   */
  const handleMouseUp = () => {
    if (state.ui.interaction.connect.status !== 'connecting') return

    // We rely on the global viewport handler to clear the interaction state (CancelConnect),
    // so we only need to dispatch the data mutation here.
    const fromNodeId = state.ui.interaction.connect.fromNodeId
    if (!fromNodeId) return

    dispatchCommand({
      type: 'AddRelationship',
      payload: {
        relationship: {
          id: instanceService.createRelationshipId(),
          from: { nodeId: fromNodeId },
          to: { nodeId: node.id },
          attrs: {}
        }
      }
    })
  }

  /**
   * Handles starting a connection from a port.
   * Calculates the absolute canvas position and dispatches StartConnect.
   */
  const handlePortDragStart = (
    _e: React.MouseEvent,
    port: PortEntity,
    _direction: CardinalDirection
  ) => {
    dispatchCommand({
      type: 'StartConnect',
      payload: {
        fromNodeId: node.id,
        start: {
          x: layout.x + port.relativePosition.x,
          y: layout.y + port.relativePosition.y
        }
      }
    })
  }

  useEffect(() => {
    if (!isDragging && !resizeHandle) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!lastMousePos.current) return
      const currentState = stateRef.current
      const dx = (e.clientX - lastMousePos.current.x) / currentState.ui.viewport.zoom
      const dy = (e.clientY - lastMousePos.current.y) / currentState.ui.viewport.zoom

      if (dx !== 0 || dy !== 0) {
        hasDraggedRef.current = true
      }

      if (isDragging) {
        const isMultiSelected = isSelected && currentState.ui.selection.nodeIds.length > 1
        if (isMultiSelected) {
          const moveCommands: CanvasCommand[] = []
          for (const selectedNodeId of currentState.ui.selection.nodeIds) {
            const nodeLayout = currentState.layout.layoutByNodeId[selectedNodeId]
            if (nodeLayout) {
              moveCommands.push({
                type: 'MoveNode',
                payload: {
                  nodeId: selectedNodeId,
                  x: nodeLayout.x + dx,
                  y: nodeLayout.y + dy
                }
              })
            }
          }
          if (moveCommands.length > 0) {
            dispatchTransaction(moveCommands)
          }
        } else {
          const currentLayout = layoutRef.current
          dispatchCommand({
            type: 'MoveNode',
            payload: {
              nodeId: node.id,
              x: currentLayout.x + dx,
              y: currentLayout.y + dy
            }
          })
        }
      } else if (resizeHandle) {
        const currentLayout = layoutRef.current
        let newHeight = currentLayout.height
        let newMemoWidth = currentLayout.memoWidth ?? currentLayout.width

        if (resizeHandle.includes('s')) {
          newHeight = Math.min(
            MAX_NODE_EXPANDED_HEIGHT,
            Math.max(MIN_NODE_EXPANDED_HEIGHT, currentLayout.height + dy)
          )
        }
        if (resizeHandle.includes('e')) {
          newMemoWidth = Math.min(
            MAX_NODE_WIDTH,
            Math.max(MIN_NODE_WIDTH, (currentLayout.memoWidth ?? currentLayout.width) + dx)
          )
        }

        dispatchCommand({
          type: 'ResizeNode',
          payload: {
            nodeId: node.id,
            x: currentLayout.x,
            y: currentLayout.y,
            width: currentLayout.width,
            height: newHeight,
            memoWidth: newMemoWidth
          }
        })
      }

      lastMousePos.current = { x: e.clientX, y: e.clientY }
    }

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDragging) {
        if (
          !hasDraggedRef.current &&
          !e.shiftKey &&
          wasSelectedOnMouseDownRef.current &&
          stateRef.current.ui.selection.nodeIds.length > 1
        ) {
          dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: false } })
        }
      }
      setIsDragging(false)
      setResizeHandle(null)
      lastMousePos.current = null
      hasDraggedRef.current = false
      wasSelectedOnMouseDownRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [
    isDragging,
    resizeHandle,
    node.id,
    isSelected,
    isExpanded,
    localName,
    dispatch,
    dispatchCommand,
    dispatchTransaction
  ])

  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      style={{
        position: 'absolute',
        left: layout.x,
        top: layout.y,
        pointerEvents: 'none',
        zIndex: isSelected ? 20 : 10
      }}
      data-canvas-node="true"
      data-canvas-node-id={node.id}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. Node Card containing Cardinal Ports */}
      <PortContainer
        nodeId={node.id}
        x={0}
        y={0}
        width={nodeWidth}
        height={headerHeight}
        ports={currentPorts}
        onPortDragStart={handlePortDragStart}
        style={{ position: 'relative' }}
      >
        <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
          <NodeFrame
            selected={isSelected}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            style={{ width: nodeWidth, height: headerHeight }}
          >
            <NodeHeader
              selected={isSelected}
              clusterColor={clusterColor}
              clusterId={clusterId}
              style={{ minHeight: headerHeight, height: '100%' }}
              className="flex items-center justify-between px-3 gap-2 h-full"
            >
              <button
                type="button"
                onMouseDown={handleToggleMouseDown}
                onClick={handleToggleClick}
                className="p-1 rounded-md text-gray-500 hover:text-black hover:bg-surface-200 transition-colors flex items-center justify-center shrink-0 cursor-pointer focus:outline-none"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                title={isExpanded ? 'Collapse Card' : 'Expand Card'}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                  className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <path
                    d="M3 5L7 9L11 5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <div className="flex-1 min-w-0 flex items-center justify-center">
                <textarea
                  ref={textareaRef}
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={commitNameUpdate}
                  onKeyDown={handleTextareaKeyDown}
                  onMouseDown={handleTextareaMouseDown}
                  rows={1}
                  className="w-full bg-transparent font-semibold text-base text-[var(--ev-c-text-1)] text-center resize-none outline-none focus:ring-1 focus:ring-primary/60 rounded px-1 leading-snug break-words overflow-y-auto"
                  style={{
                    cursor: isSelected ? 'text' : 'grab',
                    pointerEvents: isSelected ? 'auto' : 'none',
                    maxHeight: `${NODE_HEADER_MAX_HEIGHT}px`
                  }}
                />
              </div>

              <div className="w-5 shrink-0 flex items-center justify-end">
                {clusterColor && (
                  <span
                    style={{ backgroundColor: clusterColor }}
                    className="w-2 h-2 rounded-full shadow-xs"
                    title={`Cluster: ${clusterId}`}
                  />
                )}
              </div>
            </NodeHeader>
          </NodeFrame>
        </div>
      </PortContainer>

      {/* 2. Decoupled Memo Editor (Lexical Editor) */}
      {isExpanded && (
        <div
          style={{
            position: 'absolute',
            top: headerHeight + NODE_MEMO_GAP,
            left: 0,
            width: memoWidth,
            height: memoHeight,
            pointerEvents: 'auto',
            zIndex: 15
          }}
          className={`rounded-xl overflow-hidden flex flex-col border bg-white transition-shadow duration-150 ${
            isSelected
              ? 'ring-2 ring-primary/80 shadow-xl border-primary'
              : 'shadow-md hover:shadow-lg hover:border-primary/60 border-surface-200'
          }`}
          onMouseDown={(e) => {
            e.stopPropagation()
            if (e.button !== 0) return
            if (!isSelected) {
              dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: e.shiftKey } })
            }
          }}
          onMouseUp={handleMouseUp}
        >
          {/* Memo Header Label Bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-surface-100 border-b border-surface-200 select-none shrink-0">
            <div className="flex items-center gap-1.5 text-gray-700 text-xs font-medium">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>Memo</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">
              {Math.round(memoWidth)} × {Math.round(memoHeight)}
            </span>
          </div>

          {/* Lexical Editor Content */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {children}
          </div>

          {(isSelected || isHovered) && (
            <>
              <ResizeHandle position="s" onMouseDown={(e) => handleResizeStart(e, 's')} />
              <ResizeHandle position="e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
              <ResizeHandle position="se" onMouseDown={(e) => handleResizeStart(e, 'se')} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
