import React, { useState, useRef, useEffect } from 'react'
import type { NodeLayout } from '../types'
import type { CanvasCommand } from '../commands/types'
import { useCanvas } from '../store'
import { NodeFrame } from './NodeFrame'
import { NodeHeader } from './NodeHeader'
import { ResizeHandle } from './ResizeHandle'
import { PortContainer } from './PortContainer'
import { createCardinalPorts, type CardinalDirection } from '@workspace/canvas/domain/portUtils'
import { calculateHeaderHeight, NODE_HEADER_MAX_HEIGHT } from './nodeLayout'
import type { NodeEntity, PortEntity } from '@workspace/canvas/domain/types'
import { instanceService } from '@shared/services/InstanceService'
import { MIN_NODE_EXPANDED_HEIGHT, MAX_NODE_EXPANDED_HEIGHT } from '@shared/constants'
import { computeVerticalPushDown } from '@workspace/canvas/domain'

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
  const [resizeHandle, setResizeHandle] = useState<'s' | null>(null)
  const lastMousePos = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const hasDraggedRef = useRef<boolean>(false)
  const wasSelectedOnMouseDownRef = useRef<boolean>(false)
  const initialResizeHeightRef = useRef<number>(layout.height)

  const isSelected = state.ui.selection.nodeIds.includes(node.id)

  const displayName = node.name

  // Local state for the input to avoid jitter while typing
  const [localName, setLocalName] = useState(displayName)

  const headerWidth = layout.width
  const headerHeight = calculateHeaderHeight(localName, headerWidth)
  const visibleHeight = isExpanded ? headerHeight + layout.height : headerHeight

  const headerPorts = React.useMemo(
    () => createCardinalPorts(node.id, headerWidth, visibleHeight),
    [node.id, headerWidth, visibleHeight]
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
  }, [localName, headerWidth])

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
    if (!isExpanded) {
      const targetVisibleHeight = headerHeight + layout.height
      const shifts = computeVerticalPushDown(
        node.id,
        targetVisibleHeight,
        state.layout.layoutByNodeId,
        state.domain.graph.nodesById,
        state.ui.expandedNodeIds
      )
      if (shifts.length > 0) {
        const moveCommands: CanvasCommand[] = shifts.map((s) => ({
          type: 'MoveNode',
          payload: { nodeId: s.nodeId, x: s.x, y: s.y }
        }))
        dispatchTransaction(moveCommands)
      }
    }
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

  const handleResizeStart = (e: React.MouseEvent, handle: 's') => {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return

    initialResizeHeightRef.current = layoutRef.current.height
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
        const newWidth = currentLayout.width
        const newX = currentLayout.x
        const newY = currentLayout.y

        const newHeight = Math.min(
          MAX_NODE_EXPANDED_HEIGHT,
          Math.max(MIN_NODE_EXPANDED_HEIGHT, currentLayout.height + dy)
        )

        dispatchCommand({
          type: 'ResizeNode',
          payload: {
            nodeId: node.id,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
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
      } else if (resizeHandle) {
        const currentState = stateRef.current
        const currentLayout = currentState.layout.layoutByNodeId[node.id] ?? layoutRef.current
        if (currentLayout.height !== initialResizeHeightRef.current) {
          const currentHeaderHeight = calculateHeaderHeight(localName, currentLayout.width)
          const visibleHeight = isExpanded
            ? currentHeaderHeight + currentLayout.height
            : currentHeaderHeight
          const shifts = computeVerticalPushDown(
            node.id,
            visibleHeight,
            currentState.layout.layoutByNodeId,
            currentState.domain.graph.nodesById,
            currentState.ui.expandedNodeIds
          )
          if (shifts.length > 0) {
            const moveCommands: CanvasCommand[] = shifts.map((s) => ({
              type: 'MoveNode',
              payload: { nodeId: s.nodeId, x: s.x, y: s.y }
            }))
            dispatchTransaction(moveCommands)
          }
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
    <PortContainer
      nodeId={node.id}
      x={layout.x}
      y={layout.y}
      width={headerWidth}
      height={visibleHeight}
      ports={headerPorts}
      onPortDragStart={handlePortDragStart}
      data-canvas-node="true"
      data-canvas-node-id={node.id}
    >
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: 'auto' }}
      >
        <NodeFrame
          selected={isSelected}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          style={{ width: headerWidth, height: '100%' }}
        >
          <NodeHeader
            selected={isSelected}
            style={{ minHeight: headerHeight, height: isExpanded ? headerHeight : '100%' }}
            className={`flex items-center justify-between px-3 gap-2 ${isExpanded ? 'shrink-0' : 'h-full'}`}
          >
            <button
              type="button"
              onMouseDown={handleToggleMouseDown}
              onClick={handleToggleClick}
              className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex items-center justify-center shrink-0"
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
                className="w-full bg-transparent font-semibold text-base text-neutral-800 dark:text-neutral-100 text-center resize-none outline-none focus:ring-1 focus:ring-blue-400/50 rounded px-1 leading-snug break-words overflow-y-auto"
                style={{
                  cursor: isSelected ? 'text' : 'grab',
                  pointerEvents: isSelected ? 'auto' : 'none',
                  maxHeight: `${NODE_HEADER_MAX_HEIGHT}px`
                }}
              />
            </div>

            <div className="w-5 shrink-0" />
          </NodeHeader>

          {isExpanded && (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                position: 'relative',
                pointerEvents: 'auto'
              }}
              className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden flex flex-col"
              onMouseDown={(e) => {
                e.stopPropagation()
                if (e.button !== 0) return
                if (!isSelected) {
                  dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: e.shiftKey } })
                }
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'auto'
                }}
              >
                {children}
              </div>

              {(isSelected || isHovered) && (
                <ResizeHandle position="s" onMouseDown={(e) => handleResizeStart(e, 's')} />
              )}
            </div>
          )}
        </NodeFrame>
      </div>
    </PortContainer>
  )
}
