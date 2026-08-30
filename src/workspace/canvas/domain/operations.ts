import type { NodeId, RelationshipId } from './ids';
import type {
  Graph,
  GraphError,
  NodeEntity,
  RelationshipEntity,
  Result,
} from './types';
import { err, ok } from './types';

const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const cloneSet = <T>(input?: ReadonlySet<T>): Set<T> => new Set<T>(input ?? []);

const setAdd = <T>(index: Record<string, ReadonlySet<T>>, key: string, value: T) => {
  const next = cloneSet(index[key]);
  next.add(value);
  return next as ReadonlySet<T>;
};

const setDelete = <T>(index: Record<string, ReadonlySet<T>>, key: string, value: T) => {
  const next = cloneSet(index[key]);
  next.delete(value);
  return next as ReadonlySet<T>;
};

export const validateRelationship = (
  nodesById: Record<string, unknown>,
  relationship: RelationshipEntity
): Result<true, GraphError> => {
  const fromNodeId = relationship.from.nodeId;
  const toNodeId = relationship.to.nodeId;

  // Validate From Port
  if (relationship.from.portId) {
    const fromNode = nodesById[fromNodeId] as NodeEntity | undefined;
    if (fromNode && !fromNode.ports[relationship.from.portId]) {
      // Ideally we return an error, but let's check node existence first properly below.
      // Actually, we should wait until we check node existence.
    }
  }

  if (fromNodeId === toNodeId) {
    return err({
      code: 'SELF_LOOP_NOT_ALLOWED',
      message: 'Self-loops are not allowed (from.nodeId must differ from to.nodeId).',
      details: { relationshipId: relationship.id, nodeId: fromNodeId },
    });
  }

  if (!hasOwn(nodesById, fromNodeId)) {
    return err({
      code: 'NODE_NOT_FOUND',
      message: 'Relationship.from references a node that does not exist.',
      details: { relationshipId: relationship.id, endpoint: 'from', nodeId: fromNodeId },
    });
  }

  if (!hasOwn(nodesById, toNodeId)) {
    return err({
      code: 'NODE_NOT_FOUND',
      message: 'Relationship.to references a node that does not exist.',
      details: { relationshipId: relationship.id, endpoint: 'to', nodeId: toNodeId },
    });
  }

  return ok(true);
};

export const addNode = (graph: Graph, node: NodeEntity): Result<Graph, GraphError> => {
  if (hasOwn(graph.nodesById, node.id)) {
    return err({
      code: 'NODE_ALREADY_EXISTS',
      message: 'Node with this id already exists.',
      details: { nodeId: node.id },
    });
  }

  return ok({
    ...graph,
    nodesById: {
      ...graph.nodesById,
      [node.id]: node,
    },
    outgoingByNodeId: {
      ...graph.outgoingByNodeId,
      [node.id]: new Set<RelationshipId>(),
    },
    incomingByNodeId: {
      ...graph.incomingByNodeId,
      [node.id]: new Set<RelationshipId>(),
    },
  });
};

export const updateNode = (
  graph: Graph,
  nodeId: NodeId,
  patch: Partial<Omit<NodeEntity, 'id'>>
): Result<Graph, GraphError> => {
  const current = graph.nodesById[nodeId];
  if (!current) {
    return err({
      code: 'NODE_NOT_FOUND',
      message: 'Node not found.',
      details: { nodeId },
    });
  }

  const next: NodeEntity = {
    ...current,
    ...patch,
    // attrs is a record; if provided, replace (domain layer keeps semantics explicit)
    attrs: patch.attrs ?? current.attrs,
  };

  return ok({
    ...graph,
    nodesById: {
      ...graph.nodesById,
      [nodeId]: next,
    },
  });
};

