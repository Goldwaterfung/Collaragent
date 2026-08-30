import { err, ok, type Graph, type GraphError, type RelationshipEntity, type Result } from './types';
import type { GraphId, NodeId, RelationshipId } from './ids';
import { validateRelationship } from './operations';

const addToIndex = (
  index: Record<NodeId, Set<RelationshipId>>,
  nodeId: NodeId,
  relationshipId: RelationshipId
) => {
  const set = index[nodeId];
  if (!set) {
    index[nodeId] = new Set<RelationshipId>([relationshipId]);
    return;
  }
  set.add(relationshipId);
};

export const createEmptyGraph = (id: GraphId): Graph => {
  return {
    id,
    nodesById: {},
    relationshipsById: {},
    outgoingByNodeId: {},
    incomingByNodeId: {},
  };
};

export interface BuildGraphInput {
  id: GraphId;
  nodesById: Record<NodeId, Graph['nodesById'][NodeId]>;
  relationshipsById: Record<RelationshipId, RelationshipEntity>;
}

export const buildGraph = (input: BuildGraphInput): Result<Graph, GraphError[]> => {
  const errors: GraphError[] = [];

  const outgoing: Record<NodeId, Set<RelationshipId>> = {};
  const incoming: Record<NodeId, Set<RelationshipId>> = {};

  for (const nodeId of Object.keys(input.nodesById) as NodeId[]) {
    outgoing[nodeId] = new Set<RelationshipId>();
    incoming[nodeId] = new Set<RelationshipId>();
  }

  for (const relationshipId of Object.keys(input.relationshipsById) as RelationshipId[]) {
    const relationship = input.relationshipsById[relationshipId];

    const validation = validateRelationship(input.nodesById, relationship);
    if (!validation.ok) {
      errors.push(validation.error);
      continue;
    }

    const { from: { nodeId: fromNodeId }, to: { nodeId: toNodeId } } = relationship;

    addToIndex(outgoing, fromNodeId, relationshipId);
    addToIndex(incoming, toNodeId, relationshipId);
  }

  if (errors.length > 0) {
    return err(errors);
  }

  return ok({
    id: input.id,
    nodesById: input.nodesById,
    relationshipsById: input.relationshipsById,
    outgoingByNodeId: outgoing,
    incomingByNodeId: incoming,
  });
};
