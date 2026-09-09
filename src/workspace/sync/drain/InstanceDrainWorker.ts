import { DRAIN_QUEUE_CONSTANTS } from './constants'
import { SyncError, SyncErrorCode, isSyncError } from './errors'
import { BackoffPolicyEngine } from './BackoffPolicyEngine'
import { TransactionalBarrierRegistry } from './TransactionalBarrierRegistry'
import {
  isDocumentBlocksPayload,
  isGraphCanvasPayload,
  isRelationalLedgerPayload,
  type DrainLifecycleEvent,
  type DrainTrigger,
  type DrainWorkerState,
  type FlushOptions,
  type IBackoffPolicyEngine,
  type IInstanceDrainWorker,
  type ITransactionalBarrierRegistry,
  type InstancePayload,
  type InstancePersistenceAdapter
} from './types'

export interface InstanceDrainWorkerOptions {
  readonly instanceId: string
  readonly persistenceAdapter: InstancePersistenceAdapter
  readonly backoffEngine?: IBackoffPolicyEngine
  readonly emitEvent?: (event: DrainLifecycleEvent) => void
}

/**
 * Finite State Machine for an individual instance's serialized persistence writes.
 * Enforces Concurrency = 1, in-memory keystroke coalescing, and non-blocking exponential backoff.
 * Complies with Coding Rule 2.1, Rule 4.1, and Rule 6.1/6.2.
 */
export class InstanceDrainWorker implements IInstanceDrainWorker {
  public readonly instanceId: string
  private _state: DrainWorkerState = 'IDLE'
  private _isDirty = false

  private pendingPayload: InstancePayload | null = null
  private pendingProjectId?: string
  private currentCycleId: string | null = null
  private retryCount: number = DRAIN_QUEUE_CONSTANTS.INITIAL_RETRY_COUNT
  private retryTimerHandle: ReturnType<typeof setTimeout> | null = null

  private readonly persistenceAdapter: InstancePersistenceAdapter
  private readonly backoffEngine: IBackoffPolicyEngine
  private readonly barrierRegistry: ITransactionalBarrierRegistry
  private readonly emitEvent: (event: DrainLifecycleEvent) => void

  constructor(options: InstanceDrainWorkerOptions) {
    this.instanceId = options.instanceId
    this.persistenceAdapter = options.persistenceAdapter
    this.backoffEngine = options.backoffEngine ?? new BackoffPolicyEngine()
    this.emitEvent = options.emitEvent ?? (() => {})
    this.barrierRegistry = new TransactionalBarrierRegistry()
  }

  public get state(): DrainWorkerState {
    return this._state
  }

  public get isDirty(): boolean {
    return this._isDirty
  }

  /**
   * Dispatches an inbound trigger to the finite state machine.
   */
  public handleTrigger(trigger: DrainTrigger): void {
    if (this._state === 'DISPOSED') {
      return
    }

    if (trigger.type === 'trigger:instance_deleted') {
      void this.dispose()
      return
    }

    if (trigger.type === 'trigger:flush_barrier') {
      void this.flush({ signal: trigger.signal })
      return
    }

    const { payload, projectId } = this.extractPayloadAndProjectId(trigger)
    if (!payload) {
      return
    }

    if (projectId !== undefined) {
      this.pendingProjectId = projectId
    }

    switch (this._state) {
      case 'IDLE': {
        this.pendingPayload = payload
        this._isDirty = false
        this._state = 'DRAINING'
        void this.dispatchWrite()
        break
      }

      case 'DRAINING': {
        this.pendingPayload = payload
        this._isDirty = true
        this._state = 'COALESCING'
        this.emitCoalescedEvent(payload)
        break
      }

      case 'COALESCING': {
        this.pendingPayload = payload
        this._isDirty = true
        this.emitCoalescedEvent(payload)
        break
      }

      case 'RETRYING': {
        this.pendingPayload = payload
        this._isDirty = true
        break
      }

      case 'FAULTED': {
        // New mutation resets the faulted worker and initiates a fresh drain cycle
        this.pendingPayload = payload
        this.retryCount = DRAIN_QUEUE_CONSTANTS.INITIAL_RETRY_COUNT
        this._isDirty = false
        this._state = 'DRAINING'
        void this.dispatchWrite()
        break
      }
    }
  }

