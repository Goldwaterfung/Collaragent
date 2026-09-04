import { CollarError, type CollarErrorOptions } from '@shared/errors/CollarError'

export { CollarError, type CollarErrorOptions }

/**
 * Centralized, typed const enum error codes scoped by STORAGE_ subsystem prefix.
 */
export const enum StorageErrorCode {
  STORAGE_CONNECTION_FAILED = 'STORAGE_CONNECTION_FAILED',
  STORAGE_LOCK_CONFLICT = 'STORAGE_LOCK_CONFLICT',
  STORAGE_LOCK_ACQUISITION_FAILED = 'STORAGE_LOCK_ACQUISITION_FAILED',
  STORAGE_MIGRATION_FAILED = 'STORAGE_MIGRATION_FAILED',
  STORAGE_INTEGRITY_CHECK_FAILED = 'STORAGE_INTEGRITY_CHECK_FAILED',
  STORAGE_FOREIGN_KEY_VIOLATION = 'STORAGE_FOREIGN_KEY_VIOLATION',
  STORAGE_CHECKPOINT_NOT_FOUND = 'STORAGE_CHECKPOINT_NOT_FOUND',
  STORAGE_INSTANCE_NOT_FOUND = 'STORAGE_INSTANCE_NOT_FOUND',
  STORAGE_SESSION_NOT_FOUND = 'STORAGE_SESSION_NOT_FOUND',
  STORAGE_BLOB_NOT_FOUND = 'STORAGE_BLOB_NOT_FOUND',
  STORAGE_CORRUPT_DATABASE = 'STORAGE_CORRUPT_DATABASE',
  STORAGE_TRANSACTION_FAILED = 'STORAGE_TRANSACTION_FAILED',
  STORAGE_VACUUM_FAILED = 'STORAGE_VACUUM_FAILED',
  STORAGE_VALIDATION_FAILED = 'STORAGE_VALIDATION_FAILED'
}

export interface StorageErrorOptions {
  details?: unknown
  recoverable?: boolean
  cause?: Error
}

/**
 * Structured domain error for the SQLite storage engine and persistence operations.
 * Preserves upstream causes and provides deterministic wire-safe translation.
 */
export class StorageError extends CollarError {
  public override readonly code: StorageErrorCode
  public override readonly subsystem = 'STORAGE' as const

  constructor(code: StorageErrorCode, message: string, options?: StorageErrorOptions)
  constructor(code: StorageErrorCode, message: string, details?: unknown, cause?: Error)
  constructor(
    code: StorageErrorCode,
    message: string,
    optionsOrDetails?: StorageErrorOptions | unknown,
    maybeCause?: Error
  ) {
    let resolvedOptions: StorageErrorOptions | undefined

    if (maybeCause !== undefined) {
      resolvedOptions = {
        details: optionsOrDetails,
        cause: maybeCause
      }
    } else if (
      optionsOrDetails !== null &&
      typeof optionsOrDetails === 'object' &&
      ('details' in optionsOrDetails ||
        'recoverable' in optionsOrDetails ||
        'cause' in optionsOrDetails)
    ) {
      const opts = optionsOrDetails as StorageErrorOptions & Record<string, unknown>
      const { details, recoverable, cause, ...rest } = opts
      resolvedOptions = {
        details: details !== undefined ? details : Object.keys(rest).length > 0 ? rest : undefined,
        recoverable,
        cause
      }
    } else if (optionsOrDetails !== undefined) {
      resolvedOptions = {
        details: optionsOrDetails
      }
    }

    super(message, resolvedOptions)
    this.code = code
    this.name = 'StorageError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Type guard for StorageError.
 */
export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError
}

/**
 * Standard wire shape conforming to Boundary A specification in spec.md.
 */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    subsystem: 'STORAGE'
    details?: unknown
  }
}

/**
 * Serializes a StorageError into the standardized wire representation.
 */
export function toApiErrorResponse(err: StorageError): ApiErrorResponse {
  return {
    error: {
      code: err.code,
      message: err.message,
      subsystem: 'STORAGE',
      ...(err.details !== undefined ? { details: err.details } : {})
    }
  }
}
