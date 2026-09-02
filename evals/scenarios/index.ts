/**
 * evals/scenarios/index.ts
 * Query registry and types for evaluation scenarios.
 */

import type { EvaluationScenario, ScenarioTier } from './types'

export * from './types'

/**
 * Registry list of evaluation scenarios.
 */
export const ALL_SCENARIOS: readonly EvaluationScenario[] = []

/**
 * Map of scenarios keyed by their unique scenario ID.
 */
const SCENARIOS_BY_ID = new Map<string, EvaluationScenario>()

/**
 * Map of scenarios grouped by evaluation tier.
 */
const SCENARIOS_BY_TIER = new Map<ScenarioTier, EvaluationScenario[]>([
  ['tier1_doc', []],
  ['tier2_graph', []],
  ['tier3_errors', []],
  ['tier4_rollback', []],
  ['tier5_subagents', []]
])

/**
 * Retrieves a scenario definition by its unique identifier.
 */
export function getScenarioById(id: string): EvaluationScenario | undefined {
  return SCENARIOS_BY_ID.get(id)
}

/**
 * Retrieves all scenario definitions for a given evaluation tier.
 */
export function getScenariosByTier(tier: ScenarioTier): readonly EvaluationScenario[] {
  return SCENARIOS_BY_TIER.get(tier) ?? []
}