  /**
   * Transactional barrier: awaits completion of in-flight and pending coalesced writes.
   */
  public flush(options?: FlushOptions): Promise<void> {
    if (this._state === 'DISPOSED') {
      return Promise.reject(
        new SyncError({
          code: SyncErrorCode.SYNC_DRAIN_QUEUE_DISPOSED,
          message: `Instance drain worker for "${this.instanceId}" is disposed`,
          details: { instanceId: this.instanceId }
        })
      )
    }

    if (this._state === 'FAULTED') {
      return Promise.reject(
        new SyncError({
          code: SyncErrorCode.SYNC_DRAIN_WORKER_FAULTED,
          message: `Instance drain worker for "${this.instanceId}" is in FAULTED state`,
          details: { instanceId: this.instanceId }
        })
      )
    }

    if (this._state === 'IDLE' && !this._isDirty) {
      if (options?.signal?.aborted) {
        return Promise.reject(
          new SyncError({
            code: SyncErrorCode.SYNC_DRAIN_ABORTED,
            message: 'Flush barrier aborted by signal',
            cause: options.signal.reason,
            details: { instanceId: this.instanceId }
          })
        )
      }
      return Promise.resolve()
    }

    return this.barrierRegistry.register(options)
  }

  /**
   * Disposes the worker, cancels active retries, and rejects pending barriers.
   */
  public async dispose(): Promise<void> {
    if (this._state === 'DISPOSED') {
      return
    }

    this._state = 'DISPOSED'
    this.clearRetryTimer()
    this.barrierRegistry.dispose()
    this.pendingPayload = null
  }

  private async dispatchWrite(): Promise<void> {
    if (this._state === 'DISPOSED') {
      return
    }

    const payload = this.pendingPayload
    if (!payload) {
      this._state = 'IDLE'
      this.barrierRegistry.resolveAll()
      return
    }

    const cycleId = crypto.randomUUID()
    this.currentCycleId = cycleId
    const startTime = Date.now()

    this.emitEvent({
      type: 'drain:started',
      instanceId: this.instanceId,
      cycleId,
      timestamp: startTime
    })

    try {
      const result = await this.persistenceAdapter.saveInstance({
        instanceId: this.instanceId,
        projectId: this.pendingProjectId,
        payload
      })

      if (this.isWorkerDisposed()) {
        return
      }

      const durationMs = Math.max(0, Date.now() - startTime)
      const bytesWritten = result.bytesWritten ?? DRAIN_QUEUE_CONSTANTS.DEFAULT_BYTES_WRITTEN

      this.retryCount = DRAIN_QUEUE_CONSTANTS.INITIAL_RETRY_COUNT

      this.emitEvent({
        type: 'drain:completed',
        instanceId: this.instanceId,
        cycleId,
        durationMs,
        bytesWritten,
        remainingDirty: this._isDirty,
        timestamp: Date.now()
      })

      if (this._isDirty) {
        // Immediate subsequent drain for coalesced mutations without clock delay
        this._isDirty = false
        this._state = 'DRAINING'
        void this.dispatchWrite()
      } else {
        this._state = 'IDLE'
        this.emitEvent({
          type: 'drain:idle',
          instanceId: this.instanceId,
          timestamp: Date.now()
        })
        this.barrierRegistry.resolveAll()
      }
    } catch (err: unknown) {
      if (this.isWorkerDisposed()) {
        return
      }

      const syncError = isSyncError(err)
        ? err
        : new SyncError({
            code: SyncErrorCode.SYNC_DRAIN_PERSIST_FAILED,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
            details: { instanceId: this.instanceId, cycleId }
          })

      const nextAttempt = this.retryCount + 1

      if (this.backoffEngine.shouldRetry(nextAttempt)) {
        this.retryCount = nextAttempt
        this._state = 'RETRYING'
        const delayMs = this.backoffEngine.calculateDelay(nextAttempt)

        this.emitEvent({
          type: 'drain:failed',
          instanceId: this.instanceId,
          cycleId,
          error: syncError,
          retryCount: this.retryCount,
          willRetry: true,
          timestamp: Date.now()
        })

        this.emitEvent({
          type: 'drain:retrying',
          instanceId: this.instanceId,
          cycleId,
          attempt: this.retryCount,
          delayMs,
          timestamp: Date.now()
        })

        this.clearRetryTimer()

        if (delayMs <= 0) {
          queueMicrotask(() => {
            if (this._state === 'RETRYING') {
              this._state = 'DRAINING'
              void this.dispatchWrite()
            }
          })
        } else {
          this.retryTimerHandle = setTimeout(() => {
            this.retryTimerHandle = null
            if (this._state === 'RETRYING') {
              this._state = 'DRAINING'
              void this.dispatchWrite()
            }
          }, delayMs)
        }
      } else {
        this._state = 'FAULTED'

        this.emitEvent({
          type: 'drain:failed',
          instanceId: this.instanceId,
          cycleId,
          error: syncError,
          retryCount: this.retryCount,
          willRetry: false,
          timestamp: Date.now()
        })

        this.barrierRegistry.rejectAll(syncError)
      }
    }
  }

