export type Brand<T, BrandName extends string> = T & { readonly __brand: BrandName };

export type GraphId = Brand<string, 'GraphId'>;
export type NodeId = Brand<string, 'NodeId'>;
export type RelationshipId = Brand<string, 'RelationshipId'>;
export type PortId = Brand<string, 'PortId'>;

export const asGraphId = (value: string): GraphId => value as GraphId;
export const asNodeId = (value: string): NodeId => value as NodeId;
export const asRelationshipId = (value: string): RelationshipId => value as RelationshipId;
export const asPortId = (value: string): PortId => value as PortId;