export const removeRelationship = (
  graph: Graph,
  relationshipId: RelationshipId
): Result<Graph, GraphError> => {
  const relationship = graph.relationshipsById[relationshipId];
  if (!relationship) {
    return err({
      code: 'RELATIONSHIP_NOT_FOUND',
      message: 'Relationship not found.',
      details: { relationshipId },
    });
  }

  const fromNodeId = relationship.from.nodeId;
  const toNodeId = relationship.to.nodeId;

  const nextRelationships = { ...graph.relationshipsById };
  delete nextRelationships[relationshipId];

  return ok({
    ...graph,
    relationshipsById: nextRelationships,
    outgoingByNodeId: {
      ...graph.outgoingByNodeId,
      [fromNodeId]: setDelete(graph.outgoingByNodeId, fromNodeId, relationshipId),
    },
    incomingByNodeId: {
      ...graph.incomingByNodeId,
      [toNodeId]: setDelete(graph.incomingByNodeId, toNodeId, relationshipId),
    },
  });
};

export const addRelationship = (
  graph: Graph,
  relationship: RelationshipEntity
): Result<Graph, GraphError> => {
  if (hasOwn(graph.relationshipsById, relationship.id)) {
    return err({
      code: 'RELATIONSHIP_ALREADY_EXISTS',
      message: 'Relationship with this id already exists.',
      details: { relationshipId: relationship.id },
    });
  }

  const validation = validateRelationship(graph.nodesById, relationship);
  if (!validation.ok) return validation;

  const fromNodeId = relationship.from.nodeId;
  const toNodeId = relationship.to.nodeId;

  return ok({
    ...graph,
    relationshipsById: {
      ...graph.relationshipsById,
      [relationship.id]: relationship,
    },
    outgoingByNodeId: {
      ...graph.outgoingByNodeId,
      [fromNodeId]: setAdd(graph.outgoingByNodeId, fromNodeId, relationship.id),
    },
    incomingByNodeId: {
      ...graph.incomingByNodeId,
      [toNodeId]: setAdd(graph.incomingByNodeId, toNodeId, relationship.id),
    },
  });
};

export const reconnectRelationship = (
  graph: Graph,
  relationshipId: RelationshipId,
  patch: { from?: RelationshipEntity['from']; to?: RelationshipEntity['to'] }
): Result<Graph, GraphError> => {
  const current = graph.relationshipsById[relationshipId];
  if (!current) {
    return err({
      code: 'RELATIONSHIP_NOT_FOUND',
      message: 'Relationship not found.',
      details: { relationshipId },
    });
  }

  const next: RelationshipEntity = {
    ...current,
    from: patch.from ?? current.from,
    to: patch.to ?? current.to,
  };

  const validation = validateRelationship(graph.nodesById, next);
  if (!validation.ok) return validation;

  const prevFrom = current.from.nodeId;
  const prevTo = current.to.nodeId;
  const nextFrom = next.from.nodeId;
  const nextTo = next.to.nodeId;

  const nextRelationshipsById = {
    ...graph.relationshipsById,
    [relationshipId]: next,
  };

  const nextOutgoingByNodeId = { ...graph.outgoingByNodeId };
  const nextIncomingByNodeId = { ...graph.incomingByNodeId };

  if (prevFrom !== nextFrom) {
    nextOutgoingByNodeId[prevFrom] = setDelete(graph.outgoingByNodeId, prevFrom, relationshipId);
    nextOutgoingByNodeId[nextFrom] = setAdd(graph.outgoingByNodeId, nextFrom, relationshipId);
  }

  if (prevTo !== nextTo) {
    nextIncomingByNodeId[prevTo] = setDelete(graph.incomingByNodeId, prevTo, relationshipId);
    nextIncomingByNodeId[nextTo] = setAdd(graph.incomingByNodeId, nextTo, relationshipId);
  }

  return ok({
    ...graph,
    relationshipsById: nextRelationshipsById,
    outgoingByNodeId: nextOutgoingByNodeId,
    incomingByNodeId: nextIncomingByNodeId,
  });
};

