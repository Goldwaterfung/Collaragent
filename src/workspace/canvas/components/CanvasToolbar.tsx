import React from 'react';
import { useCanvas } from '../store';
import { instanceService } from '@shared/services/InstanceService';

interface CanvasToolbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  containerRef,
  className = '',
}) => {
  const { state, dispatch, dispatchCommand } = useCanvas();
  const zoom = state.ui.viewport.zoom;
  const zoomPercent = Math.round(zoom * 100);

  const handleZoomIn = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 1.2,
        center: { x: rect.width / 2, y: rect.height / 2 },
      },
    });
  };

  const handleZoomOut = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 0.8,
        center: { x: rect.width / 2, y: rect.height / 2 },
      },
    });
  };

  const handleResetZoom = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dispatch({
      type: 'ZOOM',
      payload: {
        factor: 1 / zoom,
        center: { x: rect.width / 2, y: rect.height / 2 },
      },
    });
  };

  const handleFitView = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const layouts = Object.values(state.layout.layoutByNodeId);
    if (layouts.length === 0) {
      dispatch({
        type: 'SET_VIEWPORT',
        payload: { x: 0, y: 0, zoom: 1 },
      });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const l of layouts) {
      if (l.x < minX) minX = l.x;
      if (l.y < minY) minY = l.y;
      if (l.x + l.width > maxX) maxX = l.x + l.width;
      if (l.y + l.height > maxY) maxY = l.y + l.height;
    }

    const padding = 80;
    const graphWidth = Math.max(100, maxX - minX + padding * 2);
    const graphHeight = Math.max(100, maxY - minY + padding * 2);

    const fitZoom = Math.min(
      2.0,
      Math.max(0.2, Math.min(rect.width / graphWidth, rect.height / graphHeight))
    );

    const centerX = minX - padding + graphWidth / 2;
    const centerY = minY - padding + graphHeight / 2;

    const targetX = rect.width / 2 - centerX * fitZoom;
    const targetY = rect.height / 2 - centerY * fitZoom;

    dispatch({
      type: 'SET_VIEWPORT',
      payload: {
        x: targetX,
        y: targetY,
        zoom: fitZoom,
      },
    });
  };

  const handleAddNode = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const defaultWidth = 600;
    const defaultHeight = 400;
    const centerScreenX = rect.width / 2;
    const centerScreenY = rect.height / 2;

    const x = (centerScreenX - state.ui.viewport.x) / state.ui.viewport.zoom - defaultWidth / 2;
    const y = (centerScreenY - state.ui.viewport.y) / state.ui.viewport.zoom - defaultHeight / 2;

    dispatchCommand({
      type: 'CreateNode',
      payload: {
        nodeId: instanceService.createNodeId(),
        name: 'New Node',
        x,
        y,
        width: defaultWidth,
        height: defaultHeight,
        attrs: { memo: '' },
      },
    });
  };

  return (
    <div
      className={`canvas-toolbar absolute bottom-4 left-4 z-30 flex items-center gap-1.5 p-1.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white/90 dark:bg-neutral-900/90 shadow-md backdrop-blur-md transition-all select-none ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleAddNode}
        title="Add Card (Press N)"
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        <span>Add Card</span>
        <kbd className="ml-0.5 text-[10px] font-mono px-1 py-0.2 bg-blue-200/50 dark:bg-blue-800/50 rounded text-blue-700 dark:text-blue-300">N</kbd>
      </button>

      <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-800 mx-0.5" />

      <button
        type="button"
        onClick={handleZoomOut}
        title="Zoom Out"
        className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        aria-label="Zoom Out"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>

      <button
        type="button"
        onClick={handleResetZoom}
        title="Reset Zoom to 100%"
        className="px-2 py-1 text-xs font-mono font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors min-w-[44px] text-center"
      >
        {zoomPercent}%
      </button>

      <button
        type="button"
        onClick={handleZoomIn}
        title="Zoom In"
        className="p-1.5 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        aria-label="Zoom In"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
      </button>

      <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-800 mx-0.5" />

      <button
        type="button"
        onClick={handleFitView}
        title="Fit All Nodes in View"
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
        <span>Fit View</span>
      </button>
    </div>
  );
};
