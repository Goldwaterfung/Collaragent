import type { AdaptedEdge, AdaptedMultiplexGraph } from './graphAdapter';

export type LayerContext = {
  name: string;
  alpha: number;

  // For positive modularity term
  m2Pos: number; // 2 * total positive weight
  degreePos: Float64Array;

  /** Positive self-loop weight per node (counted once). */
  selfLoopPos: Float64Array;

  // For negative penalty term
  totalNeg: number; // total negative weight (not doubled)

  /** Negative self-loop weight magnitude per node (counted once). */
  selfLoopNeg: Float64Array;

  adjacency: Array<Array<{ j: number; w: number; sign: 1 | -1 }>>;

  // Community aggregates (indexed by community id)
  totPos: Float64Array;
  inPos2: Float64Array;
};

function buildAdjacency(n: number, edges: AdaptedEdge[]): Array<Array<{ j: number; w: number; sign: 1 | -1 }>> {
  const adj: Array<Array<{ j: number; w: number; sign: 1 | -1 }>> = Array.from({ length: n }, () => []);

  for (const e of edges) {
    // Self-loops are handled separately via selfLoopPos/selfLoopNeg.
    // Keeping them out of adjacency avoids double-counting during move evaluation.
    if (e.i === e.j) continue;
    // Edges are stored as i<j for undirected; add both directions.
    adj[e.i].push({ j: e.j, w: e.w, sign: e.sign });
    adj[e.j].push({ j: e.i, w: e.w, sign: e.sign });
  }

  return adj;
}

export function buildLayerContexts(graph: AdaptedMultiplexGraph): LayerContext[] {
  const n = graph.nodeIdByIndex.length;

  const layers: LayerContext[] = [];

  const layerNames = Object.keys(graph.layers).sort((a, b) => a.localeCompare(b));
  for (const name of layerNames) {
    const layer = graph.layers[name]!;
    const degreePos = new Float64Array(n);
    const selfLoopPos = new Float64Array(n);
    const selfLoopNeg = new Float64Array(n);
    let mPos = 0;
    let totalNeg = 0;

    for (const e of layer.edges) {
      if (e.sign === 1) {
        if (e.i === e.j) {
          // For undirected graphs, a loop contributes 2w to degree and w to total edge weight.
          selfLoopPos[e.i] += e.w;
          degreePos[e.i] += 2 * e.w;
          mPos += e.w;
        } else {
          degreePos[e.i] += e.w;
          degreePos[e.j] += e.w;
          mPos += e.w;
        }
      } else {
        if (e.i === e.j) {
          selfLoopNeg[e.i] += e.w;
          totalNeg += e.w;
        } else {
          totalNeg += e.w;
        }
      }
    }

    const m2Pos = 2 * mPos;
    const adjacency = buildAdjacency(n, layer.edges);

    // Start with each node as its own community.
    const totPos = new Float64Array(n);
    const inPos2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      totPos[i] = degreePos[i];
      // A node's self-loop is internal to its singleton community.
      inPos2[i] = 2 * selfLoopPos[i];
    }

    layers.push({
      name,
      alpha: layer.layerWeight,
      m2Pos,
      degreePos,
      selfLoopPos,
      totalNeg,
      selfLoopNeg,
      adjacency,
      totPos,
      inPos2,
    });
  }

  return layers;
}
