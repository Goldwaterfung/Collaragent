/**
 * evals/runner/__tests__/EvalRunner.test.ts
 * Unit tests for Headless EvalRunner engine, scenario lifecycles, and suite aggregation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EvalRunner } from '../EvalRunner'
import type { EvaluationScenario } from '../../scenarios/types'
import { DatasetScoreManager } from '../../telemetry/DatasetScoreManager'
import type { AgentInvokerFn, AgentExecutionOutput } from '../types'

const SCN_DOC_01: EvaluationScenario = {
  id: 'SCN-DOC-01',
  tier: 'tier1_doc',
  name: 'Document Generation',
  description: 'Creates a valid document',
  prompt: 'Create doc',
  expectedTools: ['createDocument'],
  invariantRules: { validateLexicalAST: true }
}

const SCN_REV_01: EvaluationScenario = {
  id: 'SCN-REV-01',
  tier: 'tier4_rollback',
  name: 'Rollback Parity',
  description: 'Reverts document state',
  prompt: 'Revert changes',
  expectedTools: ['patchDocument'],
  invariantRules: { validateRollbackParity: true }
}

import * as scenariosModule from '../../scenarios'

describe('EvalRunner', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('Constructor & Configuration', () => {
    it('initializes with default options', () => {
      const runner = new EvalRunner()
      expect(runner).toBeDefined()
    })

    it('accepts custom configuration options', () => {
      const runner = new EvalRunner({
        tier: 'tier1_doc',
        scenarioId: 'SCN-DOC-01',
        timeoutMs: 5000,
        datasetName: 'custom-dataset',
        runName: 'custom-run-001',
        modelName: 'claude-3-7-sonnet'
      })
      expect(runner).toBeDefined()
    })
  })

  describe('runScenario with Custom AgentInvoker', () => {
    it('successfully evaluates a passing scenario with valid AST and expected tool', async () => {
      const validDocPayload = {
        title: 'Quantum Computing Foundations',
        blocks: [
          { id: 'b1', type: 'h1', content: 'Quantum Computing' },
          { id: 'b2', type: 'h2', content: 'Core Principles' },
          { id: 'b3', type: 'h3', content: 'Superposition' }
        ]
      }

      const customInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => ({
        output: 'Created document successfully',
        toolCalls: [
          {
            name: 'createDocument',
            args: { title: 'Quantum Computing Foundations' },
            status: 'success'
          }
        ],
        documentPayload: validDocPayload,
        tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }))

      const runner = new EvalRunner({
        agentInvoker: customInvoker
      })

      const result = await runner.runScenario(SCN_DOC_01)

      expect(customInvoker).toHaveBeenCalledTimes(1)
      expect(result.scenarioId).toBe('SCN-DOC-01')
      expect(result.tier).toBe('tier1_doc')
      expect(result.passed).toBe(true)
      expect(result.summary.toolSelectionAccuracy).toBe(1.0)
      expect(result.summary.schemaAdherence).toBe(1.0)
      expect(result.summary.invariantIntegrity).toBe(1.0)
      expect(result.tokens.totalTokens).toBe(150)
      expect(result.errors).toHaveLength(0)
    })

    it('fails a scenario when expected initial tool does not match', async () => {
      const customInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => ({
        output: 'Invoked wrong tool',
        toolCalls: [
          {
            name: 'wrongToolName',
            args: {},
            status: 'success'
          }
        ]
      }))

      const runner = new EvalRunner({
        agentInvoker: customInvoker
      })

      const result = await runner.runScenario(SCN_DOC_01)

      expect(result.passed).toBe(false)
      expect(result.summary.toolSelectionAccuracy).toBe(0.0)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('Tool selection mismatch')
    })

    it('fails a scenario when AST invariant validation detects duplicate block IDs', async () => {
      const invalidDocPayload = {
        title: 'Duplicate ID Doc',
        blocks: [
          { id: 'duplicate-id-1', type: 'h1', content: 'Heading' },
          { id: 'duplicate-id-1', type: 'paragraph', content: 'Paragraph' }
        ]
      }

      const customInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => ({
        toolCalls: [
          {
            name: 'createDocument',
            args: {},
            status: 'success'
          }
        ],
        documentPayload: invalidDocPayload
      }))

      const runner = new EvalRunner({
        agentInvoker: customInvoker
      })

      const result = await runner.runScenario(SCN_DOC_01)

      expect(result.passed).toBe(false)
      expect(result.summary.invariantIntegrity).toBe(0.0)
      expect(result.errors.some((e) => e.includes('Duplicate block ID'))).toBe(true)
    })

    it('validates mathematical rollback byte parity', async () => {
      const initialSnapshot = { blocks: [{ id: 'b1', content: 'initial' }] }
      const restoredSnapshot = { blocks: [{ id: 'b1', content: 'initial' }] }

      const customInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => ({
        toolCalls: [
          {
            name: 'patchDocument',
            args: {},
            status: 'success'
          }
        ],
        documentPayload: {
          title: 'Rollback Test',
          blocks: [{ id: 'b1', type: 'paragraph', content: 'initial' }]
        },
        initialSnapshot,
        restoredSnapshot
      }))

      const runner = new EvalRunner({
        agentInvoker: customInvoker
      })

      const result = await runner.runScenario(SCN_REV_01)

      expect(result.passed).toBe(true)
      expect(result.summary.rollbackInvariantPassed).toBe(true)
    })

    it('catches execution exceptions gracefully and marks scenario as failed', async () => {
      const customInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => {
        throw new Error('Network connection timeout to LLM API')
      })

      const runner = new EvalRunner({
        agentInvoker: customInvoker
      })

      const result = await runner.runScenario(SCN_DOC_01)

      expect(result.passed).toBe(false)
      expect(result.errors).toContain('Network connection timeout to LLM API')
    })
  })

  describe('runSuite', () => {
    it('runs all scenarios in a single tier when filtered by tier', async () => {
      vi.spyOn(scenariosModule, 'getScenariosByTier').mockReturnValue([SCN_DOC_01])
      const mockInvoker: AgentInvokerFn = vi.fn(
        async (scenario): Promise<AgentExecutionOutput> => ({
          toolCalls: [
            {
              name: scenario.expectedTools[0],
              args: {},
              status: 'success'
            }
          ],
          tokens: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
        })
      )

      const runner = new EvalRunner({
        tier: 'tier1_doc',
        agentInvoker: mockInvoker
      })

      const suiteResult = await runner.runSuite()

      expect(suiteResult.totalScenarios).toBe(1)
      expect(suiteResult.tierSummaries.tier1_doc.total).toBe(1)
      expect(mockInvoker).toHaveBeenCalledTimes(1)
      expect(suiteResult.totalTokens.totalTokens).toBe(75)
    })

    it('runs a single scenario when filtered by scenarioId', async () => {
      vi.spyOn(scenariosModule, 'getScenarioById').mockReturnValue(SCN_DOC_01)
      const mockInvoker: AgentInvokerFn = vi.fn(
        async (scenario): Promise<AgentExecutionOutput> => ({
          toolCalls: [
            {
              name: scenario.expectedTools[0],
              args: {},
              status: 'success'
            }
          ]
        })
      )

      const runner = new EvalRunner({
        scenarioId: 'SCN-DOC-01',
        agentInvoker: mockInvoker
      })

      const suiteResult = await runner.runSuite()

      expect(suiteResult.totalScenarios).toBe(1)
      expect(suiteResult.scenarioResults[0].scenarioId).toBe('SCN-DOC-01')
      expect(mockInvoker).toHaveBeenCalledTimes(1)
    })

    it('throws an error when scenarioId does not exist in registry', async () => {
      vi.spyOn(scenariosModule, 'getScenarioById').mockReturnValue(undefined)
      const runner = new EvalRunner({
        scenarioId: 'SCN-NONEXISTENT-999'
      })

      await expect(runner.runSuite()).rejects.toThrow(
        'Evaluation scenario with ID "SCN-NONEXISTENT-999" not found'
      )
    })

    it('triggers onScenarioStart and onScenarioComplete callbacks', async () => {
      vi.spyOn(scenariosModule, 'getScenarioById').mockReturnValue(SCN_DOC_01)
      const onStart = vi.fn()
      const onComplete = vi.fn()

      const mockInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => ({
        toolCalls: [{ name: 'createDocument', args: {}, status: 'success' }]
      }))

      const runner = new EvalRunner({
        scenarioId: 'SCN-DOC-01',
        agentInvoker: mockInvoker,
        onScenarioStart: onStart,
        onScenarioComplete: onComplete
      })

      await runner.runSuite()

      expect(onStart).toHaveBeenCalledWith(SCN_DOC_01, 0, 1)
      expect(onComplete).toHaveBeenCalledWith(
        SCN_DOC_01,
        expect.objectContaining({ scenarioId: 'SCN-DOC-01' }),
        0,
        1
      )
    })
  })

  describe('Live Agent Execution Requirements', () => {
    it('fails scenario when live execution is invoked without an active agentInvoker', async () => {
      const runner = new EvalRunner()

      const result = await runner.runScenario(SCN_DOC_01)
      expect(result.passed).toBe(false)
      expect(result.errors.some((e) => e.includes('active agentInvoker'))).toBe(true)
    })
  })

  describe('Telemetry & Score Manager Lifecycle', () => {
    it('flushes DatasetScoreManager and telemetry handler even when execution errors', async () => {
      const mockScoreManager = new DatasetScoreManager()
      const flushSpy = vi.spyOn(mockScoreManager, 'flush').mockResolvedValue()

      const failingInvoker: AgentInvokerFn = vi.fn(async (): Promise<AgentExecutionOutput> => {
        throw new Error('Fatal simulation crash')
      })

      const runner = new EvalRunner({
        scoreManager: mockScoreManager,
        agentInvoker: failingInvoker
      })

      await runner.runScenario(SCN_DOC_01)

      expect(flushSpy).toHaveBeenCalledTimes(1)
    })
  })
})
