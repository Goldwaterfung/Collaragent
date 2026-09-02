import { Langfuse } from 'langfuse'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import type { LLMResult } from '@langchain/core/outputs'
import type { BaseMessage } from '@langchain/core/messages'
import type { CreateLangfuseHandlerOptions, LangfuseHealthCheckResult } from './types'

type ChainValues = Record<string, unknown>
type LangfuseTraceClient = ReturnType<Langfuse['trace']>
type LangfuseSpanClient = ReturnType<LangfuseTraceClient['span']>
type LangfuseGenerationClient = ReturnType<LangfuseTraceClient['generation']>

/**
 * Direct Langfuse CallbackHandler for LangChain / LangGraph.
 * Transmits real HTTP trace data to Langfuse's Ingestion API (/api/public/ingestion).
 */
export class LangfuseCallbackHandler extends BaseCallbackHandler {
  name = 'langfuse'
  private langfuse: Langfuse
  private options: CreateLangfuseHandlerOptions
  private rootTrace: LangfuseTraceClient | undefined
  private rootRunId: string | undefined
  private updateRoot: boolean
  private traces = new Map<string, LangfuseTraceClient>()
  private spans = new Map<string, LangfuseSpanClient>()
  private generations = new Map<string, LangfuseGenerationClient>()

  constructor(options: CreateLangfuseHandlerOptions) {
    super()
    this.options = options
    this.updateRoot = options.updateRoot !== false
    this.langfuse = new Langfuse({
      publicKey: options.publicKey,
      secretKey: options.secretKey,
      baseUrl: options.baseUrl || 'http://localhost:3000'
    })

    const rootId = options.sessionId || options.threadId
    if (rootId) {
      this.rootTrace = this.langfuse.trace({
        id: rootId,
        sessionId: rootId,
        userId: options.userId,
        name: options.scenarioId
          ? `eval-${options.scenarioId}`
          : options.runName || 'agent-conversation',
        tags: options.tags ? [...options.tags] : undefined,
        metadata: options.metadata ? { ...options.metadata } : undefined
      })
      this.traces.set(rootId, this.rootTrace)
    }
  }

  /**
   * Returns the underlying Langfuse root trace client if active.
   */
  public getRootTrace(): LangfuseTraceClient | undefined {
    return this.rootTrace
  }

  private getParentClient(parentRunId?: string): LangfuseTraceClient | LangfuseSpanClient {
    if (parentRunId && this.spans.has(parentRunId)) {
      return this.spans.get(parentRunId)!
    }
    if (parentRunId && this.traces.has(parentRunId)) {
      return this.traces.get(parentRunId)!
    }
    if (this.rootTrace) {
      return this.rootTrace
    }
    const defaultTrace = this.langfuse.trace({
      name: this.options.runName || 'agent-run',
      sessionId: this.options.sessionId || this.options.threadId,
      userId: this.options.userId,
      tags: this.options.tags ? [...this.options.tags] : undefined,
      metadata: this.options.metadata ? { ...this.options.metadata } : undefined
    })
    return defaultTrace
  }

  handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    _runType?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
    parentRunId?: string
  ): void {
    try {
      const name =
        runName ||
        (chain.id && chain.id.length > 0 ? String(chain.id[chain.id.length - 1]) : 'chain')
      if (!parentRunId) {
        // Top-level chain execution: wire to root trace
        if (this.rootTrace) {
          if (this.updateRoot) {
            this.rootTrace.update({
              input: inputs,
              metadata: metadata ? { ...this.options.metadata, ...metadata } : undefined,
              tags: tags || (this.options.tags ? [...this.options.tags] : undefined)
            })
          }
          this.rootRunId = runId
          this.traces.set(runId, this.rootTrace)
        } else {
          const trace = this.langfuse.trace({
            id: runId,
            name,
            sessionId: this.options.sessionId || this.options.threadId,
            userId: this.options.userId,
            tags: tags || (this.options.tags ? [...this.options.tags] : undefined),
            metadata: { ...this.options.metadata, ...metadata },
            input: inputs
          })
          this.traces.set(runId, trace)
          this.rootTrace = trace
          this.rootRunId = runId
        }
      } else {
        const parent = this.getParentClient(parentRunId)
        const span = parent.span({
          id: runId,
          name,
          input: inputs,
          startTime: new Date(),
          metadata
        })
        this.spans.set(runId, span)
      }
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleChainStart:', err)
    }
  }

  handleChainEnd(outputs: ChainValues, runId: string): void {
    try {
      if (runId === this.rootRunId) {
        if (this.updateRoot && this.rootTrace) {
          this.rootTrace.update({ output: outputs })
        }
      } else if (this.spans.has(runId)) {
        this.spans.get(runId)?.end({ output: outputs })
        this.spans.delete(runId)
      } else if (this.traces.has(runId)) {
        const trace = this.traces.get(runId)
        if (this.updateRoot || trace !== this.rootTrace) {
          trace?.update({ output: outputs })
        }
      } else if (this.rootTrace && this.updateRoot) {
        this.rootTrace.update({ output: outputs })
      }
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleChainEnd:', err)
    }
  }

  handleChainError(err: unknown, runId: string): void {
    try {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (runId === this.rootRunId || (!this.spans.has(runId) && this.traces.has(runId))) {
        if (this.rootTrace) {
          this.rootTrace.update({
            metadata: { error: errMsg }
          })
        }
      } else if (this.spans.has(runId)) {
        this.spans.get(runId)?.end({
          level: 'ERROR',
          statusMessage: errMsg
        })
        this.spans.delete(runId)
      } else if (this.rootTrace) {
        this.rootTrace.update({
          metadata: { error: errMsg }
        })
      }
    } catch (e) {
      console.warn('[LangfuseCallbackHandler] Error in handleChainError:', e)
    }
  }

  handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    try {
      const modelName =
        (extraParams?.model_name as string) ||
        (extraParams?.model as string) ||
        runName ||
        (llm.id && llm.id.length > 0 ? String(llm.id[llm.id.length - 1]) : 'chat-model')

      const parent = this.getParentClient(parentRunId)
      const formattedInput = messages.map((group) =>
        group.map((msg) => ({
          role: typeof msg._getType === 'function' ? msg._getType() : 'user',
          content: msg.content
        }))
      )

      const gen = parent.generation({
        id: runId,
        name: runName || modelName,
        model: modelName,
        input: formattedInput.length === 1 ? formattedInput[0] : formattedInput,
        startTime: new Date(),
        metadata: { ...this.options.metadata, ...metadata, ...extraParams }
      })
      this.generations.set(runId, gen)
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleChatModelStart:', err)
    }
  }

  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    try {
      const modelName =
        (extraParams?.model_name as string) ||
        (extraParams?.model as string) ||
        runName ||
        (llm.id && llm.id.length > 0 ? String(llm.id[llm.id.length - 1]) : 'llm')

      const parent = this.getParentClient(parentRunId)
      const gen = parent.generation({
        id: runId,
        name: runName || modelName,
        model: modelName,
        input: prompts.length === 1 ? prompts[0] : prompts,
        startTime: new Date(),
        metadata: { ...this.options.metadata, ...metadata, ...extraParams }
      })
      this.generations.set(runId, gen)
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleLLMStart:', err)
    }
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    try {
      const gen = this.generations.get(runId)
      if (!gen) return

      const firstGen = output.generations?.[0]?.[0]
      const textOutput =
        firstGen?.text || (firstGen as { message?: { content?: unknown } })?.message?.content || ''

      const tokenUsage = output.llmOutput?.tokenUsage as
        | {
            promptTokens?: number
            completionTokens?: number
            totalTokens?: number
            input_tokens?: number
            output_tokens?: number
            total_tokens?: number
          }
        | undefined

      const usageMeta = (
        firstGen as {
          message?: {
            usage_metadata?: {
              input_tokens?: number
              output_tokens?: number
              total_tokens?: number
            }
          }
        }
      )?.message?.usage_metadata

      const promptTokens =
        usageMeta?.input_tokens ?? tokenUsage?.promptTokens ?? tokenUsage?.input_tokens
      const completionTokens =
        usageMeta?.output_tokens ?? tokenUsage?.completionTokens ?? tokenUsage?.output_tokens
      const totalTokens =
        usageMeta?.total_tokens ?? tokenUsage?.totalTokens ?? tokenUsage?.total_tokens

      gen.end({
        output: textOutput,
        usage:
          promptTokens !== undefined || completionTokens !== undefined
            ? {
                promptTokens,
                completionTokens,
                totalTokens: totalTokens ?? (promptTokens || 0) + (completionTokens || 0)
              }
            : undefined
      })
      this.generations.delete(runId)
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleLLMEnd:', err)
    }
  }

  handleLLMError(err: unknown, runId: string): void {
    try {
      const gen = this.generations.get(runId)
      if (gen) {
        gen.end({
          level: 'ERROR',
          statusMessage: err instanceof Error ? err.message : String(err)
        })
        this.generations.delete(runId)
      }
    } catch (e) {
      console.warn('[LangfuseCallbackHandler] Error in handleLLMError:', e)
    }
  }

  handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string
  ): void {
    try {
      const name =
        runName || (tool.id && tool.id.length > 0 ? String(tool.id[tool.id.length - 1]) : 'tool')
      const parent = this.getParentClient(parentRunId)
      const span = parent.span({
        id: runId,
        name,
        input,
        startTime: new Date(),
        metadata
      })
      this.spans.set(runId, span)
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleToolStart:', err)
    }
  }

  handleToolEnd(output: string, runId: string): void {
    try {
      const span = this.spans.get(runId)
      if (span) {
        span.end({
          output
        })
        this.spans.delete(runId)
      }
    } catch (err) {
      console.warn('[LangfuseCallbackHandler] Error in handleToolEnd:', err)
    }
  }

  handleToolError(err: unknown, runId: string): void {
    try {
      const span = this.spans.get(runId)
      if (span) {
        span.end({
          level: 'ERROR',
          statusMessage: err instanceof Error ? err.message : String(err)
        })
        this.spans.delete(runId)
      }
    } catch (e) {
      console.warn('[LangfuseCallbackHandler] Error in handleToolError:', e)
    }
  }

  async flushAsync(): Promise<void> {
    await this.langfuse.flushAsync().catch((err) => {
      console.warn('[LangfuseCallbackHandler] Failed to flush traces to Langfuse:', err)
    })
  }

  async shutdownAsync(): Promise<void> {
    await this.langfuse.shutdownAsync().catch((err) => {
      console.warn('[LangfuseCallbackHandler] Failed to shutdown Langfuse:', err)
    })
  }
}

