/**
 * evals/telemetry/__tests__/LangfuseCallbackHandler.test.ts
 * Unit tests for LangfuseCallbackHandler verifying root trace propagation (updateRoot).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Langfuse } from 'langfuse'
import type { Serialized } from '@langchain/core/load/serializable'
import { LangfuseCallbackHandler } from '../../../src/collaragent/telemetry/langfuse'

type LangfuseTraceClient = ReturnType<Langfuse['trace']>
type LangfuseSpanClient = ReturnType<LangfuseTraceClient['span']>
type LangfuseGenerationClient = ReturnType<LangfuseTraceClient['generation']>

const mockChainSerialized: Serialized = {
  lc: 1,
  type: 'constructor',
  id: ['langgraph', 'root'],
  kwargs: {}
}

const mockToolSerialized: Serialized = {
  lc: 1,
  type: 'constructor',
  id: ['tool_node'],
  kwargs: {}
}

describe('LangfuseCallbackHandler - Root Trace Propagation', () => {
  let mockTrace: {
    update: ReturnType<typeof vi.fn>
    span: ReturnType<typeof vi.fn>
    generation: ReturnType<typeof vi.fn>
  }
  let mockSpan: {
    end: ReturnType<typeof vi.fn>
    span: ReturnType<typeof vi.fn>
    generation: ReturnType<typeof vi.fn>
  }
  let mockGeneration: {
    end: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    mockGeneration = {
      end: vi.fn()
    }

    mockSpan = {
      end: vi.fn(),
      span: vi.fn(),
      generation: vi.fn()
    }
    mockSpan.span.mockReturnValue(mockSpan as unknown as LangfuseSpanClient)
    mockSpan.generation.mockReturnValue(mockGeneration as unknown as LangfuseGenerationClient)

    mockTrace = {
      update: vi.fn(),
      span: vi.fn(),
      generation: vi.fn()
    }
    mockTrace.span.mockReturnValue(mockSpan as unknown as LangfuseSpanClient)
    mockTrace.generation.mockReturnValue(mockGeneration as unknown as LangfuseGenerationClient)

    vi.spyOn(Langfuse.prototype, 'trace').mockImplementation(
      () => mockTrace as unknown as LangfuseTraceClient
    )
    vi.spyOn(Langfuse.prototype, 'flushAsync').mockImplementation(async () => {})
    vi.spyOn(Langfuse.prototype, 'shutdownAsync').mockImplementation(async () => {})
  })

  it('initializes root trace and propagates input on root handleChainStart', () => {
    const handler = new LangfuseCallbackHandler({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      sessionId: 'session-123',
      userId: 'user-456',
      tags: ['desktop-chat']
    })

    const rootRunId = 'run-root-1'
    handler.handleChainStart(
      mockChainSerialized,
      { messages: [{ role: 'user', content: 'Hello world' }] },
      rootRunId
    )

    expect(mockTrace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { messages: [{ role: 'user', content: 'Hello world' }] }
      })
    )
    expect(mockTrace.span).not.toHaveBeenCalled()
  })

  it('propagates output to root trace on root handleChainEnd', () => {
    const handler = new LangfuseCallbackHandler({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      sessionId: 'session-123'
    })

    const rootRunId = 'run-root-1'
    handler.handleChainStart(mockChainSerialized, { input: 'Analyze graph' }, rootRunId)

    handler.handleChainEnd({ output: 'Graph analyzed successfully' }, rootRunId)

    expect(mockTrace.update).toHaveBeenCalledWith({
      output: { output: 'Graph analyzed successfully' }
    })
  })

  it('propagates error to root trace on root handleChainError', () => {
    const handler = new LangfuseCallbackHandler({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      sessionId: 'session-123'
    })

    const rootRunId = 'run-root-1'
    handler.handleChainStart(mockChainSerialized, { input: 'Test error' }, rootRunId)

    handler.handleChainError(new Error('Graph node failed'), rootRunId)

    expect(mockTrace.update).toHaveBeenCalledWith({
      metadata: { error: 'Graph node failed' }
    })
  })

  it('creates child spans for nested chains when parentRunId is present', () => {
    const handler = new LangfuseCallbackHandler({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      sessionId: 'session-123'
    })

    const rootRunId = 'run-root-1'
    const childRunId = 'run-child-2'

    // Start root chain
    handler.handleChainStart(mockChainSerialized, { input: 'Top level' }, rootRunId)

    // Start child chain
    handler.handleChainStart(
      mockToolSerialized,
      { tool_name: 'createDocument' },
      childRunId,
      undefined,
      undefined,
      undefined,
      'tool_node',
      rootRunId
    )

    expect(mockTrace.span).toHaveBeenCalledWith(
      expect.objectContaining({
        id: childRunId,
        name: 'tool_node',
        input: { tool_name: 'createDocument' }
      })
    )

    // End child chain
    handler.handleChainEnd({ result: 'Doc created' }, childRunId)

    expect(mockSpan.end).toHaveBeenCalledWith({
      output: { result: 'Doc created' }
    })
  })

  it('respects updateRoot: false configuration option', () => {
    const handler = new LangfuseCallbackHandler({
      publicKey: 'pk-lf-test',
      secretKey: 'sk-lf-test',
      sessionId: 'session-123',
      updateRoot: false
    })

    const rootRunId = 'run-root-1'
    handler.handleChainStart(mockChainSerialized, { input: 'Top level' }, rootRunId)

    expect(mockTrace.update).not.toHaveBeenCalled()

    handler.handleChainEnd({ output: 'Done' }, rootRunId)

    expect(mockTrace.update).not.toHaveBeenCalled()
  })
})
