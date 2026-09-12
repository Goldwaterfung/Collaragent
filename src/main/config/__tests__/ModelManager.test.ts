import { describe, it, expect } from 'vitest'
import { ModelManager } from '../ModelManager'

describe('ModelManager with OpenCode Go', () => {
  const modelManager = new ModelManager()

  it('includes opencode-go models in getAvailableModels()', () => {
    const models = modelManager.getAvailableModels()
    const opencodeModels = models.filter((m) => m.provider === 'opencode-go')

    expect(opencodeModels.length).toBeGreaterThan(0)

    // DeepSeek V4 Flash should exist
    const deepseek = opencodeModels.find((m) => m.id === 'deepseek-v4-flash')
    expect(deepseek).toBeDefined()
    expect(deepseek?.api).toBe('openai-completions')
    expect(deepseek?.baseUrl).toBe('https://opencode.ai/zen/go/v1')
    expect(deepseek?.contextWindow).toBe(1000000)

    // MiniMax-M3 should exist (Anthropic wire protocol)
    const minimax = opencodeModels.find((m) => m.id === 'minimax-m3')
    expect(minimax).toBeDefined()
    expect(minimax?.api).toBe('anthropic-messages')
    expect(minimax?.baseUrl).toBe('https://opencode.ai/zen/go')
    expect(minimax?.contextWindow).toBe(1000000)
  })

  it('exposes supported reasoning levels from the pi-ai catalog', () => {
    const models = modelManager.getAvailableModels()

    const deepseek = models.find(
      (m) => m.provider === 'opencode-go' && m.id === 'deepseek-v4-flash'
    )
    expect(deepseek?.supportedReasoningLevels).toEqual(['off', 'low', 'high', 'max'])

    const kimi = models.find((m) => m.provider === 'opencode-go' && m.id === 'kimi-k3')
    expect(kimi?.supportedReasoningLevels).toEqual(['max'])
  })

  it('builds openai-style reasoning params for opencode openai-completions models', () => {
    const params = modelManager.buildReasoningParameters('opencode-go', 'deepseek-v4-flash', 'high')
    expect(params).toEqual({ reasoning: { effort: 'high', summary: 'auto' } })
  })

  it('builds anthropic-style thinking params for opencode anthropic-messages models', () => {
    const params = modelManager.buildReasoningParameters('opencode-go', 'qwen3.8-flash', 'high')
    const thinking = params.thinking as { type: string; budget_tokens: number }
    expect(thinking.type).toBe('enabled')
    expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
  })

  it('returns no reasoning params for the off level', () => {
    expect(
      modelManager.buildReasoningParameters('opencode-go', 'deepseek-v4-flash', 'off')
    ).toEqual({})
  })

  it('resolves legacy composite ids to base id plus reasoning effort', () => {
    const resolved = modelManager.resolveModel('opencode-go', 'deepseek-v4-flash-high')
    expect(resolved.apiModelId).toBe('deepseek-v4-flash')
    expect(resolved.legacyReasoningEffort).toBe('high')
  })

  it('does not attach temperature parameter to any model presets', () => {
    const models = modelManager.getAvailableModels()
    for (const m of models) {
      expect(m.parameters?.temperature).toBeUndefined()
    }
  })
})
