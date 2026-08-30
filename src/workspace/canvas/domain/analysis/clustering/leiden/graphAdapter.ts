import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto';
import { mapRelationshipAttrsToScalars } from './scalarMapping';

export type AdaptedEdge = {
  i: number;
  j: number;
  /** Always finite and > 0 (magnitude). */
  w: number;
  sign: 1 | -1;
};

export type AdaptedLayer = {
  edges: AdaptedEdge[];
  layerWeight: number;
};

export type AdaptedMultiplexGraph = {
  /** Deterministic index -> nodeId mapping. */
  nodeIdByIndex: string[];
  /** nodeId -> index mapping. */
  nodeIndexById: Record<string, number>;

  /** Per-layer signed weighted edge lists. */
  layers: Record<string, AdaptedLayer>;
};

export type AdaptGraphOptions = {
  /** Per-layer weights used later in the multiplex objective. */
  layerWeights?: Record<string, number>;

  /** Treat relationships as undirected for clustering (recommended). Default true. */
  undirected?: boolean;

  /** Sum parallel edges between the same pair for the same sign/layer. Default true. */
  mergeParallelEdges?: boolean;
};

function stableNodeIds(dto: GraphCanvasDTO): string[] {
  // Deterministic ordering makes runs more reproducible.
  return Object.values(dto.graph.nodes)
    .map((n) => n.id)
    .filter((id) => typeof id === 'string' && id.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Adapts a canvas DTO into numeric structures suitable for Leiden.
 *
 * - Relationships are treated as undirected by default.
 * - Edge weights are aggregated (summed) per (layer, sign, unordered pair) by default.
 * - Negative edges are represented as sign=-1 with positive magnitude w.
 */
export function adaptDtoToMultiplexGraph(
  dto: GraphCanvasDTO,
  options: AdaptGraphOptions = {},
): AdaptedMultiplexGraph {
  const undirected = options.undirected ?? true;
  const mergeParallelEdges = options.mergeParallelEdges ?? true;
  const layerWeights = options.layerWeights ?? {};

  const nodeIdByIndex = stableNodeIds(dto);
  const nodeIndexById: Record<string, number> = Object.fromEntries(
    nodeIdByIndex.map((id, idx) => [id, idx]),
  );

  // Temporary aggregation per layer.
  const layerEdgeMaps: Record<string, Map<string, AdaptedEdge>> = {};

  // Deterministic relationship ordering makes results reproducible across runtimes.
  const relationships = Object.values(dto.graph.relationships).slice();
  relationships.sort((a, b) => {
    const aId = a.id == null ? '' : String(a.id);
    const bId = b.id == null ? '' : String(b.id);
    if (aId !== bId) return aId.localeCompare(bId);

    const aFrom = String(a.from.nodeId ?? '');
    const bFrom = String(b.from.nodeId ?? '');
    if (aFrom !== bFrom) return aFrom.localeCompare(bFrom);

    const aTo = String(a.to.nodeId ?? '');
    const bTo = String(b.to.nodeId ?? '');
    if (aTo !== bTo) return aTo.localeCompare(bTo);

    return 0;
  });

  for (let relIndex = 0; relIndex < relationships.length; relIndex++) {
    const rel = relationships[relIndex];
    const fromId = rel.from.nodeId;
    const toId = rel.to.nodeId;

    const i0 = nodeIndexById[fromId];
    const j0 = nodeIndexById[toId];

    // Skip edges whose endpoints are missing from the node set.
    if (typeof i0 !== 'number' || typeof j0 !== 'number') continue;

    // Drop self-loops for clustering (consistent with plan's validation guidance).
    if (i0 === j0) continue;

    const { weight, sign, layer } = mapRelationshipAttrsToScalars(rel.attrs);

    const i = undirected ? Math.min(i0, j0) : i0;
    const j = undirected ? Math.max(i0, j0) : j0;

    // Key includes sign so positive and negative edges don't get mixed.
    const key = `${i}|${j}|${sign}`;

    const map = (layerEdgeMaps[layer] ??= new Map<string, AdaptedEdge>());

    if (!mergeParallelEdges) {
      // If not merging, force uniqueness.
      map.set(`${key}|${rel.id ?? ''}|${relIndex}`, { i, j, w: weight, sign });
      continue;
    }

    const prev = map.get(key);
    if (!prev) {
      map.set(key, { i, j, w: weight, sign });
      continue;
    }

    prev.w += weight;
  }

  const layers: Record<string, AdaptedLayer> = {};
  const layerNames = Object.keys(layerEdgeMaps).sort((a, b) => a.localeCompare(b));
  for (const layer of layerNames) {
    const edgeMap = layerEdgeMaps[layer]!;
    const layerWeight = Number.isFinite(layerWeights[layer]) ? (layerWeights[layer] as number) : 1;
    const edges = Array.from(edgeMap.values());
    // Stable sort guarantees deterministic adjacency iteration and tie-breaking.
    edges.sort((a, b) => (a.i - b.i) || (a.j - b.j) || (a.sign - b.sign));
    layers[layer] = {
      edges,
      layerWeight,
    };
  }

  // Ensure at least a default layer is present even for empty graphs.
  if (!layers.default) {
    layers.default = { edges: [], layerWeight: Number.isFinite(layerWeights.default) ? (layerWeights.default as number) : 1 };
  }

  return { nodeIdByIndex, nodeIndexById, layers };
}
