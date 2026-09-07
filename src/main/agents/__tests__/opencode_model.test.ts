import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir()
  }
}))

import { createModel } from '../utils'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'

describe('createModel with OpenCode Go', () => {
  it('instantiates ChatOpenAI for openai-completions model with x-opencode-session and User-Agent', async () => {
    const threadId = 'test-thread-uuid-123'
    const model = (await createModel(
      {
        provider: 'opencode-go',
        modelId: 'deepseek-v4-flash'
      },
      'sk-test-key',
      { threadId }
    )) as ChatOpenAI

    expect(model).toBeInstanceOf(ChatOpenAI)
    expect(model.clientConfig.baseURL).toBe('https://opencode.ai/zen/go/v1')
    expect(model.clientConfig.defaultHeaders).toEqual({
      'x-opencode-session': threadId,
      'User-Agent': 'collaragent/1.0.0'
    })
  })

  it('instantiates ChatAnthropic for anthropic-messages model with x-opencode-session and User-Agent', async () => {
    const threadId = 'test-thread-uuid-456'
    const model = (await createModel(
      {
        provider: 'opencode-go',
        modelId: 'minimax-m3'
      },
      'sk-test-key',
      { threadId }
    )) as ChatAnthropic

    expect(model).toBeInstanceOf(ChatAnthropic)
    expect(model.apiUrl).toBe('https://opencode.ai/zen/go')
    expect(model.clientOptions?.baseURL).toBe('https://opencode.ai/zen/go')
    expect(model.clientOptions?.defaultHeaders).toEqual({
      'x-opencode-session': threadId,
      'User-Agent': 'collaragent/1.0.0'
    })
  })

  it('injects headers for backwards-compatible openai provider with opencode.ai baseUrl', async () => {
    const threadId = 'test-legacy-thread-789'
    const model = (await createModel(
      {
        provider: 'openai',
        modelId: 'deepseek-v4-flash',
        baseUrl: 'https://opencode.ai/zen/go/v1'
      },
      'sk-test-key',
      { threadId }
    )) as ChatOpenAI

    expect(model).toBeInstanceOf(ChatOpenAI)
    expect(model.clientConfig.baseURL).toBe('https://opencode.ai/zen/go/v1')
    expect(model.clientConfig.defaultHeaders).toEqual({
      'x-opencode-session': threadId,
      'User-Agent': 'collaragent/1.0.0'
    })
  })
})
