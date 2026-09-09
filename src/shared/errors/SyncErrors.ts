import { CollarError, type CollarErrorOptions } from './CollarError'

/**
 * Centralized error codes for the Synchronization and Drain Subsystem.
 * Must follow the SYNC_ prefix taxonomy per Coding Rule 6.1.
 */
export const enum SyncErrorCode {
  /** The operation was aborted via AbortSignal */
  SYNC_DRAIN_ABORTED = 'SYNC_DRAIN_ABORTED',

  /** Persistence write to Express API or disk failed after retries */
  SYNC_DRAIN_PERSIST_FAILED = 'SYNC_DRAIN_PERSIST_FAILED',

  /** Transactional flush barrier timed out awaiting consistency */
  SYNC_DRAIN_BARRIER_TIMEOUT = 'SYNC_DRAIN_BARRIER_TIMEOUT',

  /** The drain queue or instance worker was already disposed */
  SYNC_DRAIN_QUEUE_DISPOSED = 'SYNC_DRAIN_QUEUE_DISPOSED',

  /** The payload schema failed validation prior to dispatch */
  SYNC_DRAIN_PAYLOAD_INVALID = 'SYNC_DRAIN_PAYLOAD_INVALID',

  /** Instance worker reached unrecoverable faulted state */
  SYNC_DRAIN_WORKER_FAULTED = 'SYNC_DRAIN_WORKER_FAULTED'
}

export interface SyncErrorParams {
  code: SyncErrorCode
  message: string
  recoverable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

export interface SyncErrorOptions extends CollarErrorOptions {
  details?: Record<string, unknown>
  recoverable?: boolean
  cause?: Error
}

/**
 * Structured diagnostic error for Synchronization and Drain failures.
 * Preserves upstream causes per Coding Rule 6.2.
 */
export class SyncError extends CollarError {
  public override readonly code: SyncErrorCode
  public override readonly subsystem = 'SYNC' as const
  public override readonly recoverable: boolean
  public override readonly details?: Readonly<Record<string, unknown>>

  constructor(params: SyncErrorParams)
  constructor(code: SyncErrorCode, message: string, options?: SyncErrorOptions)
  constructor(
    paramsOrCode: SyncErrorParams | SyncErrorCode,
    maybeMessage?: string,
    maybeOptions?: SyncErrorOptions
  ) {
    let code: SyncErrorCode
    let message: string
    let recoverable = false
    let details: Record<string, unknown> | undefined
    let cause: Error | undefined

    if (typeof paramsOrCode === 'object' && paramsOrCode !== null) {
      code = paramsOrCode.code
      message = paramsOrCode.message
      recoverable = paramsOrCode.recoverable ?? false
      details = paramsOrCode.details
      if (paramsOrCode.cause instanceof Error) {
        cause = paramsOrCode.cause
      } else if (paramsOrCode.cause !== undefined && paramsOrCode.cause !== null) {
        cause = new Error(String(paramsOrCode.cause))
      }
    } else {
      code = paramsOrCode
      message = maybeMessage ?? ''
      recoverable = maybeOptions?.recoverable ?? false
      details = maybeOptions?.details
      cause = maybeOptions?.cause
    }

    super(message, { details, recoverable, cause })
    this.name = 'SyncError'
    this.code = code
    this.recoverable = recoverable
    this.details = details ? Object.freeze({ ...details }) : undefined
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Type guard to check if an unknown error is a structured SyncError.
 */
export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError && error.subsystem === 'SYNC'
}
