import React from 'react';
import type { PortEntity } from '../domain/types';
import { Handle } from './Handle';

/**
 * Props for the Port component.
 */
interface PortProps {
    /** The port entity data */
    port: PortEntity;
    /** Callback when mouse button is pressed on the port (for starting connections) */
    onMouseDown?: (e: React.MouseEvent, port: PortEntity) => void;
    /** Callback when mouse enters the port (for hover highlighting) */
    onMouseEnter?: () => void;
    /** Callback when mouse leaves the port */
    onMouseLeave?: () => void;
}

/**
 * Port renders a single connection point on a node's border.
 * 
 * The port is positioned absolutely based on its `relativePosition` property,
 * which is calculated relative to the parent node's top-left corner.
 * 
 * Visual states:
 * - Default: Blue dot
 * - Hovered: Slightly larger with glow effect  
 * - Connected: Green dot
 */
export const Port: React.FC<PortProps> = ({
    port,
    onMouseDown,
    onMouseEnter,
    onMouseLeave,
}) => {
    const [isInternalHovered, setIsInternalHovered] = React.useState(false);
    const isHovered = port.isHovered || isInternalHovered;

    const baseSize = 10;
    const hoverSize = 14;
    const size = isHovered ? hoverSize : baseSize;

    // Color logic: green if connected, blue otherwise
    const color = port.isConnected ? '#10b981' : '#3b82f6';

    const handleMouseEnter = () => {
        setIsInternalHovered(true);
        onMouseEnter?.();
    };

    const handleMouseLeave = () => {
        setIsInternalHovered(false);
        onMouseLeave?.();
    };

    return (
        <div
            style={{
                position: 'absolute',
                left: port.relativePosition.x,
                top: port.relativePosition.y,
                transform: 'translate(-50%, -50%)',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 25,
                pointerEvents: 'auto',
                cursor: 'crosshair',
            }}
            data-port-id={port.id}
            data-port-type={port.type}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={(e) => {
                e.stopPropagation();
                onMouseDown?.(e, port);
            }}
        >
            <Handle
                color={color}
                size={size}
                cursor="crosshair"
                style={{
                    border: '2px solid white',
                    boxShadow: isHovered
                        ? `0 0 10px ${color}, 0 0 4px rgba(0,0,0,0.3)`
                        : '0 0 3px rgba(0,0,0,0.25)',
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
};
