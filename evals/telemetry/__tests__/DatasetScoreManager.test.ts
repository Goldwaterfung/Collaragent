/**
 * evals/telemetry/__tests__/DatasetScoreManager.test.ts
 * Comprehensive unit test suite for DatasetScoreManager and score formatting helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Langfuse } from 'langfuse'
import {
  DatasetScoreManager,
  formatScoresFromSummary,
  SCORE_NAMES,
  type EvaluationScore
} from '../index'
import type { ScenarioInvariantSummary } from '../../assertions/types'

describe('evals/telemetry/scores', () => {
  const passingSummary: ScenarioInvariantSummary = {
    passed: true,
    toolSelectionAccuracy: 1.0,
    schemaAdherence: 1.0,
    invariantIntegrity: 1.0,
    rollbackInvariantPassed: true,
    errorRecoverySuccess: true,
    errors: [],
    details: {
      toolCount: 1,
      astBlockCount: 5
    }
  }

  const failingSummary: ScenarioInvariantSummary = {
    passed: false,
    toolSelectionAccuracy: 0.0,
    schemaAdherence: 0.0,
    invariantIntegrity: 0.0,
    rollbackInvariantPassed: false,
    errorRecoverySuccess: false,
    errors: ['Invalid block hierarchy', 'Byte delta: 12'],
    details: {
      toolCount: 0
    }
  }

  it('formats passing ScenarioInvariantSummary into standardized Langfuse scores', () => {
    const scores = formatScoresFromSummary(passingSummary, { scenarioId: 'SCN-DOC-01' })

    expect(scores).toHaveLength(6)

    const benchmarkScore = scores.find((s) => s.name === SCORE_NAMES.BENCHMARK_PASSED)
    expect(benchmarkScore).toBeDefined()
    expect(benchmarkScore?.value).toBe(1)
    expect(benchmarkScore?.dataType).toBe('BOOLEAN')

    const toolScore = scores.find((s) => s.name === SCORE_NAMES.TOOL_SELECTION_ACCURACY)
    expect(toolScore).toBeDefined()
    expect(toolScore?.value).toBe(1.0)
    expect(toolScore?.dataType).toBe('NUMERIC')
    expect(toolScore?.metadata).toMatchObject({
      toolCount: 1,
      astBlockCount: 5,
      scenarioId: 'SCN-DOC-01'
    })

    const rollbackScore = scores.find((s) => s.name === SCORE_NAMES.ROLLBACK_INVARIANT_PASSED)
    expect(rollbackScore).toBeDefined()
    expect(rollbackScore?.value).toBe(1)
    expect(rollbackScore?.dataType).toBe('BOOLEAN')

    const recoveryScore = scores.find((s) => s.name === SCORE_NAMES.ERROR_RECOVERY_SUCCESS)
    expect(recoveryScore).toBeDefined()
    expect(recoveryScore?.value).toBe(1)
    expect(recoveryScore?.dataType).toBe('BOOLEAN')
  })

  it('formats failing ScenarioInvariantSummary with 0 boolean values and diagnostic comments', () => {
    const scores = formatScoresFromSummary(failingSummary)

    const rollbackScore = scores.find((s) => s.name === SCORE_NAMES.ROLLBACK_INVARIANT_PASSED)
    expect(rollbackScore?.value).toBe(0)
    expect(rollbackScore?.dataType).toBe('BOOLEAN')
    expect(rollbackScore?.comment).toContain('Rollback failed')

    const invariantScore = scores.find((s) => s.name === SCORE_NAMES.INVARIANT_INTEGRITY)
    expect(invariantScore?.value).toBe(0.0)
    expect(invariantScore?.comment).toContain('Invariant violations detected')
    expect(invariantScore?.comment).toContain('Invalid block hierarchy')
  })
})

describe('evals/telemetry/DatasetScoreManager', () => {
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
  })

  describe('Disabled / Fail-Safe Mode (No Credentials)', () => {
    it('initializes with isEnabled = false when credentials are absent', () => {
      const manager = new DatasetScoreManager()
      expect(manager.isEnabled).toBe(false)
    })

    it('gracefully no-ops on syncDataset and returns undefined', async () => {
      const manager = new DatasetScoreManager()
      const result = await manager.syncDataset('test-suite', 'Test description')
      expect(result).toBeUndefined()
    })

    it('gracefully no-ops on syncDatasetItem and returns undefined', async () => {
      const manager = new DatasetScoreManager()
      const result = await manager.syncDatasetItem({
        datasetName: 'test-suite',
        input: { prompt: 'Create doc' }
      })
      expect(result).toBeUndefined()
    })

    it('gracefully no-ops on createDatasetRunItem and returns undefined', async () => {
      const manager = new DatasetScoreManager()
      const result = await manager.createDatasetRunItem({
        runName: 'eval-run-1',
        datasetItemId: 'item-123'
      })
      expect(result).toBeUndefined()
    })

    it('gracefully returns false on recordScore and recordScores without throwing', () => {
      const manager = new DatasetScoreManager()
      const singleResult = manager.recordScore({
        traceId: 'trace-1',
        score: {
          name: SCORE_NAMES.TOOL_SELECTION_ACCURACY,
          value: 1.0,
          dataType: 'NUMERIC'
        }
      })
      expect(singleResult).toBe(false)

      const batchResult = manager.recordScores({
        traceId: 'trace-1',
        scores: []
      })
      expect(batchResult).toBe(false)
    })

    it('gracefully returns false on recordScenarioSummary', () => {
      const manager = new DatasetScoreManager()
      const result = manager.recordScenarioSummary({
        traceId: 'trace-1',
        summary: {
          passed: true,
          toolSelectionAccuracy: 1.0,
          schemaAdherence: 1.0,
          invariantIntegrity: 1.0,
          rollbackInvariantPassed: true,
          errorRecoverySuccess: true,
          errors: [],
          details: {}
        }
      })
      expect(result).toBe(false)
    })

    it('gracefully handles flush without error', async () => {
      const manager = new DatasetScoreManager()
      await expect(manager.flush()).resolves.toBeUndefined()
    })
  })

  describe('Active Mode with Mocked Langfuse Client', () => {
    let mockClient: {
      createDataset: ReturnType<typeof vi.fn>
      createDatasetItem: ReturnType<typeof vi.fn>
      createDatasetRunItem: ReturnType<typeof vi.fn>
      score: ReturnType<typeof vi.fn>
      flushAsync: ReturnType<typeof vi.fn>
    }
    let manager: DatasetScoreManager

    beforeEach(() => {
      mockClient = {
        createDataset: vi.fn().mockResolvedValue({ id: 'dataset-uuid-1', name: 'collaragent-v3' }),
        createDatasetItem: vi.fn().mockResolvedValue({ id: 'item-uuid-1' }),
        createDatasetRunItem: vi.fn().mockResolvedValue({ id: 'run-item-uuid-1' }),
        score: vi.fn(),
        flushAsync: vi.fn().mockResolvedValue(undefined)
      }

      manager = new DatasetScoreManager({
        client: mockClient as unknown as Langfuse
      })
    })

    it('reports isEnabled = true when client is injected', () => {
      expect(manager.isEnabled).toBe(true)
    })

    it('syncs dataset and returns metadata', async () => {
      const result = await manager.syncDataset('collaragent-v3', '30-scenario benchmark suite', {
        version: '3.0'
      })

      expect(mockClient.createDataset).toHaveBeenCalledWith({
        name: 'collaragent-v3',
        description: '30-scenario benchmark suite',
        metadata: { version: '3.0' }
      })
      expect(result).toEqual({ id: 'dataset-uuid-1', name: 'collaragent-v3' })
    })

    it('syncs dataset items with inputs, expected outputs, and metadata', async () => {
      const result = await manager.syncDatasetItem({
        datasetName: 'collaragent-v3',
        itemId: 'SCN-DOC-01',
        input: { prompt: 'Create doc' },
        expectedOutput: { tool: 'createDocument' },
        metadata: { tier: 'tier1_doc' },
        status: 'ACTIVE'
      })

      expect(mockClient.createDatasetItem).toHaveBeenCalledWith({
        datasetName: 'collaragent-v3',
        id: 'SCN-DOC-01',
        input: { prompt: 'Create doc' },
        expectedOutput: { tool: 'createDocument' },
        metadata: { tier: 'tier1_doc' },
        status: 'ACTIVE'
      })
      expect(result).toEqual({ id: 'item-uuid-1' })
    })

    it('links traces to dataset runs via createDatasetRunItem', async () => {
      const result = await manager.createDatasetRunItem({
        runName: 'nightly-eval-20260902',
        datasetItemId: 'SCN-DOC-01',
        traceId: 'trace-uuid-123',
        observationId: 'span-uuid-456',
        metadata: { model: 'claude-3-7-sonnet' },
        runDescription: 'Automated CI run'
      })

      expect(mockClient.createDatasetRunItem).toHaveBeenCalledWith({
        runName: 'nightly-eval-20260902',
        datasetItemId: 'SCN-DOC-01',
        traceId: 'trace-uuid-123',
        observationId: 'span-uuid-456',
        metadata: { model: 'claude-3-7-sonnet' },
        runDescription: 'Automated CI run'
      })
      expect(result).toEqual({ id: 'run-item-uuid-1' })
    })

    it('records individual scores with exact Langfuse parameters', () => {
      const score: EvaluationScore = {
        name: SCORE_NAMES.TOOL_SELECTION_ACCURACY,
        value: 1.0,
        dataType: 'NUMERIC',
        comment: 'Exact match',
        metadata: { tier: 'tier1_doc' }
      }

      const recorded = manager.recordScore({
        traceId: 'trace-uuid-123',
        score,
        observationId: 'obs-1',
        datasetRunId: 'run-1'
      })

      expect(recorded).toBe(true)
      expect(mockClient.score).toHaveBeenCalledWith({
        traceId: 'trace-uuid-123',
        observationId: 'obs-1',
        datasetRunId: 'run-1',
        name: SCORE_NAMES.TOOL_SELECTION_ACCURACY,
        value: 1.0,
        comment: 'Exact match',
        metadata: { tier: 'tier1_doc' },
        dataType: 'NUMERIC'
      })
    })

    it('records batch scores and scenario summaries', () => {
      const summary: ScenarioInvariantSummary = {
        passed: true,
        toolSelectionAccuracy: 1.0,
        schemaAdherence: 1.0,
        invariantIntegrity: 1.0,
        rollbackInvariantPassed: true,
        errorRecoverySuccess: true,
        errors: [],
        details: { scenarioId: 'SCN-DOC-01' }
      }

      const recorded = manager.recordScenarioSummary({
        traceId: 'trace-uuid-123',
        summary,
        datasetRunId: 'run-uuid-456',
        metadata: { model: 'gpt-4.1' }
      })

      expect(recorded).toBe(true)
      expect(mockClient.score).toHaveBeenCalledTimes(6)
    })

    it('flushes pending events asynchronously', async () => {
      await manager.flush()
      expect(mockClient.flushAsync).toHaveBeenCalledTimes(1)
    })
  })
})
