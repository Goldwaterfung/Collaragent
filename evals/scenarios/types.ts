/**
 * evals/scenarios/types.ts
 * Strongly-typed scenario schemas, invariant rules, and fixtures for deterministic evaluation harness.
 */

import type { SyncDatasetItemParams } from '../telemetry/DatasetScoreManager'

/**
 * 5-tier scenario taxonomy for CollarAgent evaluations.
 */
export type ScenarioTier =
  'tier1_doc' | 'tier2_graph' | 'tier3_errors' | 'tier4_rollback' | 'tier5_subagents'

/**
 * Invariant verification requirements for a specific scenario.
 */
export interface ScenarioInvariantRules {
  /** Whether the visual canvas graph must be strictly acyclic (DAG) */
  readonly requireAcyclicGraph?: boolean
  /** Whether Lexical AST integrity (unique blocks, table rectangularity, heading flow) is verified */
  readonly validateLexicalAST?: boolean
  /** Whether mathematical rollback parity (100% byte match via InverseCommandEngine) is verified */
  readonly validateRollbackParity?: boolean
  /** Maximum allowable turns for completing the scenario before failing */
  readonly maxAllowedTurns?: number
  /** Expected initial tool name that must be invoked first */
  readonly expectedInitialTool?: string
  /** Whether autonomous error recovery is expected to succeed */
  readonly expectErrorRecovery?: boolean
}

/**
 * Standardized scenario definition for programmatic evaluation and Langfuse dataset items.
 */
export interface EvaluationScenario<TFixture = unknown, TExpected = unknown> {
  /** Unique scenario identifier (e.g. "SCN-DOC-01") */
  readonly id: string
  /** Evaluation tier */
  readonly tier: ScenarioTier
  /** Human-readable scenario name */
  readonly name: string
  /** Detailed objective description */
  readonly description: string
  /** Prompt delivered to DeepAgent */
  readonly prompt: string
  /** Expected sequence of tool calls */
  readonly expectedTools: readonly string[]
  /** Optional initial workspace fixture or document/canvas snapshot */
  readonly initialFixture?: TFixture
  /** Optional expected output state specification */
  readonly expectedOutput?: TExpected
  /** Invariant verification rules */
  readonly invariantRules: ScenarioInvariantRules
  /** Additional metadata tags attached to evaluation traces */
  readonly tags?: readonly string[]
}

/**
 * Helper to convert an EvaluationScenario into Langfuse SyncDatasetItemParams.
 *
 * @param scenario Scenario definition
 * @param datasetName Target dataset name
 * @returns SyncDatasetItemParams object ready for DatasetScoreManager
 */
export function scenarioToDatasetItem(
  scenario: EvaluationScenario,
  datasetName: string
): SyncDatasetItemParams {
  return {
    datasetName,
    itemId: scenario.id,
    input: {
      prompt: scenario.prompt,
      tier: scenario.tier,
      name: scenario.name,
      initialFixture: scenario.initialFixture
    },
    expectedOutput: {
      expectedTools: [...scenario.expectedTools],
      expectedOutput: scenario.expectedOutput
    },
    metadata: {
      id: scenario.id,
      tier: scenario.tier,
      description: scenario.description,
      invariantRules: { ...scenario.invariantRules },
      tags: scenario.tags ? [...scenario.tags] : undefined
    },
    status: 'ACTIVE'
  }
}
