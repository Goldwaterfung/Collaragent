import { SyncError, SyncErrorCode } from './errors'
import type { FlushOptions, ITransactionalBarrierRegistry } from './types'

interface ActiveBarrier {
  readonly barrierId: string
  readonly resolve: () => void
  readonly reject: (error: SyncError) => void
  readonly signal?: AbortSignal
  readonly timeoutHandle?: ReturnType<typeof setTimeout>
}

/**
 * Transactional Barrier Registry for awaiting disk persistence consistency.
 * Conforms to Coding Rule 4.1 (Zero any policy) and Rule 6.1/6.2 (structured SyncError).
 */
export class TransactionalBarrierRegistry implements ITransactionalBarrierRegistry {
  private readonly barriers = new Map<string, ActiveBarrier>()

  public get size(): number {
    return this.barriers.size
  }

  /**
   * Registers a deferred barrier promise that resolves when the drain worker reaches clean IDLE state.
   */
  public register(options?: FlushOptions): Promise<void> {
    if (options?.signal?.aborted) {
      return Promise.reject(
        new SyncError({
          code: SyncErrorCode.SYNC_DRAIN_ABORTED,
          message: 'Flush barrier aborted by signal',
          cause: options.signal.reason,
          details: { abortedEarly: true }
        })
      )
    }

    return new Promise<void>((resolve, reject) => {
      const barrierId = crypto.randomUUID()

      let cleanup = (): void => {}

      const safeResolve = (): void => {
        cleanup()
        this.barriers.delete(barrierId)
        resolve()
      }

      const safeReject = (err: SyncError): void => {
        cleanup()
        this.barriers.delete(barrierId)
        reject(err)
      }

      let abortHandler: (() => void) | undefined
      if (options?.signal) {
        abortHandler = () => {
          safeReject(
            new SyncError({
              code: SyncErrorCode.SYNC_DRAIN_ABORTED,
              message: 'Flush barrier aborted by signal',
              cause: options.signal?.reason,
              details: { barrierId }
            })
          )
        }
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          safeReject(
            new SyncError({
              code: SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT,
              message: `Flush barrier timed out after ${options.timeoutMs}ms`,
              details: { barrierId, timeoutMs: options.timeoutMs }
            })
          )
        }, options.timeoutMs)
      }

      cleanup = () => {
        if (abortHandler && options?.signal) {
          options.signal.removeEventListener('abort', abortHandler)
        }
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle)
        }
      }

      const barrier: ActiveBarrier = {
        barrierId,
        resolve: safeResolve,
        reject: safeReject,
        signal: options?.signal,
        timeoutHandle
      }

      this.barriers.set(barrierId, barrier)
    })
  }

  /**
   * Concurrently resolves all registered barrier promises when worker reaches IDLE with isDirty === false.
   */
  public resolveAll(): void {
    if (this.barriers.size === 0) {
      return
    }

    const snapshot = Array.from(this.barriers.values())
    this.barriers.clear()

    for (const barrier of snapshot) {
      barrier.resolve()
    }
  }

  /**
   * Rejects all registered barrier promises with a structured SyncError.
   */
  public rejectAll(error: SyncError): void {
    if (this.barriers.size === 0) {
      return
    }

    const snapshot = Array.from(this.barriers.values())
    this.barriers.clear()

    for (const barrier of snapshot) {
      barrier.reject(error)
    }
  }

  /**
   * Cleans up all pending barriers on disposal.
   */
  public dispose(): void {
    this.rejectAll(
      new SyncError({
        code: SyncErrorCode.SYNC_DRAIN_QUEUE_DISPOSED,
        message: 'Barrier registry disposed'
      })
    )
  }
}
