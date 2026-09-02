/**
 * evals/runner/TraceEvalRunner.ts
 * Programmatic execution and benchmark runner for evaluating real application traces in Langfuse.
 *
 * Reads real conversation traces, extracts tool calls and AST/DAG payloads,
 * asserts workspace invariants via AssertionEngine, and writes evaluation scores back to Langfuse.
 */

import { Langfuse } from 'langfuse'
import { createLangfuseClient } from '../telemetry/langfuse'
import { DatasetScoreManager } from '../telemetry/DatasetScoreManager'
import { AssertionEngine } from '../assertions/AssertionEngine'
import type {
  ScenarioInvariantSummary,
  ToolCallRecord,
  EvaluateScenarioParams
} from '../assertions/types'
import type {
  TraceEvalResult,
  TraceEvalSuiteResult,
  TraceEvalRunnerOptions,
  TokenMetrics
} from './types'

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function parseJsonIfString(val: unknown): unknown {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return val
      }
    }
  }
  return val
}

function extractDocumentPayload(sources: readonly unknown[]): unknown | undefined {
  for (const source of sources) {
    const parsed = parseJsonIfString(source)
    if (isRecord(parsed)) {
      if (Array.isArray(parsed.blocks)) {
        return parsed
      }
      if (isRecord(parsed.document) && Array.isArray(parsed.document.blocks)) {
        return parsed.document
      }
      if (isRecord(parsed.documentPayload) && Array.isArray(parsed.documentPayload.blocks)) {
        return parsed.documentPayload
      }
      if (isRecord(parsed.payload) && Array.isArray(parsed.payload.blocks)) {
        return parsed.payload
      }
    }
  }
  return undefined
}

function extractGraphCanvasPayload(sources: readonly unknown[]): unknown | undefined {
  for (const source of sources) {
    const parsed = parseJsonIfString(source)
    if (isRecord(parsed)) {
      if (parsed.type === 'graph-canvas' && isRecord(parsed.graph)) {
        return parsed
      }
      if (
        isRecord(parsed.graph) &&
        isRecord(parsed.graph.nodes) &&
        isRecord(parsed.graph.relationships)
      ) {
        return {
          schemaVersion: 1,
          type: 'graph-canvas',
          graph: parsed.graph,
          layout: isRecord(parsed.layout) ? parsed.layout : { layoutByNodeId: {} }
        }
      }
      if (isRecord(parsed.graphCanvas) && isRecord(parsed.graphCanvas.graph)) {
        return parsed.graphCanvas
      }
      if (isRecord(parsed.nodes) && isRecord(parsed.relationships)) {
        return {
          schemaVersion: 1,
          type: 'graph-canvas',
          graph: {
            nodes: parsed.nodes,
            relationships: parsed.relationships
          },
          layout: { layoutByNodeId: {} }
        }
      }
    }
  }
  return undefined
}

/**
 * Headless runner for evaluating real application traces queried directly from Langfuse.
 */
export class TraceEvalRunner {
  private readonly client: Langfuse | undefined
  private readonly scoreManager: DatasetScoreManager
  private readonly options: TraceEvalRunnerOptions

  public constructor(options?: TraceEvalRunnerOptions) {
    this.options = options ?? {}
    this.client = createLangfuseClient()
    this.scoreManager = new DatasetScoreManager({ client: this.client })
  }

  /**
   * Fetches real traces from Langfuse matching the configured filters.
   */
  public async fetchTraces(): Promise<readonly string[]> {
    if (!this.client) {
      throw new Error(
        'Langfuse client is not initialized. Please ensure LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.'
      )
    }

    const limit = this.options.limit ?? 20
    const response = await this.client.api.traceList({
      sessionId: this.options.sessionId,
      tags: this.options.tag ? [this.options.tag] : undefined,
      limit
    })

    return response.data.map((traceSummary) => traceSummary.id)
  }

  /**
   * Evaluates a single trace by ID: extracts observations, verifies invariants, and scores in Langfuse.
   */
  public async evaluateTraceById(traceId: string): Promise<TraceEvalResult> {
    if (!this.client) {
      throw new Error('Langfuse client is not initialized.')
    }

    const fullTrace = await this.client.api.traceGet(traceId)
    return this.evaluateTrace(fullTrace)
  }

