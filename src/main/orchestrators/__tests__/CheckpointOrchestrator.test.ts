import { describe, it, expect, vi } from 'vitest'
import type { CheckpointBundle } from '@shared/checkpoints/types'
import type { CheckpointBundleStore, CheckpointApiClient } from '@collaragent/checkpoint'
import {
  CheckpointOrchestratorImpl,
  type CheckpointCaptureOptions,
  type CheckpointBundleFactory
} from '../CheckpointOrchestrator'
import { StorageError, StorageErrorCode } from '../../server/fileServer/errors/StorageErrors'

describe('CheckpointOrchestrator', () => {
  const sampleBundle: CheckpointBundle = {
    id: 'b-123',
    createdAt: '2026-09-05T00:00:00.000Z',
    sessionId: 'session-1',
    threadId: 'thread-1',
    projectId: 'proj-100',
    instances: [
      {
        instanceId: 'inst-1',
        instanceType: 'graph-canvas',
        projectId: 'proj-100',
        snapshotId: 'snap-1',
        targetCursor: { seq: 5 }
      }
    ],
    chat: {
      messageId: '__start__'
    },
    label: 'Initial checkpoint',
    reason: 'auto'
  }

  it('createCheckpointBundle passes projectId and returns it in summary', async () => {
    let capturedFactoryOptions: CheckpointCaptureOptions | undefined

    const mockFactory: CheckpointBundleFactory = async ({ options, bundleId, createdAt }) => {
      capturedFactoryOptions = options
      return {
        ...sampleBundle,
        id: bundleId,
        createdAt,
        projectId: options.projectId
      }
    }

    const mockBundleStore: CheckpointBundleStore = {
      createBundle: vi.fn(async (b: CheckpointBundle) => b),
      getBundle: vi.fn(async () => undefined),
      listBundles: vi.fn(async () => [])
    }

    const mockApiClient: Partial<CheckpointApiClient> = {
      restoreCheckpointBundle: vi.fn(async () => ({}))
    }

    const orchestrator = new CheckpointOrchestratorImpl({
      bundleStore: mockBundleStore,
      bundleFactory: mockFactory,
      apiClient: mockApiClient as unknown as CheckpointApiClient
    })

    const summary = await orchestrator.createCheckpointBundle({
      sessionId: 'session-1',
      threadId: 'thread-1',
      projectId: 'proj-100',
      includeInstances: ['inst-1']
    })

    expect(capturedFactoryOptions?.projectId).toBe('proj-100')
    expect(summary.projectId).toBe('proj-100')
    expect(summary.id).toBeDefined()
    expect(mockBundleStore.createBundle).toHaveBeenCalled()
  })

  it('listCheckpointBundles forwards projectId to bundleStore and includes projectId on summaries', async () => {
    const mockBundleStore: CheckpointBundleStore = {
      createBundle: vi.fn(async (b: CheckpointBundle) => b),
      getBundle: vi.fn(async () => undefined),
      listBundles: vi.fn(async (_sessionId: string, _threadId: string, _projectId?: string) => [
        sampleBundle
      ])
    }

    const mockFactory: CheckpointBundleFactory = async () => sampleBundle
    const mockApiClient: Partial<CheckpointApiClient> = {}

    const orchestrator = new CheckpointOrchestratorImpl({
      bundleStore: mockBundleStore,
      bundleFactory: mockFactory,
      apiClient: mockApiClient as unknown as CheckpointApiClient
    })

    const summaries = await orchestrator.listCheckpointBundles('session-1', 'thread-1', 'proj-100')

    expect(mockBundleStore.listBundles).toHaveBeenCalledWith('session-1', 'thread-1', 'proj-100')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].projectId).toBe('proj-100')
    expect(summaries[0].chatMessageId).toBe('__start__')
  })

  it('restoreCheckpointBundle throws StorageError when bundle is not found', async () => {
    const mockBundleStore: CheckpointBundleStore = {
      createBundle: vi.fn(async (b: CheckpointBundle) => b),
      getBundle: vi.fn(async () => undefined),
      listBundles: vi.fn(async () => [])
    }
    const mockFactory: CheckpointBundleFactory = async () => sampleBundle
    const mockApiClient: Partial<CheckpointApiClient> = {}

    const orchestrator = new CheckpointOrchestratorImpl({
      bundleStore: mockBundleStore,
      bundleFactory: mockFactory,
      apiClient: mockApiClient as unknown as CheckpointApiClient
    })

    await expect(
      orchestrator.restoreCheckpointBundle({
        sessionId: 'session-1',
        threadId: 'thread-1',
        bundleId: 'missing-bundle'
      })
    ).rejects.toThrow(StorageError)

    try {
      await orchestrator.restoreCheckpointBundle({
        sessionId: 'session-1',
        threadId: 'thread-1',
        bundleId: 'missing-bundle'
      })
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StorageError)
      if (err instanceof StorageError) {
        expect(err.code).toBe(StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND)
      }
    }
  })

  it('restoreCheckpointBundle throws StorageError when threadId mismatches', async () => {
    const mockBundleStore: CheckpointBundleStore = {
      createBundle: vi.fn(async (b: CheckpointBundle) => b),
      getBundle: vi.fn(async () => sampleBundle),
      listBundles: vi.fn(async () => [])
    }
    const mockFactory: CheckpointBundleFactory = async () => sampleBundle
    const mockApiClient: Partial<CheckpointApiClient> = {}

    const orchestrator = new CheckpointOrchestratorImpl({
      bundleStore: mockBundleStore,
      bundleFactory: mockFactory,
      apiClient: mockApiClient as unknown as CheckpointApiClient
    })

    await expect(
      orchestrator.restoreCheckpointBundle({
        sessionId: 'session-1',
        threadId: 'wrong-thread',
        bundleId: sampleBundle.id
      })
    ).rejects.toThrow(StorageError)

    try {
      await orchestrator.restoreCheckpointBundle({
        sessionId: 'session-1',
        threadId: 'wrong-thread',
        bundleId: sampleBundle.id
      })
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StorageError)
      if (err instanceof StorageError) {
        expect(err.code).toBe(StorageErrorCode.STORAGE_VALIDATION_FAILED)
      }
    }
  })

  it('restoreCheckpointBundle creates auto-checkpoint before restore using projectId', async () => {
    const createdBundles: CheckpointBundle[] = []
    const mockBundleStore: CheckpointBundleStore = {
      createBundle: vi.fn(async (b: CheckpointBundle) => {
        createdBundles.push(b)
        return b
      }),
      getBundle: vi.fn(async () => sampleBundle),
      listBundles: vi.fn(async () => [])
    }

    const mockFactory: CheckpointBundleFactory = async ({ options, bundleId, createdAt }) => ({
      ...sampleBundle,
      id: bundleId,
      createdAt,
      projectId: options.projectId,
      label: options.label,
      reason: options.reason
    })

    const mockApiClient: Partial<CheckpointApiClient> = {
      restoreCheckpointBundle: vi.fn(async () => ({}))
    }

    const orchestrator = new CheckpointOrchestratorImpl({
      bundleStore: mockBundleStore,
      bundleFactory: mockFactory,
      apiClient: mockApiClient as unknown as CheckpointApiClient
    })

    await orchestrator.restoreCheckpointBundle({
      sessionId: 'session-1',
      threadId: 'thread-1',
      bundleId: sampleBundle.id,
      createAutoCheckpoint: true,
      projectId: 'proj-override'
    })

    expect(createdBundles).toHaveLength(1)
    expect(createdBundles[0].projectId).toBe('proj-override')
    expect(createdBundles[0].reason).toBe('restore')
    expect(createdBundles[0].label).toBe('Auto before restore')
    expect(mockApiClient.restoreCheckpointBundle).toHaveBeenCalledWith(sampleBundle.id, {
      sessionId: 'session-1',
      threadId: 'thread-1'
    })
  })
})