/**
 * Creates a Langfuse CallbackHandler for direct REST-based LangChain/LangGraph execution tracing.
 * Returns undefined if credentials are not configured (Fail-Safe / Zero-Delay Mode).
 */
export function createLangfuseHandler(
  options?: CreateLangfuseHandlerOptions
): LangfuseCallbackHandler | undefined {
  const publicKey = options?.publicKey || process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = options?.secretKey || process.env.LANGFUSE_SECRET_KEY
  const baseUrl =
    options?.baseUrl ||
    process.env.LANGFUSE_BASE_URL ||
    process.env.LANGFUSE_HOST ||
    'http://localhost:3000'

  if (!publicKey || !secretKey) {
    return undefined
  }

  // Ensure environment variables are synchronized for underlying OpenTelemetry / Langfuse clients
  process.env.LANGFUSE_PUBLIC_KEY = publicKey
  process.env.LANGFUSE_SECRET_KEY = secretKey
  process.env.LANGFUSE_BASE_URL = baseUrl

  return new LangfuseCallbackHandler({
    ...options,
    publicKey,
    secretKey,
    baseUrl
  })
}

/**
 * Flushes pending telemetry events to guarantee zero dropped traces.
 * Safe to call with undefined or any object.
 */
export async function flushTelemetry(client?: unknown): Promise<void> {
  if (!client || typeof client !== 'object') {
    return
  }

  const flushable = client as { flushAsync?: () => Promise<void>; flush?: () => Promise<void> }
  if (typeof flushable.flushAsync === 'function') {
    await flushable.flushAsync().catch(() => {})
  } else if (typeof flushable.flush === 'function') {
    await flushable.flush().catch(() => {})
  }
}

/**
 * Performs a lightweight, timeout-guarded reachability and authentication health check against a Langfuse instance.
 */
export async function checkLangfuseHealth(
  baseUrl: string,
  credentials?: { publicKey?: string; secretKey?: string },
  timeoutMs: number = 3000
): Promise<LangfuseHealthCheckResult> {
  const cleanUrl = (baseUrl || 'http://localhost:3000').trim().replace(/\/+$/, '')

  // 1. If credentials are provided, verify authentication against /api/public/projects
  if (credentials?.publicKey && credentials?.secretKey) {
    const authEndpoint = `${cleanUrl}/api/public/projects`
    const authHeader =
      'Basic ' + Buffer.from(`${credentials.publicKey}:${credentials.secretKey}`).toString('base64')
    try {
      const response = await fetch(authEndpoint, {
        method: 'GET',
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(timeoutMs)
      })

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          message: 'Langfuse server is healthy and credentials are valid'
        }
      }

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: response.status,
          error: 'Authentication failed: Invalid Langfuse Public Key or Secret Key.'
        }
      }

      return {
        ok: false,
        status: response.status,
        error: `Server responded with HTTP ${response.status} (${response.statusText})`
      }
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: `Connection failed: ${errMessage}`
      }
    }
  }

  // 2. Fallback to unauthenticated server reachability ping on /api/public/health
  const healthEndpoint = `${cleanUrl}/api/public/health`

  try {
    const response = await fetch(healthEndpoint, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        message: 'Langfuse server is healthy and reachable'
      }
    }

    return {
      ok: false,
      status: response.status,
      error: `Server responded with HTTP ${response.status} (${response.statusText})`
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: `Connection failed: ${errMessage}`
    }
  }
}
