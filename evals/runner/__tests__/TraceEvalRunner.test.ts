/**
 * evals/runner/__tests__/TraceEvalRunner.test.ts
 * Unit tests for TraceEvalRunner evaluating real Langfuse traces and pushing automated scores.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Langfuse } from 'langfuse'
import { TraceEvalRunner } from '../TraceEvalRunner'

describe('TraceEvalRunner - Real Trace Evaluation & Auto-Annotation', () => {
  let mockLangfuseClient: {
    api: {
      traceList: ReturnType<typeof vi.fn>
      traceGet: ReturnType<typeof vi.fn>
    }
    score: ReturnType<typeof vi.fn>
    flushAsync: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test'
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test'
    process.env.LANGFUSE_BASE_URL = 'http://localhost:3000'

    const scoreMock = vi.fn<(params: unknown) => void>()
    mockLangfuseClient = {
      api: {
        traceList: vi.fn(),
        traceGet: vi.fn()
      },
      score: scoreMock,
      flushAsync: vi.fn().mockResolvedValue(undefined)
    }

    vi.spyOn(Langfuse.prototype, 'score').mockImplementation(function (
      this: Langfuse,
      body: unknown
    ) {
      scoreMock(body)
      return this
    } as unknown as typeof Langfuse.prototype.score)
    vi.spyOn(Langfuse.prototype, 'flushAsync').mockImplementation(async () => {})
  })

  it('evaluates a valid real trace with document creation and records passing scores', async () => {
    const validTrace = {
      id: 'trace-doc-123',
      sessionId: 'session-user-1',
      name: 'create-quantum-paper',
      input: { prompt: 'Create quantum report' },
      output: { response: 'Report created successfully' },
      latency: 1.25,
      tags: ['desktop-chat'],
      observations: [
        {
          id: 'gen-1',
          type: 'GENERATION',
          name: 'claude-3-7-sonnet',
          input: 'Prompt for doc',
          output: 'Planning doc',
          usageDetails: {
            input: 120,
            output: 80,
            total: 200
          }
        },
        {
          id: 'span-1',
          type: 'SPAN',
          name: 'createDocument',
          input: JSON.stringify({
            title: 'Quantum Decoherence',
            blocks: [
              { id: 'b1', type: 'h1', content: 'Quantum Decoherence' },
              { id: 'b2', type: 'paragraph', content: 'Introduction to qubits.' },
              { id: 'b3', type: 'h2', content: 'Mathematical Model' },
              { id: 'b4', type: 'paragraph', content: 'Density matrix derivation.' }
            ]
          }),
          output: JSON.stringify({ success: true }),
          level: 'DEFAULT'
        }
      ]
    }

    const runner = new TraceEvalRunner()
    const result = await runner.evaluateTrace(validTrace)

    expect(result.passed).toBe(true)
    expect(result.toolCallsCount).toBe(1)
    expect(result.tokens.totalTokens).toBe(200)
    expect(result.durationMs).toBe(1250)
    expect(result.summary.invariantIntegrity).toBe(1.0)
    expect(result.summary.schemaAdherence).toBe(1.0)

    expect(mockLangfuseClient.score).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-doc-123',
        name: 'benchmark_passed',
        value: 1,
        dataType: 'BOOLEAN'
      })
    )
  })

  it('evaluates an invalid trace with AST heading hierarchy gap and records failure scores', async () => {
    const invalidAstTrace = {
      id: 'trace-invalid-ast',
      sessionId: 'session-user-2',
      input: { prompt: 'Create broken doc' },
      output: { response: 'Done' },
      latency: 0.8,
      observations: [
        {
          id: 'span-1',
          type: 'SPAN',
          name: 'createDocument',
          input: JSON.stringify({
            title: 'Broken Doc',
            blocks: [
              { id: 'b1', type: 'h1', content: 'Main Title' },
              // Heading gap: h1 -> h3 without h2
              { id: 'b2', type: 'h3', content: 'Sub-sub section' }
            ]
          }),
          output: JSON.stringify({ success: true }),
          level: 'DEFAULT'
        }
      ]
    }

    const runner = new TraceEvalRunner()
    const result = await runner.evaluateTrace(invalidAstTrace)

    expect(result.passed).toBe(false)
    expect(result.summary.invariantIntegrity).toBe(0.0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('Heading hierarchy gap detected')

    expect(mockLangfuseClient.score).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-invalid-ast',
        name: 'benchmark_passed',
        value: 0,
        dataType: 'BOOLEAN'
      })
    )
  })

  it('evaluates canvas graph DAG and detects cycles in real traces', async () => {
    const cycleGraphTrace = {
      id: 'trace-cycle-graph',
      sessionId: 'session-user-3',
      input: { prompt: 'Create cyclical graph' },
      output: { response: 'Graph created' },
      latency: 0.5,
      observations: [
        {
          id: 'span-1',
          type: 'SPAN',
          name: 'layoutGraph',
          input: JSON.stringify({
            graph: {
              nodes: {
                n1: { id: 'n1', type: 'card', name: 'Node 1' },
                n2: { id: 'n2', type: 'card', name: 'Node 2' }
              },
              relationships: {
                r1: { id: 'r1', from: { nodeId: 'n1' }, to: { nodeId: 'n2' } },
                r2: { id: 'r2', from: { nodeId: 'n2' }, to: { nodeId: 'n1' } } // Cycle!
              }
            }
          }),
          output: JSON.stringify({ success: true }),
          level: 'DEFAULT'
        }
      ]
    }

    const runner = new TraceEvalRunner()
    const result = await runner.evaluateTrace(cycleGraphTrace)

    expect(result.passed).toBe(false)
    expect(result.summary.invariantIntegrity).toBe(0.0)
    expect(result.errors.some((e) => e.includes('Directed cycle detected'))).toBe(true)
  })

  it('evaluates error recovery when an intermediate tool failed but agent recovered', async () => {
    const recoveredTrace = {
      id: 'trace-recovered',
      sessionId: 'session-user-4',
      input: { prompt: 'Execute query' },
      output: { response: 'Successfully recovered and finished' },
      latency: 2.1,
      observations: [
        {
          id: 'span-1',
          type: 'SPAN',
          name: 'runCommand',
          input: JSON.stringify({ cmd: 'invalid_tool_arg' }),
          output: '',
          level: 'ERROR',
          statusMessage: 'Command execution timed out'
        },
        {
          id: 'span-2',
          type: 'SPAN',
          name: 'runCommand',
          input: JSON.stringify({ cmd: 'valid_arg' }),
          output: 'success',
          level: 'DEFAULT'
        }
      ]
    }

    const runner = new TraceEvalRunner()
    const result = await runner.evaluateTrace(recoveredTrace)

    expect(result.summary.errorRecoverySuccess).toBe(true)
  })
})