export const updateRelationship = (
  graph: Graph,
  relationshipId: RelationshipId,
  patch: Partial<import('./types').RelationshipAttributes>
): Result<Graph, GraphError> => {
  const current = graph.relationshipsById[relationshipId];
  if (!current) {
    return err({
      code: 'RELATIONSHIP_NOT_FOUND',
      message: 'Relationship not found.',
      details: { relationshipId },
    });
  }

  const next: RelationshipEntity = {
    ...current,
    attrs: {
      ...current.attrs,
      ...patch,
    },
  };

  return ok({
    ...graph,
    relationshipsById: {
      ...graph.relationshipsById,
      [relationshipId]: next,
    },
  });
};

export const removeNode = (graph: Graph, nodeId: NodeId): Result<Graph, GraphError> => {
  if (!hasOwn(graph.nodesById, nodeId)) {
    return err({
      code: 'NODE_NOT_FOUND',
      message: 'Node not found.',
      details: { nodeId },
    });
  }

  const incident = new Set<RelationshipId>();
  for (const id of graph.outgoingByNodeId[nodeId] ?? []) incident.add(id);
  for (const id of graph.incomingByNodeId[nodeId] ?? []) incident.add(id);

  let nextGraph: Graph = graph;
  for (const relationshipId of incident) {
    const removed = removeRelationship(nextGraph, relationshipId);
    // Should always succeed given indexes, but keep domain robust.
    if (removed.ok) nextGraph = removed.value;
  }

  const nextNodesById = { ...nextGraph.nodesById };
  delete nextNodesById[nodeId];

  const nextOutgoingByNodeId = { ...nextGraph.outgoingByNodeId };
  const nextIncomingByNodeId = { ...nextGraph.incomingByNodeId };
  delete nextOutgoingByNodeId[nodeId];
  delete nextIncomingByNodeId[nodeId];

  return ok({
    ...nextGraph,
    nodesById: nextNodesById,
    outgoingByNodeId: nextOutgoingByNodeId,
    incomingByNodeId: nextIncomingByNodeId,
  });
};

export const addNodes = (graph: Graph, nodes: NodeEntity[]): Result<Graph, GraphError[]> => {
  const errors: GraphError[] = [];

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      errors.push({
        code: 'NODE_ALREADY_EXISTS',
        message: 'Duplicate node id in batch.',
        details: { nodeId: node.id },
      });
      continue;
    }
    seen.add(node.id);

    if (hasOwn(graph.nodesById, node.id)) {
      errors.push({
        code: 'NODE_ALREADY_EXISTS',
        message: 'Node with this id already exists.',
        details: { nodeId: node.id },
      });
    }
  }

  if (errors.length > 0) return err(errors);

  let next = graph;
  for (const node of nodes) {
    const res = addNode(next, node);
    if (!res.ok) return err([res.error]);
    next = res.value;
  }

  return ok(next);
};

export const removeNodes = (graph: Graph, nodeIds: NodeId[]): Result<Graph, GraphError[]> => {
  const errors: GraphError[] = [];

  for (const nodeId of nodeIds) {
    if (!hasOwn(graph.nodesById, nodeId)) {
      errors.push({
        code: 'NODE_NOT_FOUND',
        message: 'Node not found.',
        details: { nodeId },
      });
    }
  }

  if (errors.length > 0) return err(errors);

  let next = graph;
  for (const nodeId of nodeIds) {
    const res = removeNode(next, nodeId);
    if (!res.ok) return err([res.error]);
    next = res.value;
  }

  return ok(next);
};

