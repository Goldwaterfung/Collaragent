import React from 'react';
import { Port } from './Port';
import {
    createCardinalPorts,
    extractDirectionFromPortId,
} from '../domain/portUtils';
import type { PortEntity } from '../domain/types';
import type { PortId } from '../domain/ids';
import type { CardinalDirection } from '../domain/portUtils';

/**
 * Props for the PortContainer component.
 */
interface PortContainerProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Unique identifier of the parent node */
    nodeId: string;
    /** X position of the node on the canvas */
    x: number;
    /** Y position of the node on the canvas */
    y: number;
    /** Width of the node in canvas units */
    width: number;
    /** Height of the node in canvas units */
    height: number;
    /**
     * Existing ports from the node entity.
     * If provided, these will be used instead of generating new ones.
     */
    ports?: Record<PortId, PortEntity>;
    /** Callback when a port drag (connection start) begins */
    onPortDragStart?: (e: React.MouseEvent, port: PortEntity, direction: CardinalDirection) => void;
    /** Callback when mouse enters a port (for hover state) */
    onPortMouseEnter?: (port: PortEntity) => void;
    /** Callback when mouse leaves a port */
    onPortMouseLeave?: (port: PortEntity) => void;
    /** Children to render inside the container (typically NodeFrame) */
    children?: React.ReactNode;
}

/**
 * PortContainer is the outer wrapper for a canvas node.
 * 
 * It positions the node on the canvas and renders 4 connection ports
 * at the cardinal positions (North, East, South, West) on its border.
 * The NodeFrame and other content are rendered as children.
 * 
 * Structure:
 * ```
 * PortContainer (absolute positioned, contains ports on border)
 *   └── NodeFrame (the visual node with content)
 *         └── NodeHeader
 *         └── Content
 *         └── ResizeHandles
 * ```
 * 
 * @example
 * ```tsx
 * <PortContainer
 *   nodeId={node.id}
 *   x={layout.x}
 *   y={layout.y}
 *   width={layout.width}
 *   height={layout.height}
 *   ports={node.ports}
 *   onPortDragStart={handlePortDragStart}
 * >
 *   <NodeFrame ...>
 *     {content}
 *   </NodeFrame>
 * </PortContainer>
 * ```
 */
export const PortContainer: React.FC<PortContainerProps> = ({
    nodeId,
    x,
    y,
    width,
    height,
    ports: existingPorts,
    onPortDragStart,
    onPortMouseEnter,
    onPortMouseLeave,
    children,
    style,
    ...props
}) => {
    // Use existing ports or create default cardinal ports
    const ports = existingPorts ?? createCardinalPorts(nodeId, width, height);

    const handleMouseDown = (e: React.MouseEvent, port: PortEntity) => {
        const direction = extractDirectionFromPortId(port.id);
        if (direction && onPortDragStart) {
            onPortDragStart(e, port, direction);
        }
    };

    return (
        <div
            className="port-container"
            style={{
                position: 'absolute',
                left: x,
                top: y,
                width,
                height,
                // Allow pointer events on the container for the ports
                pointerEvents: 'none',
                ...style,
            }}
            data-port-container={nodeId}
            {...props}
        >
            {/* Ports Layer - positioned on the border */}
            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: 30, // Above everything else
                }}
            >
                {Object.values(ports).map((port) => (
                    <Port
                        key={port.id}
                        port={port}
                        onMouseDown={(e) => handleMouseDown(e, port)}
                        onMouseEnter={() => onPortMouseEnter?.(port)}
                        onMouseLeave={() => onPortMouseLeave?.(port)}
                    />
                ))}
            </div>

            {/* Node content (NodeFrame) rendered as children */}
            <div style={{ width: '100%', height: '100%', pointerEvents: 'auto' }}>
                {children}
            </div>
        </div>
    );
};
