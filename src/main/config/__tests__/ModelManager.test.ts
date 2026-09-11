import { describe, it, expect } from 'vitest'
import { ModelManager } from '../ModelManager'

describe('ModelManager with OpenCode Go', () => {
  const modelManager = new ModelManager()

  it('includes opencode-go models in getAvailableModels()', () => {
    const models = modelManager.getAvailableModels()
    const opencodeModels = models.filter((m) => m.provider === 'opencode-go')

    expect(opencodeModels.length).toBeGreaterThan(0)

    // DeepSeek V4 Flash should exist
    const deepseek = opencodeModels.find((m) => m.apiModelId === 'deepseek-v4-flash')
    expect(deepseek).toBeDefined()
    expect(deepseek?.api).toBe('openai-completions')
    expect(deepseek?.baseUrl).toBe('https://opencode.ai/zen/go/v1')
    expect(deepseek?.contextWindow).toBe(1000000)

    // MiniMax-M3 should exist (Anthropic wire protocol)
    const minimax = opencodeModels.find((m) => m.apiModelId === 'minimax-m3')
    expect(minimax).toBeDefined()
    expect(minimax?.api).toBe('anthropic-messages')
    expect(minimax?.baseUrl).toBe('https://opencode.ai/zen/go')
    expect(minimax?.contextWindow).toBe(1000000)
  })

  it('correctly maps thinking parameters for OpenCode Go models according to wire protocol', () => {
    const models = modelManager.getAvailableModels()

    // OpenAI-style thinking model: DeepSeek V4 Flash
    const deepseekThinking = models.find(
      (m) =>
        m.provider === 'opencode-go' &&
        m.apiModelId === 'deepseek-v4-flash' &&
        m.id.endsWith('-high')
    )
    expect(deepseekThinking).toBeDefined()
    expect(deepseekThinking?.parameters?.reasoning).toEqual({
      effort: 'high',
      summary: 'auto'
    })

    // Anthropic-style thinking model: Qwen3.8 Flash
    const qwenThinking = models.find(
      (m) =>
        m.provider === 'opencode-go' && m.apiModelId === 'qwen3.8-flash' && m.id.endsWith('-high')
    )
    expect(qwenThinking).toBeDefined()
    expect(qwenThinking?.parameters?.thinking).toBeDefined()
    const thinking = qwenThinking?.parameters?.thinking as { type: string; budget_tokens: number }
    expect(thinking.type).toBe('enabled')
    expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
  })

  it('does not attach temperature parameter to any model presets', () => {
    const models = modelManager.getAvailableModels()
    for (const m of models) {
      expect(m.parameters?.temperature).toBeUndefined()
    }
  })
})
