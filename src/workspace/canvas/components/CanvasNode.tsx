import React, { useState, useRef, useEffect } from 'react';
import type { NodeLayout } from '../types';
import { useCanvas } from '../store';
import { NodeFrame } from './NodeFrame';
import { NodeHeader } from './NodeHeader';
import { ResizeHandle } from './ResizeHandle';
import { PortContainer } from './PortContainer';
import { createCardinalPorts, type CardinalDirection } from '@workspace/canvas/domain/portUtils';
import { NODE_HEADER_HEIGHT } from './nodeLayout';
import type { NodeEntity, PortEntity } from '@workspace/canvas/domain/types';
import { instanceService } from '@shared/services/InstanceService';

/**
 * Props for a single canvas node component.
 */
interface CanvasNodeProps {
  /** The node domain entity */
  node: NodeEntity;
  /** The layout information for the node (position and dimensions) */
  layout: NodeLayout;
  /** Child content to render inside the node */
  children: React.ReactNode;
}

const expandedByNodeId = new Map<string, boolean>();

export const CanvasNode: React.FC<CanvasNodeProps> = ({ node, layout, children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { dispatch, dispatchCommand, state } = useCanvas();
  const [isDragging, setIsDragging] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);

  const isSelected = state.ui.selection.nodeIds.includes(node.id);

  const displayName = node.name;

  // Local state for the input to avoid jitter while typing
  const [localName, setLocalName] = useState(displayName);

  const headerWidth = layout.width;

  const headerPorts = React.useMemo(
    () => createCardinalPorts(node.id, headerWidth, NODE_HEADER_HEIGHT),
    [node.id, headerWidth]
  );

  // Sync local state when external data changes
  useEffect(() => {
    setLocalName(displayName);
  }, [displayName]);

  useEffect(() => {
    const stored = expandedByNodeId.get(node.id);
    setIsExpanded(stored ?? false);
  }, [node.id]);

  useEffect(() => {
    expandedByNodeId.set(node.id, isExpanded);
  }, [node.id, isExpanded]);

  const commitNameUpdate = async () => {
    if (localName !== displayName) {
      dispatchCommand({
        type: 'UpdateNode',
        payload: {
          nodeId: node.id,
          patch: { name: localName },
        },
      });
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitNameUpdate();
      (e.target as HTMLInputElement).blur();
    }
    e.stopPropagation(); // Prevent other canvas hotkeys
  };

  const handleInputMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Allow text selection, prevent node drag
  };

  const handleToggleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleToggleClick = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent canvas panning
    if (e.button !== 0) return;

    dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: e.shiftKey } });

    // Start dragging immediately on selection (unified behavior)
    setIsDragging(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleResizeStart = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    setResizeHandle(handle);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  /**
   * Handles completing a connection when releasing mouse on this node.
   */
  const handleMouseUp = () => {
    if (state.ui.interaction.connect.status !== 'connecting') return;

    // We rely on the global viewport handler to clear the interaction state (CancelConnect),
    // so we only need to dispatch the data mutation here.
    const fromNodeId = state.ui.interaction.connect.fromNodeId;
    if (!fromNodeId) return;

    dispatchCommand({
      type: 'AddRelationship',
      payload: {
        relationship: {
          id: instanceService.createRelationshipId(),
          from: { nodeId: fromNodeId },
          to: { nodeId: node.id },
          attrs: {},
        }
      }
    });
  };

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
          y: layout.y + port.relativePosition.y,
        },
      },
    });
  };

  useEffect(() => {
    if (!isDragging && !resizeHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!lastMousePos.current) return;
      const dx = (e.clientX - lastMousePos.current.x) / state.ui.viewport.zoom;
      const dy = (e.clientY - lastMousePos.current.y) / state.ui.viewport.zoom;

      if (isDragging) {
        dispatchCommand({
          type: 'MoveNode',
          payload: {
            nodeId: node.id,
            x: layout.x + dx,
            y: layout.y + dy,
          },
        });
      } else if (resizeHandle) {
        let newWidth = layout.width;
        let newHeight = layout.height;
        let newX = layout.x;
        let newY = layout.y;

        if (resizeHandle.includes('e')) newWidth += dx;
        if (resizeHandle.includes('s')) newHeight += dy;
        if (resizeHandle.includes('w')) {
          newWidth -= dx;
          newX += dx;
        }
        if (resizeHandle.includes('n')) {
          newHeight -= dy;
          newY += dy;
        }

        // Min dimensions
        if (newWidth < 180) newWidth = 180;
        if (newHeight < 120) newHeight = 120;

        dispatchCommand({
          type: 'ResizeNode',
          payload: {
            nodeId: node.id,
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight,
          },
        });
      }

      lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setResizeHandle(null);
      lastMousePos.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, resizeHandle, node, layout, dispatchCommand, state.ui.viewport.zoom]);

  const [isHovered, setIsHovered] = useState(false);

  return (
    <PortContainer
      nodeId={node.id}
      x={layout.x}
      y={layout.y}
      width={headerWidth}
      height={NODE_HEADER_HEIGHT}
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
            className="flex items-center justify-between px-3 gap-2"
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

            <div className="flex-1 min-w-0">
              <input
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onBlur={commitNameUpdate}
                onKeyDown={handleInputKeyDown}
                onMouseDown={handleInputMouseDown}
                className="w-full bg-transparent font-semibold text-lg text-neutral-800 dark:text-neutral-100 text-center truncate outline-none focus:ring-1 focus:ring-blue-400/50 rounded px-1 transition-all"
                style={{
                  cursor: isSelected ? 'text' : 'grab',
                  pointerEvents: isSelected ? 'auto' : 'none',
                }}
              />
            </div>

            <div className="w-5 shrink-0" />
          </NodeHeader>
        </NodeFrame>

        {isExpanded && (
          <div
            style={{
              position: 'absolute',
              top: NODE_HEADER_HEIGHT,
              left: 0,
              width: layout.width,
              height: layout.height,
              zIndex: 40,
              pointerEvents: 'auto',
            }}
            className="rounded-b-xl border-x border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              if (!isSelected) {
                dispatch({ type: 'SELECT_NODE', payload: { id: node.id, multi: e.shiftKey } });
              }
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                pointerEvents: 'auto',
              }}
            >
              {children}
            </div>

            {(isSelected || isHovered) && (
              <>
                <ResizeHandle
                  position="n"
                  onMouseDown={(e) => handleResizeStart(e, 'n')}
                />
                <ResizeHandle
                  position="e"
                  onMouseDown={(e) => handleResizeStart(e, 'e')}
                />
                <ResizeHandle
                  position="s"
                  onMouseDown={(e) => handleResizeStart(e, 's')}
                />
                <ResizeHandle
                  position="w"
                  onMouseDown={(e) => handleResizeStart(e, 'w')}
                />
                <ResizeHandle
                  position="se"
                  onMouseDown={(e) => handleResizeStart(e, 'se')}
                />
                <ResizeHandle
                  position="sw"
                  onMouseDown={(e) => handleResizeStart(e, 'sw')}
                />
                <ResizeHandle
                  position="ne"
                  onMouseDown={(e) => handleResizeStart(e, 'ne')}
                />
                <ResizeHandle
                  position="nw"
                  onMouseDown={(e) => handleResizeStart(e, 'nw')}
                />
              </>
            )}
          </div>
        )}
      </div>
    </PortContainer>
  );
};

