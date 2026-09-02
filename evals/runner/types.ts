/**
 * evals/runner/types.ts
 * Strongly-typed contracts for headless evaluation runner, scenario lifecycles, and suite aggregation.
 */

import type { LangfuseCallbackHandler } from '../../src/collaragent/telemetry/langfuse'
import type { EvaluationScenario, ScenarioTier } from '../scenarios/types'
import type { ScenarioInvariantSummary, ToolCallRecord } from '../assertions/types'
import type { DatasetScoreManager } from '../telemetry/DatasetScoreManager'

/**
 * Token consumption metrics for an evaluation execution.
 */
export interface TokenMetrics {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

/**
 * Execution output returned by an agent invocation.
 */
export interface AgentExecutionOutput {
  readonly output?: string
  readonly toolCalls?: readonly ToolCallRecord[]
  readonly documentPayload?: unknown
  readonly graphCanvas?: unknown
  readonly initialSnapshot?: unknown
  readonly restoredSnapshot?: unknown
  readonly errorRecoveryAchieved?: boolean
  readonly tokens?: Partial<TokenMetrics>
  readonly traceId?: string
}

/**
 * Custom invoker function signature for driving agent execution during evaluations.
 */
export type AgentInvokerFn = (
  scenario: EvaluationScenario,
  options: {
    readonly handler?: LangfuseCallbackHandler
    readonly timeoutMs?: number
    readonly sessionId: string
  }
) => Promise<AgentExecutionOutput>

/**
 * Result of evaluating a single scenario.
 */
export interface ScenarioResult {
  readonly scenarioId: string
  readonly tier: ScenarioTier
  readonly name: string
  readonly passed: boolean
  readonly durationMs: number
  readonly tokens: TokenMetrics
  readonly summary: ScenarioInvariantSummary
  readonly errors: readonly string[]
  readonly traceId?: string
  readonly traceUrl?: string
}

/**
 * Aggregated summary statistics for a specific evaluation tier.
 */
export interface TierSummary {
  readonly tier: ScenarioTier
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly passRate: number
}

/**
 * Aggregated execution result for a complete evaluation suite run.
 */
export interface EvalSuiteResult {
  readonly runName: string
  readonly mode: 'live'
  readonly totalScenarios: number
  readonly passedScenarios: number
  readonly failedScenarios: number
  readonly passRate: number
  readonly totalDurationMs: number
  readonly totalTokens: TokenMetrics
  readonly scenarioResults: readonly ScenarioResult[]
  readonly tierSummaries: Readonly<Record<ScenarioTier, TierSummary>>
}

/**
 * Callback hook invoked when a scenario starts executing.
 */
export type ScenarioStartCallback = (
  scenario: EvaluationScenario,
  index: number,
  total: number
) => void

/**
 * Callback hook invoked when a scenario completes execution.
 */
export type ScenarioCompleteCallback = (
  scenario: EvaluationScenario,
  result: ScenarioResult,
  index: number,
  total: number
) => void

/**
 * Configuration options for initializing EvalRunner.
 */
export interface EvalRunnerOptions {
  /** Filter execution to a specific scenario tier */
  readonly tier?: ScenarioTier
  /** Filter execution to a single specific scenario ID */
  readonly scenarioId?: string
  /** Maximum allowable execution time per scenario in milliseconds (default: 30000ms) */
  readonly timeoutMs?: number
  /** Name of the Langfuse dataset to sync against */
  readonly datasetName?: string
  /** Identifier or name for the active evaluation run */
  readonly runName?: string
  /** Model name attached to trace metadata */
  readonly modelName?: string
  /** Pre-instantiated DatasetScoreManager instance */
  readonly scoreManager?: DatasetScoreManager
  /** Custom agent invocation engine driving real agent/model execution */
  readonly agentInvoker?: AgentInvokerFn
  /** Callback fired when a scenario starts */
  readonly onScenarioStart?: ScenarioStartCallback
  /** Callback fired when a scenario completes */
  readonly onScenarioComplete?: ScenarioCompleteCallback
}

/**
 * Result of evaluating a single real Langfuse trace.
 */
export interface TraceEvalResult {
  readonly traceId: string
  readonly sessionId?: string
  readonly name?: string
  readonly passed: boolean
  readonly durationMs: number
  readonly tokens: TokenMetrics
  readonly toolCallsCount: number
  readonly summary: ScenarioInvariantSummary
  readonly errors: readonly string[]
  readonly tags?: readonly string[]
  readonly inputPreview?: string
  readonly outputPreview?: string
}

/**
 * Aggregated result of evaluating a collection of real Langfuse traces.
 */
export interface TraceEvalSuiteResult {
  readonly totalTraces: number
  readonly passedTraces: number
  readonly failedTraces: number
  readonly passRate: number
  readonly totalDurationMs: number
  readonly totalTokens: TokenMetrics
  readonly results: readonly TraceEvalResult[]
}

/**
 * Options for initializing TraceEvalRunner.
 */
export interface TraceEvalRunnerOptions {
  /** Filter traces by session ID */
  readonly sessionId?: string
  /** Filter traces by tag */
  readonly tag?: string
  /** Maximum number of traces to fetch and evaluate (default: 20) */
  readonly limit?: number
  /** Callback hook on trace start */
  readonly onTraceStart?: (traceId: string, index: number, total: number) => void
  /** Callback hook on trace complete */
  readonly onTraceComplete?: (result: TraceEvalResult, index: number, total: number) => void
}
