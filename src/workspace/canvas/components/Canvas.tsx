import React, { useRef, useEffect, useState, useMemo } from 'react'
import { useCanvas } from '../store'
import { CanvasNode } from './CanvasNode'
import { Edge } from './Edge'
import { EdgePath } from './EdgePath'
import { CanvasBackground } from './CanvasBackground'
import { CanvasToolbar } from './CanvasToolbar'
import { MemoEditor } from '../../editor/components/MemoEditor'
import CanvasWebSocketSyncPlugin from '@workspace/sync/CanvasSyncPlugin'
import { serializeCanvas } from '@workspace/persistence/canvasSerialization'
import { runHierarchicalLeidenOnDto } from '../domain/analysis/clustering/leiden'
import { runHierarchicalLeidenOnDtoInWorker } from '../domain/analysis/clustering/leiden/workerClient'
import { instanceService } from '@shared/services/InstanceService'
import { createCardinalPorts } from '../domain/portUtils'
import { calculateHeaderHeight } from './nodeLayout'
import { asNodeId, type NodeId } from '../domain/ids'
import type { CanvasCommand } from '../commands/types'

export const Canvas: React.FC<{ children?: React.ReactNode }> = ({}) => {
  const { state, dispatch, dispatchCommand, dispatchTransaction } = useCanvas()
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [marquee, setMarquee] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const lastMousePos = useRef<{ x: number; y: number } | null>(null)
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const leidenAbortRef = useRef<AbortController | null>(null)

  const connect = state.ui.interaction.connect

  const isEmpty = useMemo(
    () => Object.keys(state.domain.graph.nodesById).length === 0,
    [state.domain.graph.nodesById]
  )

  const handleWheel = (e: WheelEvent) => {
    // Allow scrolling within editor cards unless Ctrl/Cmd is held for zoom
    const target = e.target as HTMLElement
    if (target.closest('.editor-container') && !e.ctrlKey && !e.metaKey) {
      return
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        dispatch({
          type: 'ZOOM',
          payload: {
            factor: zoomFactor,
            center: {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top
            }
          }
        })
      }
    } else {
      e.preventDefault()
      // Standard Pan with mouse wheel or trackpad two-finger scroll
      dispatch({
        type: 'PAN',
        payload: {
          x: -e.deltaX,
          y: -e.deltaY
        }
      })
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey && e.button === 0) {
      // Shift + Left Click on canvas background starts marquee selection
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const screenX = e.clientX - rect.left
        const screenY = e.clientY - rect.top
        setMarquee({ startX: screenX, startY: screenY, currentX: screenX, currentY: screenY })
      }
      return
    }

    if (e.button === 0 || e.button === 1) {
      // Left or Middle click
      dispatch({ type: 'DESELECT_ALL' })
      setIsDragging(true)
      lastMousePos.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (marquee) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        setMarquee((prev) =>
          prev ? { ...prev, currentX: e.clientX - rect.left, currentY: e.clientY - rect.top } : null
        )
      }
    } else if (connect.status === 'connecting') {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        dispatchCommand({
          type: 'UpdateConnectCursor',
          payload: {
            point: {
              x: (e.clientX - rect.left - state.ui.viewport.x) / state.ui.viewport.zoom,
              y: (e.clientY - rect.top - state.ui.viewport.y) / state.ui.viewport.zoom
            }
          }
        })
      }
    } else if (isDragging && lastMousePos.current) {
      const dx = e.clientX - lastMousePos.current.x
      const dy = e.clientY - lastMousePos.current.y

      dispatch({
        type: 'PAN',
        payload: { x: dx, y: dy }
      })

      lastMousePos.current = { x: e.clientX, y: e.clientY }
    }
  }

  const handleMouseUp = (e: MouseEvent) => {
    if (marquee) {
      // Calculate marquee box in canvas world coordinates
      const x1 = Math.min(marquee.startX, marquee.currentX)
      const x2 = Math.max(marquee.startX, marquee.currentX)
      const y1 = Math.min(marquee.startY, marquee.currentY)
      const y2 = Math.max(marquee.startY, marquee.currentY)

      // Only perform selection if marquee was dragged more than a minimal threshold
      if (Math.abs(x2 - x1) > 4 || Math.abs(y2 - y1) > 4) {
        const worldX1 = (x1 - state.ui.viewport.x) / state.ui.viewport.zoom
        const worldX2 = (x2 - state.ui.viewport.x) / state.ui.viewport.zoom
        const worldY1 = (y1 - state.ui.viewport.y) / state.ui.viewport.zoom
        const worldY2 = (y2 - state.ui.viewport.y) / state.ui.viewport.zoom

        const selectedNodeIds: NodeId[] = []
        for (const [nodeId, layout] of Object.entries(state.layout.layoutByNodeId)) {
          const nodeX2 = layout.x + layout.width
          const nodeY2 = layout.y + layout.height
          const intersects = !(
            layout.x > worldX2 ||
            nodeX2 < worldX1 ||
            layout.y > worldY2 ||
            nodeY2 < worldY1
          )
          if (intersects) {
            selectedNodeIds.push(asNodeId(nodeId))
          }
        }

        dispatch({
          type: 'SET_SELECTION',
          payload: { nodeIds: selectedNodeIds, relationshipIds: [] }
        })
      }

      setMarquee(null)
    }

    setIsDragging(false)
    lastMousePos.current = null

    if (connect.status === 'connecting' && connect.fromNodeId) {
      const target = e.target
      const releasedOnNode =
        target instanceof Element && !!target.closest('[data-canvas-node="true"]')

      // If the user releases on a node, the node-level handler will create the edge.
      // If the user releases on empty canvas, create a new node and connect to it.
      if (!releasedOnNode) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const x = (e.clientX - rect.left - state.ui.viewport.x) / state.ui.viewport.zoom
          const y = (e.clientY - rect.top - state.ui.viewport.y) / state.ui.viewport.zoom

          ;(async () => {
            const fromNodeId = connect.fromNodeId
            if (!fromNodeId) return

            const newNodeId = instanceService.createNodeId()

            dispatchTransaction([
              {
                type: 'CreateNode',
                payload: {
                  nodeId: newNodeId,
                  name: 'New Node',
                  x,
                  y,
                  width: 600,
                  height: 400,
                  attrs: { memo: '' }
                }
              },
              {
                type: 'ResizeNode',
                payload: {
                  nodeId: newNodeId,
                  x,
                  y,
                  width: 600,
                  height: 400
                }
              },
              {
                type: 'AddRelationship',
                payload: {
                  relationship: {
                    id: instanceService.createRelationshipId(),
                    from: { nodeId: fromNodeId },
                    to: { nodeId: newNodeId },
                    attrs: {}
                  }
                }
              }
            ])
          })()
        }
      }

      dispatchCommand({ type: 'CancelConnect' })
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()

    const content = e.dataTransfer.getData('application/x-lexical-block-content')
    if (content) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const x = (e.clientX - rect.left - state.ui.viewport.x) / state.ui.viewport.zoom
        const y = (e.clientY - rect.top - state.ui.viewport.y) / state.ui.viewport.zoom

        ;(async () => {
          dispatchCommand({
            type: 'CreateNode',
            payload: {
              nodeId: instanceService.createNodeId(),
              name: 'New Node',
              x,
              y,
              width: 400,
              height: 300,
              attrs: { memo: content }
            }
          })
        })()
      }
    }
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('wheel', handleWheel)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, marquee, dispatch, dispatchCommand, state.ui.viewport, connect.status])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Let Lexical / form elements manage their own keyboard inputs
        return
      }
    }

    const key = e.key.toLowerCase()
    const isMod = e.ctrlKey || e.metaKey

    // Arrow keys: nudge selected nodes
    if (
      ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) &&
      state.ui.selection.nodeIds.length > 0
    ) {
      e.preventDefault()
      const step = e.shiftKey ? 50 : 10
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0

      const moveCommands: CanvasCommand[] = []
      for (const nodeId of state.ui.selection.nodeIds) {
        const layout = state.layout.layoutByNodeId[nodeId]
        if (layout) {
          moveCommands.push({
            type: 'MoveNode',
            payload: {
              nodeId,
              x: layout.x + dx,
              y: layout.y + dy
            }
          })
        }
      }
      if (moveCommands.length > 0) {
        dispatchTransaction(moveCommands)
      }
      return
    }

    // Delete/Backspace: delete selected nodes and relationships
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault()

      const deleteCommands: CanvasCommand[] = []
      // Delete selected nodes
      for (const nodeId of state.ui.selection.nodeIds) {
        deleteCommands.push({ type: 'DeleteNode', payload: { nodeId } })
      }

      // Delete selected relationships
      for (const relId of state.ui.selection.relationshipIds) {
        deleteCommands.push({ type: 'DeleteRelationship', payload: { relationshipId: relId } })
      }

      if (deleteCommands.length > 0) {
        dispatchTransaction(deleteCommands)
      }
      return
    }

    // N / Shift+N: create new node
    if (key === 'n' && !isMod) {
      e.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const defaultWidth = 600
      const defaultHeight = 400

      let x: number
      let y: number

      if (e.shiftKey) {
        // Shift+N: create at cursor position
        x = (mousePosRef.current.x - state.ui.viewport.x) / state.ui.viewport.zoom
        y = (mousePosRef.current.y - state.ui.viewport.y) / state.ui.viewport.zoom
      } else {
        // N: create at center of viewport
        const centerScreenX = rect.width / 2
        const centerScreenY = rect.height / 2
        x = (centerScreenX - state.ui.viewport.x) / state.ui.viewport.zoom - defaultWidth / 2
        y = (centerScreenY - state.ui.viewport.y) / state.ui.viewport.zoom - defaultHeight / 2
      }

      ;(async () => {
        dispatchCommand({
          type: 'CreateNode',
          payload: {
            nodeId: instanceService.createNodeId(),
            name: 'New Node',
            x,
            y,
            width: defaultWidth,
            height: defaultHeight,
            attrs: { memo: '' }
          }
        })
      })()
      return
    }

    // Modifier-based shortcuts
    if (!isMod) return

    // Ctrl/Cmd + Shift + L: run Leiden layout
    if (e.shiftKey && key === 'l') {
      e.preventDefault()

      if (leidenAbortRef.current && !leidenAbortRef.current.signal.aborted) {
        leidenAbortRef.current.abort()
      }
      const abortController = new AbortController()
      leidenAbortRef.current = abortController

      const baseDto = serializeCanvas(state)
      const snapshotDto =
        typeof structuredClone === 'function'
          ? structuredClone(baseDto)
          : (JSON.parse(JSON.stringify(baseDto)) as typeof baseDto)

      void (async () => {
        let dto: any
        try {
          ;({ dto } = await runHierarchicalLeidenOnDtoInWorker(
            snapshotDto as any,
            {
              signedMode: 'penalty'
            },
            {
              signal: abortController.signal
            }
          ))
        } catch (err) {
          if ((err as any)?.name === 'AbortError') return

          if (abortController.signal.aborted) return

          ;({ dto } = await runHierarchicalLeidenOnDto(
            snapshotDto,
            { signedMode: 'penalty' },
            {
              onProgress: (ev) => {
                console.log('[Leiden] progress', ev)
              }
            }
          ))
        }

        if (abortController.signal.aborted) return

        dispatchCommand({
          type: 'ReplaceGraph',
          payload: {
            dto,
            graphId: String((state.domain.graph as any).id)
          }
        })

        if (leidenAbortRef.current === abortController) {
          leidenAbortRef.current = null
        }
      })()

      return
    }

    // Ctrl/Cmd + Shift + C: cancel in-flight Leiden run
    if (e.shiftKey && key === 'c') {
      e.preventDefault()
      if (leidenAbortRef.current && !leidenAbortRef.current.signal.aborted) {
        leidenAbortRef.current.abort()
      }
      return
    }

    if (key === 'z') {
      e.preventDefault()
      dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
      return
    }

    if (key === 'y') {
      e.preventDefault()
      dispatch({ type: 'REDO' })
    }
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        mousePosRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        }
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={onKeyDown}
      tabIndex={0}
      className="focus:outline-none w-full h-full bg-neutral-100/70 dark:bg-neutral-950 select-none relative overflow-hidden"
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        cursor: isDragging ? 'grabbing' : marquee ? 'crosshair' : 'default'
      }}
    >
      {/* Background Dot Matrix Grid */}
      <CanvasBackground viewport={state.ui.viewport} />

      {/* Floating Viewport & Action Toolbar */}
      <CanvasToolbar containerRef={containerRef} />

      <CanvasWebSocketSyncPlugin />

      {/* Area Marquee Selection Rectangle */}
      {marquee && (
        <div
          className="absolute border border-blue-500 bg-blue-500/15 pointer-events-none rounded-xs z-30"
          style={{
            left: Math.min(marquee.startX, marquee.currentX),
            top: Math.min(marquee.startY, marquee.currentY),
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY)
          }}
        />
      )}

      <div
        style={{
          transform: `translate(${state.ui.viewport.x}px, ${state.ui.viewport.y}px) scale(${state.ui.viewport.zoom})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
          position: 'absolute',
          pointerEvents: 'none'
        }}
      >
        {/* Edges Layer */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none'
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
            </marker>
            <marker
              id="arrowhead-selected"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#2563eb" />
            </marker>
          </defs>
          {Object.values(state.domain.graph.relationshipsById).map((rel) => {
            const sourceNode = state.domain.graph.nodesById[rel.from.nodeId]
            const targetNode = state.domain.graph.nodesById[rel.to.nodeId]
            const sourceLayout = state.layout.layoutByNodeId[rel.from.nodeId]
            const targetLayout = state.layout.layoutByNodeId[rel.to.nodeId]
            if (!sourceLayout || !targetLayout) return null

            const isSourceExpanded = !!state.ui.expandedNodeIds[rel.from.nodeId]
            const isTargetExpanded = !!state.ui.expandedNodeIds[rel.to.nodeId]

            const sourceWidth = isSourceExpanded
              ? (sourceLayout.memoWidth ?? sourceLayout.width)
              : sourceLayout.width
            const targetWidth = isTargetExpanded
              ? (targetLayout.memoWidth ?? targetLayout.width)
              : targetLayout.width

            const sourceHeaderHeight = calculateHeaderHeight(sourceNode?.name ?? '', sourceWidth)
            const targetHeaderHeight = calculateHeaderHeight(targetNode?.name ?? '', targetWidth)

            const sourceVisibleHeight = isSourceExpanded
              ? sourceHeaderHeight + sourceLayout.height
              : sourceHeaderHeight
            const targetVisibleHeight = isTargetExpanded
              ? targetHeaderHeight + targetLayout.height
              : targetHeaderHeight

            const sourceHeaderPorts = sourceNode
              ? createCardinalPorts(sourceNode.id, sourceWidth, sourceVisibleHeight)
              : undefined
            const targetHeaderPorts = targetNode
              ? createCardinalPorts(targetNode.id, targetWidth, targetVisibleHeight)
              : undefined

            const sourceHeaderNode =
              sourceNode && sourceHeaderPorts
                ? { ...sourceNode, ports: sourceHeaderPorts }
                : sourceNode
            const targetHeaderNode =
              targetNode && targetHeaderPorts
                ? { ...targetNode, ports: targetHeaderPorts }
                : targetNode

            const sourceHeaderLayout = {
              ...sourceLayout,
              width: sourceWidth,
              height: sourceVisibleHeight
            }
            const targetHeaderLayout = {
              ...targetLayout,
              width: targetWidth,
              height: targetVisibleHeight
            }

            return (
              <Edge
                key={rel.id}
                edge={{ id: rel.id, source: rel.from.nodeId, target: rel.to.nodeId }}
                sourceLayout={sourceHeaderLayout}
                targetLayout={targetHeaderLayout}
                sourceNode={sourceHeaderNode}
                targetNode={targetHeaderNode}
                attrs={rel.attrs}
              />
            )
          })}
          {connect.status === 'connecting' && connect.start && connect.current && (
            <EdgePath
              path={`M ${connect.start.x} ${connect.start.y} L ${connect.current.x} ${connect.current.y}`}
              stroke="#3b82f6"
              strokeWidth={2}
              dashed
            />
          )}
        </svg>

        {isEmpty && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              userSelect: 'none',
              zIndex: 0
            }}
            className="text-neutral-400 dark:text-neutral-600 gap-2"
          >
            <div className="text-sm font-medium">No cards on this canvas yet</div>
            <div className="text-xs flex items-center gap-1.5">
              Press{' '}
              <kbd className="px-2 py-0.5 rounded bg-neutral-200/80 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                N
              </kbd>{' '}
              or click <b>Add Card</b> to start
            </div>
          </div>
        )}

        <div style={{ pointerEvents: 'auto' }}>
          {Object.values(state.domain.graph.nodesById).map((node) => {
            const layout = state.layout.layoutByNodeId[node.id]
            if (!layout) return null

            return (
              <CanvasNode key={node.id} node={node} layout={layout}>
                {node.type === 'card' && (
                  <MemoEditor
                    value={(node.attrs as any)?.memo || ''}
                    editable={state.ui.selection.nodeIds.includes(node.id)}
                    onCommit={(nextValue) => {
                      dispatchCommand({
                        type: 'UpdateNode',
                        payload: {
                          nodeId: node.id,
                          patch: {
                            attrs: {
                              ...(node.attrs as object),
                              memo: nextValue,
                              memoUpdatedAt: new Date().toISOString()
                            }
                          }
                        }
                      })
                    }}
                  />
                )}
              </CanvasNode>
            )
          })}
        </div>
      </div>
    </div>
  )
}
