import { ModelInfo, ModelProvider } from '../../shared/config/types'
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
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number }
}

export class ModelManager {
  private providers = [
    openaiProvider(),
    anthropicProvider(),
    googleProvider(),
    opencodeGoProvider()
  ]

  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = []

    for (const provider of this.providers) {
      const providerModels = provider.getModels() as unknown as readonly CatalogModelLike[]
      for (const m of providerModels) {
        const supportedLevels = getSupportedThinkingLevels(m as never)
        const activeThinkingLevels = supportedLevels.filter((l) => l !== 'off')
        const providerName = m.provider as ModelProvider

        if (activeThinkingLevels.length > 0) {
          for (const level of activeThinkingLevels) {
            const capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1)
            models.push({
              id: `${m.id}-${level}`,
              apiModelId: m.id,
              name: `${m.name} (Thinking: ${capitalizedLevel})`,
              provider: providerName,
              api: m.api,
              baseUrl: m.baseUrl,
              description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
              contextWindow: m.contextWindow,
              pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
              parameters: this.buildParameters(m, level)
            })
          }

          if (supportedLevels.includes('off')) {
            models.push({
              id: m.id,
              apiModelId: m.id,
              name: `${m.name} (No Thinking)`,
              provider: providerName,
              api: m.api,
              baseUrl: m.baseUrl,
              description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
              contextWindow: m.contextWindow,
              pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
              parameters: this.buildParameters(m, 'off')
            })
          }
        } else {
          models.push({
            id: m.id,
            apiModelId: m.id,
            name: m.name,
            provider: providerName,
            api: m.api,
            baseUrl: m.baseUrl,
            description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
            contextWindow: m.contextWindow,
            pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
            parameters: this.buildParameters(m, undefined)
          })
        }
      }
    }

    return models
  }

  private buildParameters(m: CatalogModelLike, level?: string): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    if (m.maxTokens !== undefined) {
      params.maxTokens = m.maxTokens
    }

    if (level && level !== 'off') {
      const isAnthropicStyle =
        m.provider === 'anthropic' ||
        (m.provider === 'opencode-go' && m.api === 'anthropic-messages')
      const isOpenAIStyle =
        m.provider === 'openai' ||
        (m.provider === 'opencode-go' &&
          (m.api === 'openai-completions' || m.api === 'openai-responses'))

      if (isOpenAIStyle) {
        params.reasoning = {
          effort: level,
          summary: 'auto'
        }
      } else if (isAnthropicStyle) {
        params.thinking = {
          type: 'enabled',
          budget_tokens: Math.min(
            Math.max(
              1024,
              Math.round(
                (m.maxTokens || 8192) * (level === 'low' ? 0.25 : level === 'medium' ? 0.5 : 0.75)
              )
            ),
            32000
          )
        }
      } else if (m.provider === 'google') {
        params.thinkingConfig = {
          thinkingBudget: level === 'low' ? 1024 : level === 'medium' ? 8192 : 16384
        }
      }
    }

    return params
  }
}
