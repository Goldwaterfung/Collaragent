import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto';
import { mapRelationshipAttrsToScalars } from './scalarMapping';

export type ValidationIssue = {
  level: 'warning' | 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ValidateDtoResult = {
  issues: ValidationIssue[];
};

/**
 * Lightweight validation for clustering.
 *
 * - Does not mutate the DTO.
 * - Designed to be safe to run in UI thread.
 */
export function validateGraphCanvasDtoForClustering(dto: GraphCanvasDTO): ValidateDtoResult {
  const issues: ValidationIssue[] = [];

  const nodeIds = new Set(Object.values(dto.graph.nodes).map((n) => n.id));

  let missingEndpointCount = 0;
  let selfLoopCount = 0;
  let invalidWeightCount = 0;

  for (const rel of Object.values(dto.graph.relationships)) {
    const fromId = rel.from.nodeId;
    const toId = rel.to.nodeId;

    if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
      missingEndpointCount++;
      continue;
    }

    if (fromId === toId) {
      selfLoopCount++;
    }

    const { weight, layer } = mapRelationshipAttrsToScalars(rel.attrs);

    if (!Number.isFinite(weight) || weight <= 0) {
      invalidWeightCount++;
    }

    if (!layer || typeof layer !== 'string') {
      issues.push({
        level: 'warning',
        code: 'INVALID_LAYER',
        message: 'Relationship layer is invalid; default will be used.',
        details: { relationshipId: rel.id, layer },
      });
    }
  }

  if (missingEndpointCount > 0) {
    issues.push({
      level: 'warning',
      code: 'MISSING_ENDPOINTS',
      message: 'Some relationships reference missing nodes and will be ignored by clustering.',
      details: { count: missingEndpointCount },
    });
  }

  if (selfLoopCount > 0) {
    issues.push({
      level: 'warning',
      code: 'SELF_LOOPS',
      message: 'Self-loop relationships will be ignored by clustering.',
      details: { count: selfLoopCount },
    });
  }

  if (invalidWeightCount > 0) {
    issues.push({
      level: 'warning',
      code: 'INVALID_WEIGHTS',
      message: 'Some relationships had invalid weights; defaults/clamps will be applied.',
      details: { count: invalidWeightCount },
    });
  }

  if (Object.keys(dto.graph.nodes).length === 0) {
    issues.push({
      level: 'warning',
      code: 'EMPTY_GRAPH',
      message: 'Graph has no nodes; clustering will be a no-op.',
    });
  }

  return { issues };
}
