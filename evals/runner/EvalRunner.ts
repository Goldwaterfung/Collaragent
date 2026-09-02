/**
 * evals/runner/EvalRunner.ts
 * Headless CLI and programmatic execution engine for CollarAgent evaluation scenarios.
 *
 * Enforces:
 * 1. Build Boundary Invariant (Headless execution isolated from Electron renderer)
 * 2. Fail-Safe Telemetry Lifecycle (Graceful no-op when credentials unset)
 * 3. Mandatory Async Queue Flush in finally blocks (flushTelemetry & scoreManager.flush)
 * 4. Live Agent Invariant Scoring & Langfuse Ingestion
 */

import { ALL_SCENARIOS, getScenarioById, getScenariosByTier } from '../scenarios'
import type { EvaluationScenario, ScenarioTier } from '../scenarios/types'
import { scenarioToDatasetItem } from '../scenarios/types'
import { AssertionEngine } from '../assertions/AssertionEngine'
import type { EvaluateScenarioParams, ScenarioInvariantSummary } from '../assertions/types'
import { DatasetScoreManager } from '../telemetry/DatasetScoreManager'
import { createLangfuseHandler, flushTelemetry } from '../telemetry/langfuse'
import type {
  EvalRunnerOptions,
  EvalSuiteResult,
  ScenarioResult,
  TierSummary,
  TokenMetrics,
  AgentExecutionOutput,
  AgentInvokerFn,
  ScenarioStartCallback,
  ScenarioCompleteCallback
} from './types'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_DATASET_NAME = 'collaragent-evaluation-scenarios'

const ALL_TIERS: readonly ScenarioTier[] = [
  'tier1_doc',
  'tier2_graph',
  'tier3_errors',
  'tier4_rollback',
  'tier5_subagents'
] as const

/**
 * Headless scenario evaluation and benchmark runner.
 */
export class EvalRunner {
  private readonly tier?: ScenarioTier
  private readonly scenarioId?: string
  private readonly timeoutMs: number
  private readonly datasetName: string
  private readonly runName: string
  private readonly scoreManager: DatasetScoreManager
  private readonly agentInvoker?: AgentInvokerFn
  private readonly onScenarioStart?: ScenarioStartCallback
  private readonly onScenarioComplete?: ScenarioCompleteCallback

  public constructor(options?: EvalRunnerOptions) {
    this.tier = options?.tier
    this.scenarioId = options?.scenarioId
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.datasetName = options?.datasetName ?? DEFAULT_DATASET_NAME
    this.runName = options?.runName ?? `eval-run-${new Date().toISOString().replace(/[:.]/g, '-')}`

    this.scoreManager = options?.scoreManager ?? new DatasetScoreManager()

    this.agentInvoker = options?.agentInvoker
    this.onScenarioStart = options?.onScenarioStart
    this.onScenarioComplete = options?.onScenarioComplete
  }

  /**
   * Executes a single scenario under the active mode and evaluates invariant rules.
   *
   * @param scenario EvaluationScenario specification
   * @returns Comprehensive ScenarioResult with invariant summary and token usage
   */
  public async runScenario(scenario: EvaluationScenario): Promise<ScenarioResult> {
    const startTime = Date.now()
    const sessionId = `eval-${scenario.id.toLowerCase()}-${Date.now()}`

    // 1. Initialize Langfuse CallbackHandler (Fail-Safe: returns undefined if keys are unset)
    const handler = createLangfuseHandler({
      sessionId,
      scenarioId: scenario.id,
      tier: scenario.tier,
      executionMode: 'live',
      tags: ['evals', scenario.tier, ...(scenario.tags ?? [])],
      runName: this.runName
    })

    let executionOutput: AgentExecutionOutput = {}
    let caughtError: string | undefined

    try {
      if (this.agentInvoker) {
        // Live execution via real agent invoker
        executionOutput = await this.agentInvoker(scenario, {
          handler,
          timeoutMs: this.timeoutMs,
          sessionId
        })
      } else {
        throw new Error(
          `Cannot execute scenario "${scenario.id}" without an active agentInvoker. ` +
            `Live evaluation requires an active agent invocation function.`
        )
      }
    } catch (error: unknown) {
      caughtError = error instanceof Error ? error.message : String(error)
    }

    try {
      const durationMs = Date.now() - startTime
      const tokens: TokenMetrics = {
        promptTokens: executionOutput.tokens?.promptTokens ?? 0,
        completionTokens: executionOutput.tokens?.completionTokens ?? 0,
        totalTokens:
          executionOutput.tokens?.totalTokens ??
          (executionOutput.tokens?.promptTokens ?? 0) +
            (executionOutput.tokens?.completionTokens ?? 0)
      }

      // 2. Evaluate Invariants via AssertionEngine
      const evaluateParams: EvaluateScenarioParams = {
        expectedTools: scenario.expectedTools,
        toolCalls: executionOutput.toolCalls,
        documentPayload: executionOutput.documentPayload,
        graphCanvas: executionOutput.graphCanvas,
        initialSnapshot: executionOutput.initialSnapshot ?? scenario.initialFixture,
        restoredSnapshot: executionOutput.restoredSnapshot,
        requireAcyclicGraph: scenario.invariantRules.requireAcyclicGraph ?? true,
        errorRecoveryAchieved:
          executionOutput.errorRecoveryAchieved ??
          (scenario.invariantRules.expectErrorRecovery ? true : undefined)
      }

      let summary: ScenarioInvariantSummary
      if (caughtError) {
        summary = {
          passed: false,
          toolSelectionAccuracy: 0,
          schemaAdherence: 0,
          invariantIntegrity: 0,
          rollbackInvariantPassed: false,
          errorRecoverySuccess: false,
          errors: [caughtError],
          details: { executionError: caughtError }
        }
      } else {
        summary = AssertionEngine.evaluateScenarioInvariants(evaluateParams)
      }

      // 3. Record Scores & Sync Dataset with Langfuse (Fail-Safe no-op if disabled)
      if (this.scoreManager.isEnabled) {
        try {
          await this.scoreManager.syncDataset(
            this.datasetName,
            'CollarAgent Deterministic Evaluation Benchmark Suite'
          )

          await this.scoreManager.syncDatasetItem(scenarioToDatasetItem(scenario, this.datasetName))

          const traceId = executionOutput.traceId ?? sessionId
          await this.scoreManager.createDatasetRunItem({
            runName: this.runName,
            datasetItemId: scenario.id,
            traceId
          })

          this.scoreManager.recordScenarioSummary({
            traceId,
            summary,
            metadata: {
              scenarioId: scenario.id,
              tier: scenario.tier,
              mode: 'live',
              totalTokens: tokens.totalTokens,
              durationMs
            }
          })
        } catch (telemetryErr) {
          console.warn(
            `[EvalRunner] Failed to sync telemetry for scenario ${scenario.id}:`,
            telemetryErr
          )
        }
      }

      const result: ScenarioResult = {
        scenarioId: scenario.id,
        tier: scenario.tier,
        name: scenario.name,
        passed: summary.passed,
        durationMs,
        tokens,
        summary,
        errors: summary.errors,
        traceId: executionOutput.traceId ?? sessionId
      }

      return result
    } finally {
      // 4. Mandatory Async Queue Drain Invariant
      await flushTelemetry(handler)
      await this.scoreManager.flush()
    }
  }

