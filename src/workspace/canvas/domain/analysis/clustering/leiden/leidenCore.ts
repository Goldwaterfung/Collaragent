import type { AdaptedEdge, AdaptedMultiplexGraph } from './graphAdapter';
import { buildLayerContexts, type LayerContext } from './multiplex';
import { createRng } from './rng';
import { normalizeSignedOptions } from './signed';

export type LeidenCoreOptions = {
  seed?: number;

  /** Modularity resolution parameter for positive edges. Default 1. */
  gamma?: number;

  /** Signed handling (only penalty implemented in this first pass). */
  signedMode?: 'penalty' | 'signed-modularity';

  /** Penalty multiplier for negative edges (penalty mode). Default 1. */
  lambda?: number;

  /** Stop when no move improves above this threshold. Default 1e-12. */
  epsilon?: number;

  /** Max local-move passes. Default 20. */
  maxPasses?: number;
};

export type LeidenPartition = {
  communityOf: Int32Array;
  communityCount: number;
};

export type LeidenHierarchicalResult = {
  /** Per-level community id for each original node index (level 0..k-1). */
  communityOfByLevel: Int32Array[];
  /** Community count per level (aligned with communityOfByLevel). */
  communityCountByLevel: number[];
};

export type LeidenHierarchicalHooks = {
  onLevel?: (level: number, info: { nNodes: number; communityCount: number }) => void;
};

function deltaQPos(
  layer: LayerContext,
  gamma: number,
  k_i: number,
  k_i_in_new: number,
  k_i_in_old: number,
  cNew: number,
  cOld: number,
): number {
  if (layer.m2Pos <= 0) return 0;

  const m2 = layer.m2Pos;

  const totNew = layer.totPos[cNew];
  const totOld = layer.totPos[cOld];
  const in2New = layer.inPos2[cNew];
  const in2Old = layer.inPos2[cOld];

  const qNewBefore = in2New / m2 - gamma * Math.pow(totNew / m2, 2);
  const qOldBefore = in2Old / m2 - gamma * Math.pow(totOld / m2, 2);

  const qNewAfter = (in2New + 2 * k_i_in_new) / m2 - gamma * Math.pow((totNew + k_i) / m2, 2);
  const qOldAfter = (in2Old - 2 * k_i_in_old) / m2 - gamma * Math.pow((totOld - k_i) / m2, 2);

  return (qNewAfter + qOldAfter) - (qNewBefore + qOldBefore);
}

function deltaPenaltyNeg(
  layer: LayerContext,
  lambda: number,
  negInNew: number,
  negInOld: number,
): number {
  if (layer.totalNeg <= 0) return 0;
  // Penalty term: -(lambda/totalNeg) * sum_{neg edges inside communities} w
  // Moving i changes inside-neg weight by (+negInNew - negInOld)
  return -(lambda * (negInNew - negInOld)) / layer.totalNeg;
}

/**
 * First-pass Leiden-style local moving (no refinement/aggregation yet).
 *
 * Supports:
 * - multiplex layers (sum of per-layer objectives scaled by layerWeight)
 * - signed penalty mode (negative edges discourage co-clustering)
 */
