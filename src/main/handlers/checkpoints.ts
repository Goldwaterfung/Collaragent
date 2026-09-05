import { ipcMain, BrowserWindow } from 'electron'
import {
  CHECKPOINT_START_SENTINEL,
  INITIAL_CHECKPOINT_LABEL,
  TURN_CHECKPOINT_LABEL,
  type CheckpointBundle
} from '../../shared/checkpoints/types'
import {
  StorageError,
  StorageErrorCode,
  isStorageError
} from '../server/fileServer/errors/StorageErrors'
import type {
  CheckpointCreateRequest,
  CheckpointCreateResponse,
  CheckpointListRequest,
  CheckpointListResponse,
  CheckpointRestoreRequest,
  CheckpointRestoreResponse,
  CheckpointCancelResponse
} from '../../shared/ipc/checkpoints/types'
import * as Channels from '../../shared/ipc/checkpoints/channels'
import { CheckpointApiClient, HttpCheckpointBundleStore } from '@collaragent/checkpoint'
import {
  CheckpointOrchestratorImpl,
  type CheckpointBundleFactory
} from '../orchestrators/CheckpointOrchestrator'
import type { PersistenceManager } from '../storage/Persistence'
import windowManager from '../windows/WindowManager'
import { canonicalizeGraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'

function resolveWindowRecord(sender: Electron.WebContents) {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window) return undefined
  return windowManager.getWindowRecord(window.id)
}

function buildBundleFactory(
  apiClient: CheckpointApiClient,
  bundleStore: HttpCheckpointBundleStore
): CheckpointBundleFactory {
  return async ({ options, bundleId, createdAt, agentCheckpointId }) => {
    const instances = await resolveInstances(options, apiClient)
    const instanceRestorePoints = [] as CheckpointBundle['instances']

    // Find the previous bundle for this thread to determine the delta interval
    const existingBundles = await bundleStore.listBundles(
      options.sessionId,
      options.threadId,
      options.projectId
    )
    const previousBundle = existingBundles.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0]

    for (const instanceId of instances) {
      const instance = await apiClient.getInstance(instanceId)
      if (!instance) continue

      const instanceType = instance.type === 'canvas' ? 'graph-canvas' : 'document'
      const logEntries = await apiClient.getWorkspaceLogs(instanceId)
      const lastEntry = logEntries[logEntries.length - 1]
      const snapshotCursor = {
        seq: lastEntry?.cursor.seq ?? 0,
        at: lastEntry?.cursor.at
      }

      // Identify Agent-authored sequences since the previous checkpoint
      const prevInstance = previousBundle?.instances.find((i) => i.instanceId === instanceId)
      const startSeq = prevInstance?.targetCursor.seq ?? 0
      const agentSeqs = logEntries
        .filter((entry) => entry.source === 'agent' && entry.cursor.seq > startSeq)
        .map((entry) => entry.cursor.seq)

      const snapshot = await apiClient.createWorkspaceSnapshot({
        instanceId,
        instanceType,
        projectId: instance.projectId ?? options.projectId,
        snapshot:
          instanceType === 'graph-canvas'
            ? canonicalizeGraphCanvasDTO(instance.content)
            : instance.content,
        snapshotCursor
      })

      instanceRestorePoints.push({
        instanceId,
        instanceType,
        projectId: instance.projectId ?? options.projectId,
        snapshotId: snapshot.id,
        targetCursor: snapshotCursor,
        agentSeqs
      })
    }

    const chatSession = await apiClient.getChatSession(options.threadId)
    const lastMessage = chatSession?.messages?.[chatSession.messages.length - 1]
    const blockIndex = Array.isArray(lastMessage?.blocks)
      ? lastMessage?.blocks.length - 1
      : undefined
    const revision = await apiClient.createFileRevision('checkpoint')

    return {
      id: bundleId,
      createdAt,
      sessionId: options.sessionId,
      threadId: options.threadId,
      projectId: options.projectId,
      agentCheckpointId,
      chat: {
        messageId: lastMessage?.id ?? CHECKPOINT_START_SENTINEL,
        ...(blockIndex !== undefined && blockIndex >= 0 ? { blockIndex } : {})
      },
      instances: instanceRestorePoints,
      fileRevisionId: revision.id,
      label: options.label ?? (lastMessage ? TURN_CHECKPOINT_LABEL : INITIAL_CHECKPOINT_LABEL),
      reason: options.reason ?? 'auto'
    }
  }
}

async function resolveInstances(
  options: Pick<
    CheckpointCreateRequest,
    'includeInstances' | 'activeInstanceId' | 'openInstanceIds'
  >,
  apiClient: CheckpointApiClient
): Promise<string[]> {
  const { includeInstances, activeInstanceId, openInstanceIds } = options
  if (Array.isArray(includeInstances)) {
    return includeInstances
  }

  if (includeInstances === 'active') {
    if (!activeInstanceId) {
      throw new StorageError(
        StorageErrorCode.STORAGE_VALIDATION_FAILED,
        'Active instance id is required for includeInstances=active'
      )
    }
    return [activeInstanceId]
  }

  if (includeInstances === 'open') {
    if (!openInstanceIds || openInstanceIds.length === 0) {
      throw new StorageError(
        StorageErrorCode.STORAGE_VALIDATION_FAILED,
        'Open instance ids are required for includeInstances=open'
      )
    }
    return openInstanceIds
  }

  const instances = await apiClient.listInstances()
  return instances.map((instance) => instance.id)
}