  private extractPayloadAndProjectId(trigger: DrainTrigger): {
    payload: InstancePayload | null
    projectId?: string
  } {
    switch (trigger.type) {
      case 'trigger:document_edit':
        return { payload: trigger.payload, projectId: trigger.projectId }

      case 'trigger:canvas_snapshot':
        return { payload: trigger.payload, projectId: trigger.projectId }

      case 'trigger:canvas_command':
        if (this.pendingPayload && isGraphCanvasPayload(this.pendingPayload)) {
          return { payload: this.pendingPayload, projectId: trigger.projectId }
        }
        return {
          payload: {
            schemaVersion: 1 as const,
            type: 'graph-canvas' as const,
            graph: { nodes: {}, relationships: {} },
            layout: { layoutByNodeId: {} }
          },
          projectId: trigger.projectId
        }

      case 'trigger:claim_sync':
        return {
          payload: { edges: trigger.claims }
        }

      case 'trigger:ledger_mutation':
        return {
          payload: { edges: trigger.serializedEdges },
          projectId: trigger.projectId
        }

      case 'trigger:instance_deleted':
      case 'trigger:flush_barrier':
        return { payload: null }
    }
  }

  private emitCoalescedEvent(payload: InstancePayload): void {
    const cycleId = this.currentCycleId ?? crypto.randomUUID()
    this.emitEvent({
      type: 'drain:coalesced',
      instanceId: this.instanceId,
      cycleId,
      pendingPayloadSize: this.calculatePayloadSize(payload),
      timestamp: Date.now()
    })
  }

  private calculatePayloadSize(payload: InstancePayload): number {
    if (isDocumentBlocksPayload(payload)) {
      return payload.blocks.length
    }
    if (isGraphCanvasPayload(payload)) {
      return Object.keys(payload.graph.nodes).length
    }
    if (isRelationalLedgerPayload(payload)) {
      return payload.edges.length
    }
    return 0
  }

  private clearRetryTimer(): void {
    if (this.retryTimerHandle !== null) {
      clearTimeout(this.retryTimerHandle)
      this.retryTimerHandle = null
    }
  }

  private isWorkerDisposed(): boolean {
    return (this._state as DrainWorkerState) === 'DISPOSED'
  }
}
