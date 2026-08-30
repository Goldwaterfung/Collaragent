import type { GraphId, NodeId, PortId, RelationshipId } from './ids';

export interface EndpointRef {
  nodeId: NodeId;
  portId?: PortId;
}

export interface PortEntity {
  id: PortId;
  // --- GEOMETRY & PHYSICS ---
  /**
   * The position relative to the Parent Node's top-left corner (0,0)
   */
  relativePosition: { x: number; y: number };

  /**
   * Crucial for Bezier Curves: Defines the "launch angle"
   * (0, -1) = Up, (1, 0) = Right.
   * The curve must leave in this direction for "k" pixels before turning.
   */
  normalVector: { x: number; y: number };

  // --- LOGIC & CONSTRAINTS ---
  type: 'source' | 'target' | 'bi-directional';

  // --- STATE ---
  isConnected?: boolean;
  isHovered?: boolean;
}

export interface NodeEntity {
  id: NodeId;
  /**
   * Semantic node type. Layout is intentionally not part of the domain entity.
   */
  type: 'card';
  /**
   * Human-readable display name for this node.
   * This is shown in the node header and can be edited by the user.
   */
  name: string;
  /**
   * Extensible semantic attributes (e.g., embedded Lexical JSON initially).
   */
  attrs: Record<string, unknown>;
  /**
   * Ports available on this node for connections.
   */
  ports: Record<PortId, PortEntity>;
}

export interface RelationshipAttributes {
  /**
   * Human-readable label for the relationship (e.g. "loves", "owns", "inherits from").
   */
  label?: string;
  [key: string]: unknown;
}

export interface RelationshipEntity {
  id: RelationshipId;
  from: EndpointRef;
  to: EndpointRef;
  attrs: RelationshipAttributes;
}

export interface Graph {
  id: GraphId;
  nodesById: Record<NodeId, NodeEntity>;
  relationshipsById: Record<RelationshipId, RelationshipEntity>;
  outgoingByNodeId: Record<NodeId, ReadonlySet<RelationshipId>>;
  incomingByNodeId: Record<NodeId, ReadonlySet<RelationshipId>>;
}

export type GraphErrorCode =
  | 'NODE_ALREADY_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'RELATIONSHIP_ALREADY_EXISTS'
  | 'RELATIONSHIP_NOT_FOUND'
  | 'SELF_LOOP_NOT_ALLOWED'
  | 'PORTS_NOT_SUPPORTED_YET';

export interface GraphError {
  code: GraphErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A snapshot of the entire canvas state, including the graph structure
 * and the visual layout of nodes.
 */
export interface CanvasSnapshot {
  graph: Graph;
  layoutByNodeId: Record<NodeId, NodeLayout>;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