export const addRelationships = (
  graph: Graph,
  relationships: RelationshipEntity[]
): Result<Graph, GraphError[]> => {
  const errors: GraphError[] = [];

  const seen = new Set<string>();
  for (const relationship of relationships) {
    if (seen.has(relationship.id)) {
      errors.push({
        code: 'RELATIONSHIP_ALREADY_EXISTS',
        message: 'Duplicate relationship id in batch.',
        details: { relationshipId: relationship.id },
      });
      continue;
    }
    seen.add(relationship.id);

    if (hasOwn(graph.relationshipsById, relationship.id)) {
      errors.push({
        code: 'RELATIONSHIP_ALREADY_EXISTS',
        message: 'Relationship with this id already exists.',
        details: { relationshipId: relationship.id },
      });
      continue;
    }

    const validation = validateRelationship(graph.nodesById, relationship);
    if (!validation.ok) errors.push(validation.error);
  }

  if (errors.length > 0) return err(errors);

  let next = graph;
  for (const relationship of relationships) {
    const res = addRelationship(next, relationship);
    if (!res.ok) return err([res.error]);
    next = res.value;
  }

  return ok(next);
};

export const getOutgoing = (graph: Graph, nodeId: NodeId): RelationshipEntity[] => {
  const ids = graph.outgoingByNodeId[nodeId];
  if (!ids) return [];

  const result: RelationshipEntity[] = [];
  for (const id of ids) {
    const rel = graph.relationshipsById[id];
    if (rel) result.push(rel);
  }
  return result;
};

export const getIncoming = (graph: Graph, nodeId: NodeId): RelationshipEntity[] => {
  const ids = graph.incomingByNodeId[nodeId];
  if (!ids) return [];

  const result: RelationshipEntity[] = [];
  for (const id of ids) {
    const rel = graph.relationshipsById[id];
    if (rel) result.push(rel);
  }
  return result;
};

export const getRelationshipsForNode = (graph: Graph, nodeId: NodeId): RelationshipEntity[] => {
  const byId = new Map<RelationshipId, RelationshipEntity>();

  for (const rel of getOutgoing(graph, nodeId)) byId.set(rel.id, rel);
  for (const rel of getIncoming(graph, nodeId)) byId.set(rel.id, rel);

  return [...byId.values()];
};

export const neighbors = (graph: Graph, nodeId: NodeId): NodeId[] => {
  const out = getOutgoing(graph, nodeId).map((r) => r.to.nodeId);
  const inc = getIncoming(graph, nodeId).map((r) => r.from.nodeId);
  const uniq = new Set<NodeId>([...out, ...inc]);
  uniq.delete(nodeId);
  return [...uniq];
};

export const getSubgraph = (graph: Graph, nodeIds: NodeId[]): Graph => {
  const nodeIdSet = new Set<NodeId>(nodeIds);

  const nodesById: Graph['nodesById'] = {};
  for (const nodeId of nodeIdSet) {
    const node = graph.nodesById[nodeId];
    if (node) nodesById[nodeId] = node;
  }

  const relationshipsById: Graph['relationshipsById'] = {};
  for (const relationshipId of Object.keys(graph.relationshipsById) as RelationshipId[]) {
    const relationship = graph.relationshipsById[relationshipId];
    if (!relationship) continue;

    if (nodeIdSet.has(relationship.from.nodeId) && nodeIdSet.has(relationship.to.nodeId)) {
      relationshipsById[relationshipId] = relationship;
    }
  }

  // Build indexes eagerly (Phase 2 requirement). This is a small helper rebuild, isolated to subgraph creation.
  const outgoingByNodeId: Graph['outgoingByNodeId'] = {};
  const incomingByNodeId: Graph['incomingByNodeId'] = {};

  for (const nodeId of Object.keys(nodesById) as NodeId[]) {
    outgoingByNodeId[nodeId] = new Set<RelationshipId>();
    incomingByNodeId[nodeId] = new Set<RelationshipId>();
  }

  for (const relationshipId of Object.keys(relationshipsById) as RelationshipId[]) {
    const relationship = relationshipsById[relationshipId];
    (outgoingByNodeId[relationship.from.nodeId] as Set<RelationshipId>).add(relationshipId);
    (incomingByNodeId[relationship.to.nodeId] as Set<RelationshipId>).add(relationshipId);
  }

  return {
    id: graph.id,
    nodesById,
    relationshipsById,
    outgoingByNodeId,
    incomingByNodeId,
  };
};
