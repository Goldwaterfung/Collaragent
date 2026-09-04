import React, { useState, useRef, useEffect } from 'react'
import { useCanvas } from '../store'
import { instanceService } from '@shared/services/InstanceService'

interface CanvasToolbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  className?: string
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({ containerRef, className = '' }) => {
  const { state, dispatch, dispatchCommand, runClustering, clearClusters } = useCanvas()
  const [isClusterMenuOpen, setIsClusterMenuOpen] = useState(false)
  const clusterMenuRef = useRef<HTMLDivElement | null>(null)

  const isClusteringRunning = Boolean(state.ui.clusteringProgress?.running)
  const zoom = state.ui.viewport.zoom
  const zoomPercent = Math.round(zoom * 100)

  const maxLevels = React.useMemo(() => {
    let max = 0
    for (const node of Object.values(state.domain.graph.nodesById)) {
      if (Array.isArray(node.attrs?.clusterPath)) {
        if (node.attrs.clusterPath.length > max) {
          max = node.attrs.clusterPath.length
        }
      }
    }
    return max
  }, [state.domain.graph.nodesById])

  useEffect(() => {
    if (!isClusterMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        clusterMenuRef.current &&
        event.target instanceof Element &&
        !clusterMenuRef.current.contains(event.target)
      ) {
        setIsClusterMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isClusterMenuOpen])

  const handleZoomIn = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 1.2,
        center: { x: rect.width / 2, y: rect.height / 2 }
      }
    })
  }

  const handleZoomOut = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 0.8,
        center: { x: rect.width / 2, y: rect.height / 2 }
      }
    })
  }

  const handleResetZoom = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 1 / zoom,
        center: { x: rect.width / 2, y: rect.height / 2 }
      }
    })
  }

  const handleFitView = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const layouts = Object.values(state.layout.layoutByNodeId)
    if (layouts.length === 0) {
      dispatch({
        type: 'SET_VIEWPORT',
        payload: { x: 0, y: 0, zoom: 1 }
      })
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const l of layouts) {
      if (l.x < minX) minX = l.x
      if (l.y < minY) minY = l.y
      if (l.x + l.width > maxX) maxX = l.x + l.width
      if (l.y + l.height > maxY) maxY = l.y + l.height
    }

    const padding = 80
    const graphWidth = Math.max(100, maxX - minX + padding * 2)
    const graphHeight = Math.max(100, maxY - minY + padding * 2)

    const fitZoom = Math.min(
      2.0,
      Math.max(0.2, Math.min(rect.width / graphWidth, rect.height / graphHeight))
    )

    const centerX = minX - padding + graphWidth / 2
    const centerY = minY - padding + graphHeight / 2

    const targetX = rect.width / 2 - centerX * fitZoom
    const targetY = rect.height / 2 - centerY * fitZoom

    dispatch({
      type: 'SET_VIEWPORT',
      payload: {
        x: targetX,
        y: targetY,
        zoom: fitZoom
      }
    })
  }

  const handleAddNode = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const defaultWidth = 600
    const defaultHeight = 400
    const centerScreenX = rect.width / 2
    const centerScreenY = rect.height / 2

    const x = (centerScreenX - state.ui.viewport.x) / state.ui.viewport.zoom - defaultWidth / 2
    const y = (centerScreenY - state.ui.viewport.y) / state.ui.viewport.zoom - defaultHeight / 2

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
  }

  return (
    <div
      className={`canvas-toolbar absolute bottom-4 left-4 z-30 flex items-center gap-1.5 p-1.5 rounded-xl border border-surface-200 bg-white shadow-md transition-all select-none ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleAddNode}
        title="Add Card (Press N)"
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-black bg-primary hover:bg-primary/90 rounded-lg transition-colors cursor-pointer focus:outline-none"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        <span>Add Card</span>
        <kbd className="ml-0.5 text-[10px] font-mono px-1 py-0.2 bg-black/10 rounded text-black">
          N
        </kbd>
      </button>

      {/* Cluster Dropdown Menu */}
      <div className="relative" ref={clusterMenuRef}>
        <button
          type="button"
          onClick={() => setIsClusterMenuOpen((prev) => !prev)}
          disabled={isClusteringRunning}
          title="Auto-Cluster Cards"
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isClusteringRunning ? (
            <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="4" cy="4" r="2" />
              <circle cx="12" cy="5" r="2" />
              <circle cx="8" cy="12" r="2" />
              <path d="M5.5 5.5l5 5M10.5 6.5l-5 4" strokeDasharray="1 1" />
            </svg>
          )}
          <span>
            Cluster
            {state.ui.clusterDisplayLevel !== undefined
              ? ` (L${state.ui.clusterDisplayLevel})`
              : ''}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-150 ${isClusterMenuOpen ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {isClusterMenuOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-surface-200 bg-white shadow-xl p-1.5 z-40 flex flex-col gap-0.5 text-xs select-none">
            <button
              type="button"
              onClick={() => {
                setIsClusterMenuOpen(false)
                void runClustering('rearrange')
              }}
              className="w-full text-left px-2.5 py-2 hover:bg-surface-100 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer focus:outline-none"
            >
              <span className="font-semibold text-gray-800">Cluster & Rearrange</span>
              <span className="text-[11px] text-gray-500">Detect communities & auto-layout</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsClusterMenuOpen(false)
                void runClustering('cluster-only')
              }}
              className="w-full text-left px-2.5 py-2 hover:bg-surface-100 rounded-lg transition-colors flex flex-col gap-0.5 cursor-pointer focus:outline-none"
            >
              <span className="font-semibold text-gray-800">Cluster Only</span>
              <span className="text-[11px] text-gray-500">
                Detect communities without moving cards
              </span>
            </button>

            {maxLevels > 1 && (
              <>
                <div className="my-1 border-t border-surface-200" />
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Granularity Level
                </div>
                <div className="flex items-center gap-1 px-1.5 pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      dispatch({ type: 'SET_CLUSTER_DISPLAY_LEVEL', payload: undefined })
                    }}
                    title="Auto (Default cluster level)"
                    className={`flex-1 px-2 py-1 text-center rounded-md font-medium text-[11px] transition-colors cursor-pointer focus:outline-none ${
                      state.ui.clusterDisplayLevel === undefined
                        ? 'bg-primary text-black font-semibold shadow-xs'
                        : 'text-gray-600 hover:bg-surface-100'
                    }`}
                  >
                    Auto
                  </button>
                  {Array.from({ length: maxLevels }, (_, lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => {
                        dispatch({ type: 'SET_CLUSTER_DISPLAY_LEVEL', payload: lvl })
                      }}
                      title={`Community Hierarchy Level ${lvl}`}
                      className={`flex-1 px-2 py-1 text-center rounded-md font-medium text-[11px] transition-colors cursor-pointer focus:outline-none ${
                        state.ui.clusterDisplayLevel === lvl
                          ? 'bg-primary text-black font-semibold shadow-xs'
                          : 'text-gray-600 hover:bg-surface-100'
                      }`}
                    >
                      L{lvl}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="my-1 border-t border-surface-200" />
            <button
              type="button"
              onClick={() => {
                setIsClusterMenuOpen(false)
                clearClusters()
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-red-50 text-red-600 rounded-lg transition-colors flex items-center justify-between cursor-pointer focus:outline-none"
            >
              <span className="font-medium">Clear Clusters</span>
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-surface-200 mx-0.5" />

      <button
        type="button"
        onClick={handleZoomOut}
        title="Zoom Out"
        className="p-1.5 text-gray-600 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer focus:outline-none"
        aria-label="Zoom Out"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleResetZoom}
        title="Reset Zoom to 100%"
        className="px-2 py-1 text-xs font-mono font-medium text-gray-700 hover:bg-surface-100 rounded-lg transition-colors min-w-[44px] text-center cursor-pointer focus:outline-none"
      >
        {zoomPercent}%
      </button>

      <button
        type="button"
        onClick={handleZoomIn}
        title="Zoom In"
        className="p-1.5 text-gray-600 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer focus:outline-none"
        aria-label="Zoom In"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>

      <div className="w-px h-4 bg-surface-200 mx-0.5" />

      <button
        type="button"
        onClick={handleFitView}
        title="Fit All Nodes in View"
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-surface-100 rounded-lg transition-colors cursor-pointer focus:outline-none"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
        <span>Fit View</span>
      </button>
    </div>
  )
}