export function runLeidenLocalMoving(
  graph: AdaptedMultiplexGraph,
  options: LeidenCoreOptions = {},
): LeidenPartition {
  const n = graph.nodeIdByIndex.length;
  const communityOf = new Int32Array(n);
  for (let i = 0; i < n; i++) communityOf[i] = i;

  if (n <= 1) {
    return { communityOf, communityCount: n };
  }

  const rng = createRng(options.seed ?? Date.now());
  const gamma = Number.isFinite(options.gamma) ? (options.gamma as number) : 1;
  const epsilon = Number.isFinite(options.epsilon) ? (options.epsilon as number) : 1e-12;
  const maxPasses = Number.isFinite(options.maxPasses) ? (options.maxPasses as number) : 20;
  const signed = normalizeSignedOptions({ signedMode: options.signedMode, lambda: options.lambda });

  const layers = buildLayerContexts(graph);
  const layerCount = layers.length;
  const bufLen = layerCount * 2;
  const candidateBufPool: Float64Array[] = [];
  const candidateKeys: number[] = [];

  const takeCandidateBuf = () => {
    const buf = candidateBufPool.pop() ?? new Float64Array(bufLen);
    buf.fill(0);
    return buf;
  };

  const releaseCandidateBufs = (candidate: Map<number, Float64Array>) => {
    for (const buf of candidate.values()) candidateBufPool.push(buf);
    candidate.clear();
  };

  // Community sizes for pruning empty communities.
  const communitySize = new Int32Array(n);
  for (let i = 0; i < n; i++) communitySize[i] = 1;

  const order = Array.from({ length: n }, (_, i) => i);

  for (let pass = 0; pass < maxPasses; pass++) {
    rng.shuffleInPlace(order);

    let movedAny = false;

    // Candidate community weights buffer, reused across nodes.
    const candidate = new Map<number, Float64Array>();

    for (const i of order) {
      // Ensure no data from previous node leaks in.
      releaseCandidateBufs(candidate);

      const cOld = communityOf[i];

      // Collect candidate communities from neighbors across all layers.
      // For each candidate community, accumulate per-layer pos/neg weights.
      for (let li = 0; li < layerCount; li++) {
        const layer = layers[li];
        const adj = layer.adjacency[i];

        const posIndex = 2 * li;
        const negIndex = posIndex + 1;

        for (const e of adj) {
          const c = communityOf[e.j];
          let buf = candidate.get(c);
          if (!buf) {
            buf = takeCandidateBuf();
            candidate.set(c, buf);
          }

          if (e.sign === 1) buf[posIndex] += e.w;
          else buf[negIndex] += e.w;
        }
      }

      // Always consider staying.
      if (!candidate.has(cOld)) {
        candidate.set(cOld, takeCandidateBuf());
      }

      let bestDelta = 0;
      let bestCommunity = cOld;

      const oldBuf = candidate.get(cOld)!;

      candidateKeys.length = 0;
      for (const key of candidate.keys()) candidateKeys.push(key);
      candidateKeys.sort((a, b) => a - b);

      for (const cNew of candidateKeys) {
        const newBuf = candidate.get(cNew)!;
        if (cNew === cOld) continue;
        if (communitySize[cNew] <= 0) continue;

        let delta = 0;

        for (let li = 0; li < layerCount; li++) {
          const layer = layers[li];
          const alpha = layer.alpha;

          const k_i = layer.degreePos[i];
          const loopPos = layer.selfLoopPos[i];
          const k_i_in_new = newBuf[2 * li] + loopPos;
          const k_i_in_old = oldBuf[2 * li] + loopPos;

          const dPos = deltaQPos(layer, gamma, k_i, k_i_in_new, k_i_in_old, cNew, cOld);

          // Signed penalty mode
          let dNeg = 0;
          if (signed.signedMode === 'penalty') {
            const loopNeg = layer.selfLoopNeg[i];
            const negInNew = newBuf[2 * li + 1] + loopNeg;
            const negInOld = oldBuf[2 * li + 1] + loopNeg;
            dNeg = deltaPenaltyNeg(layer, signed.lambda, negInNew, negInOld);
          }

          delta += alpha * (dPos + dNeg);
        }

        if (delta > bestDelta + epsilon) {
          bestDelta = delta;
          bestCommunity = cNew;
        } else if (Math.abs(delta - bestDelta) <= epsilon && cNew < bestCommunity) {
          // Deterministic tie-break: smallest community id wins.
          bestDelta = delta;
          bestCommunity = cNew;
        }
      }

      if (bestCommunity === cOld) continue;

      // Apply move: update community aggregates for each layer.
      for (let li = 0; li < layerCount; li++) {
        const layer = layers[li];
        const k_i = layer.degreePos[i];

        const loopPos = layer.selfLoopPos[i];
        const k_i_in_old = oldBuf[2 * li] + loopPos;
        const k_i_in_new = (candidate.get(bestCommunity)?.[2 * li] ?? 0) + loopPos;

        layer.totPos[cOld] -= k_i;
        layer.inPos2[cOld] -= 2 * k_i_in_old;

        layer.totPos[bestCommunity] += k_i;
        layer.inPos2[bestCommunity] += 2 * k_i_in_new;
      }

      communitySize[cOld] -= 1;
      communitySize[bestCommunity] += 1;
      communityOf[i] = bestCommunity;
      movedAny = true;
    }

    // Safety: ensure buffers are released before next pass.
    releaseCandidateBufs(candidate);

    if (!movedAny) break;
  }

  // Compact community ids to 0..k-1 for nicer output.
  const remap = new Map<number, number>();
  let nextId = 0;
  for (let i = 0; i < n; i++) {
    const c = communityOf[i];
    if (!remap.has(c)) remap.set(c, nextId++);
  }
  for (let i = 0; i < n; i++) {
    communityOf[i] = remap.get(communityOf[i])!;
  }

  return { communityOf, communityCount: nextId };
}

