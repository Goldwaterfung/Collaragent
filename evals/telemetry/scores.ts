/**
 * evals/telemetry/scores.ts
 * Standardized score taxonomy, data types, and conversion helpers for Langfuse evaluation scoring.
 */

import type { ScenarioInvariantSummary } from '../assertions/types'

/**
 * Standardized evaluation score metric names.
 */
export const SCORE_NAMES = {
  BENCHMARK_PASSED: 'benchmark_passed',
  TOOL_SELECTION_ACCURACY: 'tool_selection_accuracy',
  SCHEMA_ADHERENCE: 'schema_adherence',
  INVARIANT_INTEGRITY: 'invariant_integrity',
  ROLLBACK_INVARIANT_PASSED: 'rollback_invariant_passed',
  ERROR_RECOVERY_SUCCESS: 'error_recovery_success',
  LATENCY_TTFT_MS: 'latency_ttft_ms',
  DURATION_MS: 'duration_ms',
  TOTAL_TOKENS: 'total_tokens'
} as const

export type ScoreName = (typeof SCORE_NAMES)[keyof typeof SCORE_NAMES]

/**
 * Supported Langfuse score data types.
 */
export type ScoreDataType = 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL'

/**
 * Structured score representation ready for ingestion into Langfuse.
 */
export interface EvaluationScore {
  readonly name: string
  readonly value: number | string
  readonly dataType: ScoreDataType
  readonly comment?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Parameters for creating an evaluation score.
 */
export interface CreateScoreParams {
  readonly traceId: string
  readonly score: EvaluationScore
  readonly observationId?: string
  readonly datasetRunId?: string
}

/**
 * Parameters for creating multiple evaluation scores in a batch.
 */
export interface CreateBatchScoresParams {
  readonly traceId: string
  readonly scores: readonly EvaluationScore[]
  readonly observationId?: string
  readonly datasetRunId?: string
}

/**
 * Transforms a ScenarioInvariantSummary into a list of standardized Langfuse evaluation scores.
 *
 * @param summary Scenario assertion outcome summary
 * @param extraMetadata Optional contextual metadata attached to each score
 * @returns Array of formatted EvaluationScore objects
 */
export function formatScoresFromSummary(
  summary: ScenarioInvariantSummary,
  extraMetadata?: Readonly<Record<string, unknown>>
): readonly EvaluationScore[] {
  const metadata = {
    ...summary.details,
    ...extraMetadata
  }

  const scores: EvaluationScore[] = [
    {
      name: SCORE_NAMES.BENCHMARK_PASSED,
      value: summary.passed ? 1 : 0,
      dataType: 'BOOLEAN',
      comment: summary.passed
        ? 'All scenario benchmark assertions passed'
        : `Scenario failed: ${summary.errors.join('; ')}`,
      metadata
    },
    {
      name: SCORE_NAMES.TOOL_SELECTION_ACCURACY,
      value: summary.toolSelectionAccuracy,
      dataType: 'NUMERIC',
      comment:
        summary.toolSelectionAccuracy === 1.0
          ? 'Tool selection matches expected sequence'
          : 'Tool selection deviated from expected sequence',
      metadata
    },
    {
      name: SCORE_NAMES.SCHEMA_ADHERENCE,
      value: summary.schemaAdherence,
      dataType: 'NUMERIC',
      comment:
        summary.schemaAdherence === 1.0
          ? 'Tool arguments conform strictly to Zod schemas'
          : 'Tool arguments failed schema validation',
      metadata
    },
    {
      name: SCORE_NAMES.INVARIANT_INTEGRITY,
      value: summary.invariantIntegrity,
      dataType: 'NUMERIC',
      comment:
        summary.invariantIntegrity === 1.0
          ? 'All document AST, graph DAG, and structure invariants verified'
          : `Invariant violations detected: ${summary.errors.join('; ')}`,
      metadata
    },
    {
      name: SCORE_NAMES.ROLLBACK_INVARIANT_PASSED,
      value: summary.rollbackInvariantPassed ? 1 : 0,
      dataType: 'BOOLEAN',
      comment: summary.rollbackInvariantPassed
        ? 'Rollback achieved 100% byte-identical restoration'
        : 'Rollback failed byte parity verification',
      metadata
    },
    {
      name: SCORE_NAMES.ERROR_RECOVERY_SUCCESS,
      value: summary.errorRecoverySuccess ? 1 : 0,
      dataType: 'BOOLEAN',
      comment: summary.errorRecoverySuccess
        ? 'Injected runtime error was autonomously healed within threshold'
        : 'Autonomous error recovery was not achieved',
      metadata
    }
  ]

  if (typeof extraMetadata?.totalTokens === 'number') {
    scores.push({
      name: SCORE_NAMES.TOTAL_TOKENS,
      value: extraMetadata.totalTokens,
      dataType: 'NUMERIC',
      comment: `Total tokens consumed: ${extraMetadata.totalTokens}`,
      metadata
    })
  }

  if (typeof extraMetadata?.durationMs === 'number') {
    scores.push({
      name: SCORE_NAMES.DURATION_MS,
      value: extraMetadata.durationMs,
      dataType: 'NUMERIC',
      comment: `Execution duration: ${extraMetadata.durationMs}ms`,
      metadata
    })
  }

  return scores
}