  /**
   * Evaluates a complete trace structure and records standardized assertion scores in Langfuse.
   */
  public async evaluateTrace(trace: {
    readonly id: string
    readonly sessionId?: string | null
    readonly name?: string | null
    readonly input?: unknown
    readonly output?: unknown
    readonly latency?: number | null
    readonly tags?: readonly string[] | null
    readonly timestamp?: string | Date
    readonly observations?: readonly {
      readonly id: string
      readonly type: string
      readonly name?: string | null
      readonly input?: unknown
      readonly output?: unknown
      readonly level?: string | null
      readonly statusMessage?: string | null
      readonly usageDetails?: Readonly<Record<string, number>> | null
      readonly usage?: {
        readonly input?: number | null
        readonly output?: number | null
        readonly total?: number | null
        readonly promptTokens?: number | null
        readonly completionTokens?: number | null
        readonly totalTokens?: number | null
      } | null
    }[]
  }): Promise<TraceEvalResult> {
    const observations = trace.observations ?? []
    const spanObservations = observations.filter((o) => o.type === 'SPAN')
    const genObservations = observations.filter((o) => o.type === 'GENERATION')

    // 1. Reconstruct Tool Calls
    const toolCalls: ToolCallRecord[] = []
    const candidateSources: unknown[] = []

    if (trace.input !== undefined && trace.input !== null) {
      candidateSources.push(trace.input)
    }
    if (trace.output !== undefined && trace.output !== null) {
      candidateSources.push(trace.output)
    }

    for (const span of spanObservations) {
      const parsedInput = parseJsonIfString(span.input)
      const parsedOutput = parseJsonIfString(span.output)
      const isErr = span.level === 'ERROR'

      candidateSources.push(parsedInput)
      candidateSources.push(parsedOutput)

      toolCalls.push({
        name: span.name || 'tool',
        args: isRecord(parsedInput) ? parsedInput : {},
        output: parsedOutput,
        status: isErr ? 'error' : 'success',
        error: isErr ? span.statusMessage || 'Tool execution error' : undefined
      })
    }

    // 2. Extract Document & Canvas payloads
    const documentPayload = extractDocumentPayload(candidateSources)
    const graphCanvas = extractGraphCanvasPayload(candidateSources)

    // 3. Evaluate Error Recovery Invariant
    let errorRecoveryAchieved: boolean | undefined
    const hasErrorSpan = spanObservations.some((s) => s.level === 'ERROR')
    if (hasErrorSpan) {
      const lastSpan = spanObservations[spanObservations.length - 1]
      const hasNonNullOutput = trace.output !== null && trace.output !== undefined
      errorRecoveryAchieved = lastSpan?.level !== 'ERROR' && hasNonNullOutput
    }

    // 4. Run Assertions
    const evaluateParams: EvaluateScenarioParams = {
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      documentPayload,
      graphCanvas,
      requireAcyclicGraph: true,
      errorRecoveryAchieved
    }

    const summary: ScenarioInvariantSummary =
      AssertionEngine.evaluateScenarioInvariants(evaluateParams)

    // 5. Compute Token Metrics
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    for (const gen of genObservations) {
      const pTok = gen.usageDetails?.input ?? gen.usage?.input ?? gen.usage?.promptTokens ?? 0
      const cTok = gen.usageDetails?.output ?? gen.usage?.output ?? gen.usage?.completionTokens ?? 0
      const tTok =
        gen.usageDetails?.total ?? gen.usage?.total ?? gen.usage?.totalTokens ?? pTok + cTok

      promptTokens += pTok
      completionTokens += cTok
      totalTokens += tTok
    }

    const tokens: TokenMetrics = {
      promptTokens,
      completionTokens,
      totalTokens
    }

    const durationMs = typeof trace.latency === 'number' ? Math.round(trace.latency * 1000) : 0

    // 6. Ingest Scores to Langfuse
    if (this.scoreManager.isEnabled) {
      try {
        this.scoreManager.recordScenarioSummary({
          traceId: trace.id,
          summary,
          metadata: {
            evaluationType: 'real-trace',
            sessionId: trace.sessionId ?? undefined,
            tags: trace.tags ?? undefined,
            toolCallsCount: toolCalls.length,
            totalTokens,
            durationMs
          }
        })
      } catch (scoreErr) {
        console.warn(`[TraceEvalRunner] Failed to record score for trace ${trace.id}:`, scoreErr)
      }
    }

    const inputPreview =
      typeof trace.input === 'string'
        ? trace.input.slice(0, 100)
        : trace.input
          ? JSON.stringify(trace.input).slice(0, 100)
          : undefined

    const outputPreview =
      typeof trace.output === 'string'
        ? trace.output.slice(0, 100)
        : trace.output
          ? JSON.stringify(trace.output).slice(0, 100)
          : undefined

    return {
      traceId: trace.id,
      sessionId: trace.sessionId ?? undefined,
      name: trace.name ?? undefined,
      passed: summary.passed,
      durationMs,
      tokens,
      toolCallsCount: toolCalls.length,
      summary,
      errors: summary.errors,
      tags: trace.tags ?? undefined,
      inputPreview,
      outputPreview
    }
  }

  /**
   * Executes evaluation across all matched real traces.
   */
  public async runSuite(): Promise<TraceEvalSuiteResult> {
    const traceIds = await this.fetchTraces()
    const results: TraceEvalResult[] = []
    let totalDurationMs = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalTokens = 0

    for (let i = 0; i < traceIds.length; i++) {
      const traceId = traceIds[i]
      this.options.onTraceStart?.(traceId, i, traceIds.length)

      const result = await this.evaluateTraceById(traceId)
      results.push(result)

      totalDurationMs += result.durationMs
      totalPromptTokens += result.tokens.promptTokens
      totalCompletionTokens += result.tokens.completionTokens
      totalTokens += result.tokens.totalTokens

      this.options.onTraceComplete?.(result, i, traceIds.length)
    }

    // Flush all queued score ingestions
    await this.scoreManager.flush()

    const passedTraces = results.filter((r) => r.passed).length
    const failedTraces = results.length - passedTraces
    const passRate = results.length > 0 ? passedTraces / results.length : 0

    return {
      totalTraces: results.length,
      passedTraces,
      failedTraces,
      passRate,
      totalDurationMs,
      totalTokens: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens
      },
      results
    }
  }
}