function induceSubgraphFromAdjacency(
  graph: AdaptedMultiplexGraph,
  layerContexts: LayerContext[],
  members: number[],
): AdaptedMultiplexGraph {
  const subN = members.length;
  const nodeIdByIndex = Array.from({ length: subN }, (_, i) => String(i));
  const nodeIndexById: Record<string, number> = Object.fromEntries(
    nodeIdByIndex.map((id, idx) => [id, idx]),
  );

  // Fast membership check without allocating O(n) markers per community.
  const localIndexByOld = new Map<number, number>();
  for (let li = 0; li < subN; li++) localIndexByOld.set(members[li], li);

  const ctxByName = new Map<string, LayerContext>();
  for (const ctx of layerContexts) ctxByName.set(ctx.name, ctx);

  const layers: AdaptedMultiplexGraph['layers'] = {};
  const layerNames = Object.keys(graph.layers).sort((a, b) => a.localeCompare(b));

  for (const layerName of layerNames) {
    const map = new Map<string, AdaptedEdge>();
    const layer = graph.layers[layerName]!;
    const ctx = ctxByName.get(layerName);
    if (!ctx) {
      layers[layerName] = { edges: [], layerWeight: layer.layerWeight };
      continue;
    }

    // Add self-loops from context.
    for (let li = 0; li < subN; li++) {
      const oldIndex = members[li];
      const loopPos = ctx.selfLoopPos[oldIndex];
      if (loopPos > 0) {
        map.set(`${li}|${li}|1`, { i: li, j: li, w: loopPos, sign: 1 });
      }
      const loopNeg = ctx.selfLoopNeg[oldIndex];
      if (loopNeg > 0) {
        map.set(`${li}|${li}|-1`, { i: li, j: li, w: loopNeg, sign: -1 });
      }
    }

    for (let li = 0; li < subN; li++) {
      const oldI = members[li];
      const adj = ctx.adjacency[oldI];

      for (const e of adj) {
        const oldJ = e.j;
        const lj = localIndexByOld.get(oldJ);
        if (lj === undefined) continue;
        if (li >= lj) continue; // keep one direction only

        const key = `${li}|${lj}|${e.sign}`;
        const prev = map.get(key);
        if (!prev) {
          map.set(key, { i: li, j: lj, w: e.w, sign: e.sign });
        } else {
          prev.w += e.w;
        }
      }
    }

    const edges = Array.from(map.values()).sort((a, b) => (a.i - b.i) || (a.j - b.j) || (a.sign - b.sign));
    layers[layerName] = { edges, layerWeight: layer.layerWeight };
  }

  return { nodeIdByIndex, nodeIndexById, layers };
}

function refineWithinCommunities(
  graph: AdaptedMultiplexGraph,
  partition: LeidenPartition,
  options: LeidenCoreOptions,
): LeidenPartition {
  const n = graph.nodeIdByIndex.length;
  const layerContexts = buildLayerContexts(graph);
  const membersByCommunity: number[][] = Array.from({ length: partition.communityCount }, () => []);
  for (let i = 0; i < n; i++) {
    const c = partition.communityOf[i];
    if (c >= 0 && c < membersByCommunity.length) membersByCommunity[c].push(i);
  }

  const refined = new Int32Array(n);
  let nextCommunityId = 0;

  for (const members of membersByCommunity) {
    if (members.length === 0) continue;
    if (members.length === 1) {
      refined[members[0]] = nextCommunityId++;
      continue;
    }

    const subgraph = induceSubgraphFromAdjacency(graph, layerContexts, members);
    const subPartition = runLeidenLocalMoving(subgraph, options);

    // Allocate global ids for each sub-community.
    const subToGlobal = new Int32Array(subPartition.communityCount);
    for (let sc = 0; sc < subPartition.communityCount; sc++) {
      subToGlobal[sc] = nextCommunityId++;
    }

    for (let li = 0; li < members.length; li++) {
      const oldIndex = members[li];
      refined[oldIndex] = subToGlobal[subPartition.communityOf[li]];
    }
  }

  return { communityOf: refined, communityCount: nextCommunityId };
}

