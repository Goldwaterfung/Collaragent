import { BackoffPolicyEngine } from './BackoffPolicyEngine'
import { SyncError, SyncErrorCode } from './errors'
import { InstanceDrainWorker } from './InstanceDrainWorker'
import type {
  DrainLifecycleEvent,
  DrainTrigger,
  DrainWorkerState,
  FlushOptions,
  ISerializedDrainQueue,
  SerializedDrainQueueOptions
} from './types'

/**
 * Gateway coordinator for event-driven serialized persistence writes across all instances.
 * Complies with Coding Rule 2.1, Rule 4.1, and Rule 6.1/6.2.
 */
export class SerializedDrainQueue implements ISerializedDrainQueue {
  private readonly workers = new Map<string, InstanceDrainWorker>()
  private readonly listeners = new Set<(event: DrainLifecycleEvent) => void>()
  private isDisposed = false

  constructor(private readonly options: SerializedDrainQueueOptions) {}

  /**
   * Enqueues an inbound trigger.
   * If the instance is IDLE, persistence starts immediately.
   * If the instance is DRAINING, the mutation is coalesced into the in-memory buffer.
   */
  public enqueue(trigger: DrainTrigger): void {
    if (this.isDisposed) {
      throw new SyncError({
        code: SyncErrorCode.SYNC_DRAIN_QUEUE_DISPOSED,
        message: 'Cannot enqueue trigger: SerializedDrainQueue is already disposed',
        details: { instanceId: trigger.instanceId, triggerType: trigger.type }
      })
    }

    if (trigger.type === 'trigger:instance_deleted') {
      this.evict(trigger.instanceId)
      return
    }

    let worker = this.workers.get(trigger.instanceId)
    if (!worker) {
      const backoffEngine = new BackoffPolicyEngine(
        {
          maxRetries: this.options.maxRetries,
          baseBackoffMs: this.options.baseBackoffMs,
          maxBackoffMs: this.options.maxBackoffMs
        },
        this.options.randomGenerator
      )

      worker = new InstanceDrainWorker({
        instanceId: trigger.instanceId,
        persistenceAdapter: this.options.persistenceAdapter,
        backoffEngine,
        emitEvent: this.emitEvent.bind(this)
      })

      this.workers.set(trigger.instanceId, worker)
    }

    worker.handleTrigger(trigger)
  }

  /**
   * Transactional barrier: returns a promise that resolves ONLY when all in-flight
   * and pending coalesced writes for the specified instance have settled to disk.
   * If instanceId is omitted, awaits all active instances across the workspace.
   */
  public async flush(instanceId?: string, options?: FlushOptions): Promise<void> {
    if (this.isDisposed) {
      return Promise.reject(
        new SyncError({
          code: SyncErrorCode.SYNC_DRAIN_QUEUE_DISPOSED,
          message: 'Cannot flush: SerializedDrainQueue is already disposed',
          details: { instanceId }
        })
      )
    }

    if (instanceId !== undefined) {
      const worker = this.workers.get(instanceId)
      if (worker) {
        return worker.flush(options)
      }

      if (options?.signal?.aborted) {
        return Promise.reject(
          new SyncError({
            code: SyncErrorCode.SYNC_DRAIN_ABORTED,
            message: 'Flush barrier aborted by signal',
            cause: options.signal.reason,
            details: { instanceId }
          })
        )
      }

      return Promise.resolve()
    }

    // Global flush across all registered workers
    if (this.workers.size === 0) {
      if (options?.signal?.aborted) {
        return Promise.reject(
          new SyncError({
            code: SyncErrorCode.SYNC_DRAIN_ABORTED,
            message: 'Flush barrier aborted by signal',
            cause: options.signal.reason
          })
        )
      }
      return Promise.resolve()
    }

    const workerFlushes = Array.from(this.workers.values()).map((worker) => worker.flush(options))
    await Promise.all(workerFlushes)
  }

  /**
   * Evicts an instance worker from the queue after closure or deletion.
   */
  public evict(instanceId: string): void {
    const worker = this.workers.get(instanceId)
    if (worker) {
      void worker.dispose()
      this.workers.delete(instanceId)
    }
  }

  /**
   * Returns the current lifecycle state of an instance worker.
   */
  public getState(instanceId: string): DrainWorkerState {
    const worker = this.workers.get(instanceId)
    return worker ? worker.state : 'IDLE'
  }

  /**
   * Returns true if an active worker is currently allocated for the instance.
   */
  public hasWorker(instanceId: string): boolean {
    return this.workers.has(instanceId)
  }

  /**
   * Subscribes to lifecycle events for testing or telemetry.
   */
  public on(listener: (event: DrainLifecycleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Disposes the queue, canceling active retries and rejecting pending barriers.
   */
  public async dispose(): Promise<void> {
    if (this.isDisposed) {
      return
    }

    this.isDisposed = true
    const workerSnapshots = Array.from(this.workers.values())
    this.workers.clear()

    await Promise.all(workerSnapshots.map((worker) => worker.dispose()))
    this.listeners.clear()
  }

  private emitEvent(event: DrainLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Observability listeners must not disrupt core queue execution
      }
    }
  }
}
