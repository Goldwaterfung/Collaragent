import { describe, it, expect } from 'vitest'
import { ChatMessage, AIMessage, HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { createModelResponseNormalizerMiddleware } from '../middleware/model_response_normalizer.js'

describe('createModelResponseNormalizerMiddleware', () => {
  it('normalizes a generic ChatMessage (from GLM/OpenAI-compatible models) into an AIMessage', async () => {
    const middleware = createModelResponseNormalizerMiddleware()
    const wrapModelCall = middleware.wrapModelCall
    expect(wrapModelCall).toBeDefined()

    // Mock handler returning a ChatMessage (as emitted when GLM omits assistant role on stream)
    const mockHandler = async () => {
      return new ChatMessage({
        role: 'assistant',
        content: 'Hello from GLM model'
      })
    }

    const mockRequest = {
      messages: [new HumanMessage({ content: 'Hi' })],
      tools: [],
      systemMessage: new HumanMessage({ content: '' }),
      state: {},
      runtime: {} as unknown as Parameters<NonNullable<typeof wrapModelCall>>[0]['runtime']
    }

    const result = await wrapModelCall!(
      mockRequest,
      mockHandler as unknown as Parameters<NonNullable<typeof wrapModelCall>>[1]
    )

    expect(AIMessage.isInstance(result)).toBe(true)
    expect(result).toBeInstanceOf(AIMessage)
    expect((result as AIMessage).content).toBe('Hello from GLM model')
  })

  it('preserves an existing AIMessage untouched', async () => {
    const middleware = createModelResponseNormalizerMiddleware()
    const wrapModelCall = middleware.wrapModelCall

    const originalAiMessage = new AIMessage({
      content: 'Hello from GPT-4',
      tool_calls: [
        {
          name: 'test_tool',
          args: { query: 'test' },
          id: 'call_123',
          type: 'tool_call'
        }
      ]
    })

    const mockHandler = async () => originalAiMessage
    const mockRequest = {
      messages: [],
      tools: [],
      systemMessage: new HumanMessage({ content: '' }),
      state: {},
      runtime: {} as unknown as Parameters<NonNullable<typeof wrapModelCall>>[0]['runtime']
    }

    const result = await wrapModelCall!(
      mockRequest,
      mockHandler as unknown as Parameters<NonNullable<typeof wrapModelCall>>[1]
    )

    expect(result).toBe(originalAiMessage)
    expect((result as AIMessage).tool_calls?.length).toBe(1)
  })

  it('preserves a Command untouched', async () => {
    const middleware = createModelResponseNormalizerMiddleware()
    const wrapModelCall = middleware.wrapModelCall

    const command = new Command({ update: { messages: [] } })
    const mockHandler = async () => command
    const mockRequest = {
      messages: [],
      tools: [],
      systemMessage: new HumanMessage({ content: '' }),
      state: {},
      runtime: {} as unknown as Parameters<NonNullable<typeof wrapModelCall>>[0]['runtime']
    }

    const result = await wrapModelCall!(
      mockRequest,
      mockHandler as unknown as Parameters<NonNullable<typeof wrapModelCall>>[1]
    )
    expect(result).toBe(command)
  })
})