function aggregateGraph(
  graph: AdaptedMultiplexGraph,
  communityOf: ArrayLike<number>,
  communityCount: number,
): AdaptedMultiplexGraph {
  const nodeIdByIndex = Array.from({ length: communityCount }, (_, i) => `C${i}`);
  const nodeIndexById: Record<string, number> = Object.fromEntries(
    nodeIdByIndex.map((id, idx) => [id, idx]),
  );

  const layers: AdaptedMultiplexGraph['layers'] = {};
  const layerNames = Object.keys(graph.layers).sort((a, b) => a.localeCompare(b));
  for (const layerName of layerNames) {
    const layer = graph.layers[layerName]!;
    const map = new Map<string, AdaptedEdge>();

    for (const e of layer.edges) {
      const ci0 = communityOf[e.i];
      const cj0 = communityOf[e.j];
      if (typeof ci0 !== 'number' || typeof cj0 !== 'number') continue;

      const i = Math.min(ci0, cj0);
      const j = Math.max(ci0, cj0);
      const key = `${i}|${j}|${e.sign}`;

      const prev = map.get(key);
      if (!prev) {
        map.set(key, { i, j, w: e.w, sign: e.sign });
      } else {
        prev.w += e.w;
      }
    }

    layers[layerName] = {
      edges: Array.from(map.values()).sort((a, b) => (a.i - b.i) || (a.j - b.j) || (a.sign - b.sign)),
      layerWeight: layer.layerWeight,
    };
  }

  return { nodeIdByIndex, nodeIndexById, layers };
}

/**
 * Full Leiden loop: local moving -> refinement -> aggregation (repeat).
 *
 * This returns community assignments for the ORIGINAL nodes at each aggregation level.
 */
export function runLeidenHierarchical(
  graph: AdaptedMultiplexGraph,
  options: LeidenCoreOptions & { maxLevels?: number } = {},
  hooks: LeidenHierarchicalHooks = {},
): LeidenHierarchicalResult {
  const maxLevels = Number.isFinite(options.maxLevels) ? (options.maxLevels as number) : 10;

  const nOriginal = graph.nodeIdByIndex.length;
  const mappingOriginalToCurrent = new Int32Array(nOriginal);
  for (let i = 0; i < nOriginal; i++) mappingOriginalToCurrent[i] = i;

  const communityOfByLevel: Int32Array[] = [];
  const communityCountByLevel: number[] = [];

  let currentGraph = graph;

  for (let level = 0; level < maxLevels; level++) {
    const moved = runLeidenLocalMoving(currentGraph, options);
    const refined = refineWithinCommunities(currentGraph, moved, options);

    // Update original->current mapping to be original->refinedCommunity at this level.
    for (let i = 0; i < nOriginal; i++) {
      mappingOriginalToCurrent[i] = refined.communityOf[mappingOriginalToCurrent[i]];
    }

    communityOfByLevel.push(new Int32Array(mappingOriginalToCurrent));
    communityCountByLevel.push(refined.communityCount);

    hooks.onLevel?.(level, {
      nNodes: currentGraph.nodeIdByIndex.length,
      communityCount: refined.communityCount,
    });

    const nCurrent = currentGraph.nodeIdByIndex.length;
    if (refined.communityCount <= 1) break;
    if (refined.communityCount >= nCurrent) break;

    currentGraph = aggregateGraph(currentGraph, refined.communityOf, refined.communityCount);
  }

  return { communityOfByLevel, communityCountByLevel };
}
