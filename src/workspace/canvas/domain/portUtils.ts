import type { PortId } from './ids';
import { asPortId } from './ids';
import type { PortEntity } from './types';

/**
 * Cardinal direction identifiers for port positioning.
 * Each direction corresponds to a position on the node border.
 */
export type CardinalDirection = 'north' | 'east' | 'south' | 'west';

/**
 * Normal vectors for each cardinal direction.
 * These define the "launch angle" for Bezier curves leaving the port.
 * 
 * - North (0, -1): Curves launch upward
 * - East  (1, 0):  Curves launch rightward
 * - South (0, 1):  Curves launch downward
 * - West  (-1, 0): Curves launch leftward
 */
const NORMAL_VECTORS: Record<CardinalDirection, { x: number; y: number }> = {
    north: { x: 0, y: -1 },
    east: { x: 1, y: 0 },
    south: { x: 0, y: 1 },
    west: { x: -1, y: 0 },
};

/**
 * Creates a port ID for a given node and direction.
 * Uses a consistent naming convention: `{nodeId}:port:{direction}`
 */
export const createPortId = (nodeId: string, direction: CardinalDirection): PortId => {
    return asPortId(`${nodeId}:port:${direction}`);
};

/**
 * Calculates the relative position of a port on the node border.
 * Positions are relative to the node's top-left corner (0, 0).
 * 
 * @param direction - The cardinal direction for the port
 * @param width - The node's width in canvas units
 * @param height - The node's height in canvas units
 * @returns The (x, y) position relative to the node's top-left corner
 */
export const calculatePortPosition = (
    direction: CardinalDirection,
    width: number,
    height: number
): { x: number; y: number } => {
    switch (direction) {
        case 'north':
            return { x: width / 2, y: 0 };
        case 'east':
            return { x: width, y: height / 2 };
        case 'south':
            return { x: width / 2, y: height };
        case 'west':
            return { x: 0, y: height / 2 };
    }
};

/**
 * Creates a single port entity for a given direction.
 * 
 * @param nodeId - The parent node's ID
 * @param direction - The cardinal direction for the port
 * @param width - The node's width
 * @param height - The node's height
 * @returns A fully configured PortEntity
 */
export const createPort = (
    nodeId: string,
    direction: CardinalDirection,
    width: number,
    height: number
): PortEntity => {
    return {
        id: createPortId(nodeId, direction),
        relativePosition: calculatePortPosition(direction, width, height),
        normalVector: NORMAL_VECTORS[direction],
        type: 'bi-directional', // All cardinal ports can be sources or targets
        isConnected: false,
        isHovered: false,
    };
};

/**
 * Creates 4 cardinal ports (N, E, S, W) for a node.
 * This is the primary function to use when initializing a new node.
 * 
 * @param nodeId - The parent node's ID
 * @param width - The node's width
 * @param height - The node's height
 * @returns A Record mapping PortId to PortEntity for all 4 cardinal directions
 */
export const createCardinalPorts = (
    nodeId: string,
    width: number,
    height: number
): Record<PortId, PortEntity> => {
    const directions: CardinalDirection[] = ['north', 'east', 'south', 'west'];
    const ports: Record<PortId, PortEntity> = {};

    for (const direction of directions) {
        const port = createPort(nodeId, direction, width, height);
        ports[port.id] = port;
    }

    return ports;
};

/**
 * Updates the relative positions of existing ports when a node is resized.
 * Preserves all other port properties (connected state, hover state, etc.)
 * 
 * @param ports - The existing ports Record
 * @param width - The new node width
 * @param height - The new node height
 * @returns A new Record with updated positions
 */
export const updatePortPositions = (
    ports: Record<PortId, PortEntity>,
    width: number,
    height: number
): Record<PortId, PortEntity> => {
    const updatedPorts: Record<PortId, PortEntity> = {};

    for (const [portId, port] of Object.entries(ports) as [PortId, PortEntity][]) {
        // Extract direction from port ID (format: "{nodeId}:port:{direction}")
        const direction = extractDirectionFromPortId(portId);

        if (direction) {
            updatedPorts[portId] = {
                ...port,
                relativePosition: calculatePortPosition(direction, width, height),
            };
        } else {
            // Keep non-cardinal ports unchanged
            updatedPorts[portId] = port;
        }
    }

    return updatedPorts;
};

/**
 * Extracts the cardinal direction from a port ID.
 * Returns null if the port ID doesn't follow the cardinal naming convention.
 */
export const extractDirectionFromPortId = (portId: PortId): CardinalDirection | null => {
    const match = portId.match(/:port:(north|east|south|west)$/);
    return match ? (match[1] as CardinalDirection) : null;
};

/**
 * Gets the port at a specific direction from a ports Record.
 * Useful for finding connection points.
 */
export const getPortByDirection = (
    ports: Record<PortId, PortEntity>,
    nodeId: string,
    direction: CardinalDirection
): PortEntity | undefined => {
    const portId = createPortId(nodeId, direction);
    return ports[portId];
};

/**
 * Heuristic to find the best cardinal direction from one rectangle to another.
 */
export const getBestDirection = (
    fromRect: { x: number, y: number, width: number, height: number },
    toRect: { x: number, y: number, width: number, height: number }
): CardinalDirection => {
    const fromCenterX = fromRect.x + fromRect.width / 2;
    const fromCenterY = fromRect.y + fromRect.height / 2;
    const toCenterX = toRect.x + toRect.width / 2;
    const toCenterY = toRect.y + toRect.height / 2;

    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0 ? 'east' : 'west';
    } else {
        return dy > 0 ? 'south' : 'north';
    }
};