export function registerCheckpointHandlers(persistenceManager: PersistenceManager) {
  ipcMain.handle(
    Channels.CHECKPOINT_CREATE,
    async (event, request: CheckpointCreateRequest): Promise<CheckpointCreateResponse> => {
      try {
        const record = resolveWindowRecord(event.sender)
        if (!record) {
          throw new StorageError(
            StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
            'No active window session found for checkpoint creation.'
          )
        }

        event.sender.send(Channels.CHECKPOINT_QUIESCE)
        try {
          await record.wsHandle.flush()

          const apiClient = new CheckpointApiClient(record.fsPort)
          const bundleStore = new HttpCheckpointBundleStore(record.fsPort)
          const bundleFactory = buildBundleFactory(apiClient, bundleStore)
          const orchestrator = new CheckpointOrchestratorImpl({
            apiPort: record.fsPort,
            persistenceManager,
            bundleStore,
            bundleFactory,
            apiClient
          })

          const bundle = await orchestrator.createCheckpointBundle({
            sessionId: request.threadId,
            threadId: request.threadId,
            projectId: request.projectId,
            includeInstances: request.includeInstances,
            activeInstanceId: request.activeInstanceId,
            openInstanceIds: request.openInstanceIds,
            label: request.label,
            reason: request.reason
          })

          return { bundle }
        } finally {
          event.sender.send(Channels.CHECKPOINT_RESUME)
        }
      } catch (err: unknown) {
        const cause = err instanceof Error ? err : new Error(String(err))
        console.error(
          `[checkpointsHandler] Failed to create checkpoint bundle for thread '${request.threadId}':`,
          cause
        )
        if (isStorageError(err)) {
          throw err
        }
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          `Failed to create checkpoint bundle: ${cause.message}`,
          { threadId: request.threadId, projectId: request.projectId, cause }
        )
      }
    }
  )

  ipcMain.handle(
    Channels.CHECKPOINT_LIST,
    async (event, request: CheckpointListRequest): Promise<CheckpointListResponse> => {
      try {
        const record = resolveWindowRecord(event.sender)
        if (!record) {
          throw new StorageError(
            StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
            'No active window session found for checkpoint listing.'
          )
        }

        const apiClient = new CheckpointApiClient(record.fsPort)
        const bundleStore = new HttpCheckpointBundleStore(record.fsPort)
        const bundleFactory = buildBundleFactory(apiClient, bundleStore)
        const orchestrator = new CheckpointOrchestratorImpl({
          apiPort: record.fsPort,
          persistenceManager,
          bundleStore,
          bundleFactory,
          apiClient
        })

        const bundles = await orchestrator.listCheckpointBundles(
          request.threadId,
          request.threadId,
          request.projectId
        )
        return { bundles }
      } catch (err: unknown) {
        const cause = err instanceof Error ? err : new Error(String(err))
        console.error(
          `[checkpointsHandler] Failed to list checkpoint bundles for thread '${request.threadId}':`,
          cause
        )
        if (isStorageError(err)) {
          throw err
        }
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          `Failed to list checkpoint bundles: ${cause.message}`,
          { threadId: request.threadId, projectId: request.projectId, cause }
        )
      }
    }
  )

  ipcMain.handle(
    Channels.CHECKPOINT_RESTORE,
    async (event, request: CheckpointRestoreRequest): Promise<CheckpointRestoreResponse> => {
      try {
        const record = resolveWindowRecord(event.sender)
        if (!record) {
          throw new StorageError(
            StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
            'No active window session found for checkpoint restore.'
          )
        }

        event.sender.send(Channels.CHECKPOINT_QUIESCE)
        try {
          await record.wsHandle.flush()

          const apiClient = new CheckpointApiClient(record.fsPort)
          const bundleStore = new HttpCheckpointBundleStore(record.fsPort)
          const bundleFactory = buildBundleFactory(apiClient, bundleStore)
          const orchestrator = new CheckpointOrchestratorImpl({
            apiPort: record.fsPort,
            persistenceManager,
            bundleStore,
            bundleFactory,
            apiClient
          })

          await orchestrator.restoreCheckpointBundle({
            sessionId: request.threadId,
            threadId: request.threadId,
            bundleId: request.bundleId,
            createAutoCheckpoint: request.createAutoCheckpoint,
            reason: request.reason,
            projectId: request.projectId
          })

          return { restored: true }
        } finally {
          event.sender.send(Channels.CHECKPOINT_RESUME)
        }
      } catch (err: unknown) {
        const cause = err instanceof Error ? err : new Error(String(err))
        console.error(
          `[checkpointsHandler] Failed to restore checkpoint bundle '${request.bundleId}' for thread '${request.threadId}':`,
          cause
        )
        if (isStorageError(err)) {
          throw err
        }
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          `Failed to restore checkpoint bundle: ${cause.message}`,
          { threadId: request.threadId, bundleId: request.bundleId, cause }
        )
      }
    }
  )

  ipcMain.handle(Channels.CHECKPOINT_CANCEL, async (): Promise<CheckpointCancelResponse> => {
    return { canceled: true }
  })
}
