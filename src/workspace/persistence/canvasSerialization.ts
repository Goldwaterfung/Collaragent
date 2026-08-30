
import { 
  buildGraph, 
  type Graph, 
  type GraphError,
  type NodeEntity, 
  type RelationshipEntity, 
  asGraphId, 
  asNodeId, 
  asRelationshipId, 
  createCardinalPorts 
} from '@workspace/canvas/domain';
import type { CanvasState, NodeLayout } from '@workspace/canvas/types';
import { migrateGraphCanvasDTO, type GraphCanvasDTO } from './graphCanvasDto';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants';

export class CanvasHydrationError extends Error {
  readonly graphId: string;
  readonly graphErrors: GraphError[];

  constructor(params: { graphId: string; graphErrors: GraphError[] }) {
    const details = params.graphErrors
      .map((err) => `${err.code}: ${err.message}`)
      .join(' | ');
    super(`Failed to hydrate canvas graph ${params.graphId}. ${details}`);
    this.name = 'CanvasHydrationError';
    this.graphId = params.graphId;
    this.graphErrors = params.graphErrors;
  }
}

function sanitizeNodeAttrs(attrs: Record<string, unknown>): Record<string, unknown> | undefined {
  // Phase 5 rule: do not embed editor/Lexical content in the canvas document.
  // Some UI flows still attach transient `content` for initial card state; strip it here.
  const { content, editorState, ...rest } = attrs as any;
  const keys = Object.keys(rest);
  return keys.length > 0 ? rest : undefined;
}

export function serializeCanvas(state: CanvasState): GraphCanvasDTO {
  const nodes: GraphCanvasDTO['graph']['nodes'] = {};
  for (const node of Object.values(state.domain.graph.nodesById)) {
    nodes[String(node.id)] = {
      id: String(node.id),
      type: 'card',
      name: node.name,
      attrs: sanitizeNodeAttrs(node.attrs),
    };
  }

  const relationships: GraphCanvasDTO['graph']['relationships'] = {};
  for (const rel of Object.values(state.domain.graph.relationshipsById)) {
    relationships[String(rel.id)] = {
      id: String(rel.id),
      from: { nodeId: String(rel.from.nodeId), portId: rel.from.portId ? String(rel.from.portId) : undefined },
      to: { nodeId: String(rel.to.nodeId), portId: rel.to.portId ? String(rel.to.portId) : undefined },
      attrs: Object.keys(rel.attrs ?? {}).length > 0 ? rel.attrs : undefined,
    };
  }

  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: { nodes, relationships },
    layout: {
      layoutByNodeId: Object.fromEntries(
        Object.entries(state.layout.layoutByNodeId).map(([nodeId, layout]) => [
          String(nodeId),
          { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
        ]),
      ),
    },
    meta: {
      updatedAt: new Date().toISOString(),
    },
  };
}

export function deserializeCanvas(dtoUnknown: unknown, options?: { graphId?: string }): {
  graph: Graph;
  layoutByNodeId: Record<string, NodeLayout>;
} {
  const dto: GraphCanvasDTO = migrateGraphCanvasDTO(dtoUnknown);
  const graphId = asGraphId(options?.graphId ?? 'graph-1');

  // First pass: extract layout dimensions for port generation
  const layoutByNodeId: Record<string, NodeLayout> = dto.layout.layoutByNodeId;

  const nodesById: Record<any, NodeEntity> = {};
  for (const node of Object.values(dto.graph.nodes)) {
    const nodeId = asNodeId(node.id);
    // Get layout to determine port positions
    const nodeLayout = layoutByNodeId[node.id];
    const width = nodeLayout?.width ?? DEFAULT_NODE_WIDTH;
    const height = nodeLayout?.height ?? DEFAULT_NODE_HEIGHT;

    nodesById[nodeId] = {
      id: nodeId,
      type: 'card',
      name: node.name,
      attrs: node.attrs ?? {},
      // Generate 4 cardinal ports based on node dimensions
      ports: createCardinalPorts(node.id, width, height),
    };
  }

  const relationshipsById: Record<any, RelationshipEntity> = {};
  for (const rel of Object.values(dto.graph.relationships)) {
    const relId = asRelationshipId(rel.id);
    relationshipsById[relId] = {
      id: relId,
      from: { 
        nodeId: asNodeId(rel.from.nodeId), 
        portId: rel.from.portId ? (rel.from.portId as any) : undefined 
      },
      to: { 
        nodeId: asNodeId(rel.to.nodeId), 
        portId: rel.to.portId ? (rel.to.portId as any) : undefined 
      },
      attrs: rel.attrs ?? {},
    };
  }

  const built = buildGraph({ id: graphId, nodesById, relationshipsById });
  if (!built.ok) {
    throw new CanvasHydrationError({
      graphId,
      graphErrors: built.error,
    });
  }

  const graph = built.value;

  return { graph, layoutByNodeId };
}
