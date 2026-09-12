import { ModelInfo, ModelProvider } from '../../shared/config/types'
import { REASONING_EFFORT_LEVELS, ReasoningEffort } from '../../shared/config/constants'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'

interface CatalogModelLike {
  id: string
  name: string
  provider: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<ReasoningEffort, string | null>>
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number }
}

export interface ResolvedModel {
  /** Model id to send to the provider API */
  apiModelId: string
  /** Matching catalog entry, if the id is known */
  modelInfo?: ModelInfo
  /** Level recovered from a legacy `<id>-<level>` composite id */
  legacyReasoningEffort?: ReasoningEffort
}

export class ModelManager {
  private providers = [
    openaiProvider(),
    anthropicProvider(),
    googleProvider(),
    opencodeGoProvider()
  ]

  getAvailableModels(): ModelInfo[] {
    return this.collectCatalogModels().map((m) => this.toModelInfo(m))
  }

  /**
   * Resolve a configured model id to its API id and catalog metadata.
   *
   * Supports legacy composite ids (`<baseId>-<level>`) produced by the old
   * synthetic thinking-variant catalog so previously saved configs keep working.
   */
  resolveModel(provider: ModelProvider, modelId: string): ResolvedModel {
    const models = this.getAvailableModels()
    const direct = models.find((m) => m.provider === provider && m.id === modelId)
    if (direct) {
      return { apiModelId: direct.apiModelId || direct.id, modelInfo: direct }
    }

    for (const level of REASONING_EFFORT_LEVELS) {
      if (level === 'off') continue
      const suffix = `-${level}`
      if (!modelId.endsWith(suffix)) continue
      const baseId = modelId.slice(0, -suffix.length)
      const base = models.find((m) => m.provider === provider && m.id === baseId)
      if (base) {
        return {
          apiModelId: base.apiModelId || base.id,
          modelInfo: base,
          legacyReasoningEffort: level
        }
      }
    }

    return { apiModelId: modelId }
  }

  /**
   * Translate a canonical reasoning level into the wire-specific constructor
   * options understood by LangChain (OpenAI `reasoning.effort`, Anthropic
   * `thinking.budget_tokens`, Google `thinkingConfig`).
   */
  buildReasoningParameters(
    provider: ModelProvider,
    modelId: string,
    level?: ReasoningEffort
  ): Record<string, unknown> {
    if (!level || level === 'off') return {}

    const m = this.collectCatalogModels().find((x) => x.provider === provider && x.id === modelId)

    // Unknown/manual model: default to the OpenAI-style reasoning shape (which
    // is also the fallback wire protocol used by createModel for manual ids).
    if (!m) {
      return { reasoning: { effort: level, summary: 'auto' } }
    }

    const mapped = m.thinkingLevelMap?.[level]
    if (mapped === null) return {}
    const effort = typeof mapped === 'string' ? mapped : level

    const isAnthropicStyle =
      m.provider === 'anthropic' || (m.provider === 'opencode-go' && m.api === 'anthropic-messages')
    const isOpenAIStyle =
      m.provider === 'openai' ||
      (m.provider === 'opencode-go' &&
        (m.api === 'openai-completions' || m.api === 'openai-responses'))

    if (isAnthropicStyle) {
      const ratio = level === 'low' ? 0.25 : level === 'medium' ? 0.5 : 0.75
      const budget = Math.min(Math.max(1024, Math.round((m.maxTokens || 8192) * ratio)), 32000)
      return { thinking: { type: 'enabled', budget_tokens: budget } }
    }

    if (isOpenAIStyle) {
      return { reasoning: { effort, summary: 'auto' } }
    }

    if (m.provider === 'google') {
      return {
        thinkingConfig: {
          thinkingBudget: level === 'low' ? 1024 : level === 'medium' ? 8192 : 16384
        }
      }
    }

    return {}
  }

  private collectCatalogModels(): CatalogModelLike[] {
    const models: CatalogModelLike[] = []
    for (const provider of this.providers) {
      const providerModels = provider.getModels() as unknown as readonly CatalogModelLike[]
      models.push(...providerModels)
    }
    return models
  }

  private toModelInfo(m: CatalogModelLike): ModelInfo {
    const supportedLevels = m.reasoning
      ? (getSupportedThinkingLevels(m as never) as ReasoningEffort[])
      : undefined

    return {
      id: m.id,
      apiModelId: m.id,
      name: m.name,
      provider: m.provider as ModelProvider,
      api: m.api,
      baseUrl: m.baseUrl,
      description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      supportedReasoningLevels: supportedLevels,
      pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
      parameters: this.buildParameters(m)
    }
  }

  private buildParameters(m: CatalogModelLike): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    if (m.maxTokens !== undefined) {
      params.maxTokens = m.maxTokens
    }
    return params
  }
}
