// ID flavors for type safety
export type NodeId = string & { readonly __brand: 'NodeId' };
export type RelationshipId = string & { readonly __brand: 'RelationshipId' };
export type PortId = string & { readonly __brand: 'PortId' };
export type GraphId = string & { readonly __brand: 'GraphId' };

export const asNodeId = (id: string) => id as NodeId;
export const asRelationshipId = (id: string) => id as RelationshipId;

// The core Node entity in the graph
export interface NodeEntity {
  id: NodeId;
  type: 'card'; // Discriminator for future node types
  name: string;
  attrs: Record<string, unknown>; // Extensible attributes
  ports: Record<PortId, PortEntity>;
}

// Ports for connection points
export interface PortEntity {
  id: PortId;
  relativePosition: { x: number; y: number };
  normalVector: { x: number; y: number }; // For Bezier curve calculations
  type: 'source' | 'target' | 'bi-directional';
  // State properties can be derived or ephemeral, but keeping them here for now match existing
  isConnected?: boolean; 
  isHovered?: boolean;
}

// The core Relationship entity
export interface RelationshipEntity {
  id: RelationshipId;
  from: { nodeId: NodeId; portId?: PortId };
  to: { nodeId: NodeId; portId?: PortId };
  attrs: Record<string, unknown>; // Label, style, etc.
}

// The Graph aggregate
export interface Graph {
  id: GraphId;
  nodesById: Record<NodeId, NodeEntity>;
  relationshipsById: Record<RelationshipId, RelationshipEntity>;
  outgoingByNodeId: Record<NodeId, ReadonlySet<RelationshipId>>;
  incomingByNodeId: Record<NodeId, ReadonlySet<RelationshipId>>;
}
