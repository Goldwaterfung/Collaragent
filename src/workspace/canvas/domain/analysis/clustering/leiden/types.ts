import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto';

export type HierarchicalLeidenOptions = {
  /** Optional seed for deterministic runs (future use). */
  seed?: number;

  /** Max hierarchy levels (future use). */
  maxLevels?: number;

  /** Signed edge handling strategy (future use). */
  signedMode?: 'penalty' | 'signed-modularity';

  /** Penalty multiplier for negative edges (penalty mode). Default 1. */
  lambda?: number;

  /** Modularity resolution parameter for positive edges. Default 1. */
  gamma?: number;

  /** Multiplex layer weights (future use). */
  layerWeights?: Record<string, number>;
};

export type HierarchicalLeidenResult = {
  /** Provenance identifier for the clustering run. */
  clusterRunId: string;

  /** The DTO that was mutated/produced by the run. */
  dto: GraphCanvasDTO;
};