  /**
   * Executes the full evaluation suite according to configured filters (tier, scenarioId).
   *
   * @returns Aggregated EvalSuiteResult with per-scenario and per-tier breakdowns
   */
  public async runSuite(): Promise<EvalSuiteResult> {
    const scenariosToRun = this.resolveScenarios()
    const scenarioResults: ScenarioResult[] = []
    const startTime = Date.now()

    // 1. Initialize Dataset in Langfuse if telemetry is enabled
    if (this.scoreManager.isEnabled) {
      try {
        await this.scoreManager.syncDataset(
          this.datasetName,
          'CollarAgent Deterministic Evaluation Benchmark Suite'
        )
      } catch (err) {
        console.warn(`[EvalRunner] Failed to initialize dataset "${this.datasetName}":`, err)
      }
    }

    for (let i = 0; i < scenariosToRun.length; i++) {
      const scenario = scenariosToRun[i]
      this.onScenarioStart?.(scenario, i, scenariosToRun.length)

      const result = await this.runScenario(scenario)
      scenarioResults.push(result)

      this.onScenarioComplete?.(scenario, result, i, scenariosToRun.length)
    }

    const totalDurationMs = Date.now() - startTime
    const passedScenarios = scenarioResults.filter((r) => r.passed).length
    const failedScenarios = scenarioResults.length - passedScenarios
    const passRate = scenariosToRun.length > 0 ? passedScenarios / scenariosToRun.length : 0

    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalTokens = 0

    for (const r of scenarioResults) {
      totalPromptTokens += r.tokens.promptTokens
      totalCompletionTokens += r.tokens.completionTokens
      totalTokens += r.tokens.totalTokens
    }

    const tierSummaries = this.computeTierSummaries(scenarioResults)

    return {
      runName: this.runName,
      mode: 'live',
      totalScenarios: scenarioResults.length,
      passedScenarios,
      failedScenarios,
      passRate,
      totalDurationMs,
      totalTokens: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens
      },
      scenarioResults,
      tierSummaries
    }
  }

  /**
   * Resolves the list of scenarios to run based on configured tier and scenarioId filters.
   */
  private resolveScenarios(): readonly EvaluationScenario[] {
    if (this.scenarioId) {
      const singleScenario = getScenarioById(this.scenarioId)
      if (!singleScenario) {
        throw new Error(
          `Evaluation scenario with ID "${this.scenarioId}" not found in scenario registry`
        )
      }
      return [singleScenario]
    }

    if (this.tier) {
      const tierScenarios = getScenariosByTier(this.tier)
      if (tierScenarios.length === 0) {
        throw new Error(`No evaluation scenarios found for tier "${this.tier}"`)
      }
      return tierScenarios
    }

    return ALL_SCENARIOS
  }

  /**
   * Computes per-tier aggregated summary statistics from individual scenario results.
   */
  private computeTierSummaries(
    results: readonly ScenarioResult[]
  ): Readonly<Record<ScenarioTier, TierSummary>> {
    const summaries: Record<ScenarioTier, TierSummary> = {
      tier1_doc: { tier: 'tier1_doc', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier2_graph: { tier: 'tier2_graph', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier3_errors: { tier: 'tier3_errors', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier4_rollback: { tier: 'tier4_rollback', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier5_subagents: { tier: 'tier5_subagents', total: 0, passed: 0, failed: 0, passRate: 0 }
    }

    for (const tier of ALL_TIERS) {
      const tierResults = results.filter((r) => r.tier === tier)
      const total = tierResults.length
      const passed = tierResults.filter((r) => r.passed).length
      const failed = total - passed
      const passRate = total > 0 ? passed / total : 0

      summaries[tier] = {
        tier,
        total,
        passed,
        failed,
        passRate
      }
    }

    return summaries
  }
}
