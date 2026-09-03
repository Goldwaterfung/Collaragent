import { describe, it, expect } from 'vitest'
import {
  CollarError,
  StorageError,
  StorageErrorCode,
  isStorageError,
  toApiErrorResponse
} from '../errors/StorageErrors'

describe('StorageErrors Taxonomy & Invariants', () => {
  it('instantiates StorageError with proper inheritance hierarchy', () => {
    const error = new StorageError(
      StorageErrorCode.STORAGE_CONNECTION_FAILED,
      'Failed to connect to database',
      { dbPath: '/test/path.cagent' }
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(CollarError)
    expect(error).toBeInstanceOf(StorageError)
    expect(error.name).toBe('StorageError')
    expect(error.subsystem).toBe('STORAGE')
    expect(error.code).toBe(StorageErrorCode.STORAGE_CONNECTION_FAILED)
    expect(error.message).toBe('Failed to connect to database')
    expect(error.details).toEqual({ dbPath: '/test/path.cagent' })
    expect(error.recoverable).toBe(false)
    expect(error.cause).toBeUndefined()
  })

  it('preserves upstream error cause end-to-end', () => {
    const upstreamCause = new Error('SQLite busy: database is locked')
    const error = new StorageError(
      StorageErrorCode.STORAGE_LOCK_CONFLICT,
      'Database locked by another process',
      { pid: 12345, recoverable: true, cause: upstreamCause }
    )

    expect(error.cause).toBe(upstreamCause)
    expect(error.cause?.message).toBe('SQLite busy: database is locked')
    expect(error.recoverable).toBe(true)
    expect(error.details).toEqual({ pid: 12345 })
  })

  it('supports positional constructor arguments for details and cause', () => {
    const upstreamCause = new Error('Disk I/O failure')
    const error = new StorageError(
      StorageErrorCode.STORAGE_CORRUPT_DATABASE,
      'Database header corrupt',
      { offset: 0 },
      upstreamCause
    )

    expect(error.code).toBe(StorageErrorCode.STORAGE_CORRUPT_DATABASE)
    expect(error.message).toBe('Database header corrupt')
    expect(error.details).toEqual({ offset: 0 })
    expect(error.cause).toBe(upstreamCause)
  })

  it('identifies StorageError instances via isStorageError type guard', () => {
    const storageErr = new StorageError(
      StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
      'Instance not found'
    )
    const standardErr = new Error('Standard error')

    expect(isStorageError(storageErr)).toBe(true)
    expect(isStorageError(standardErr)).toBe(false)
    expect(isStorageError('string error')).toBe(false)
    expect(isStorageError(null)).toBe(false)
    expect(isStorageError(undefined)).toBe(false)
    expect(isStorageError({ code: 'STORAGE_CHECKPOINT_NOT_FOUND' })).toBe(false)
  })

  it('serializes to standardized ApiErrorResponse wire format conforming to Boundary A', () => {
    const errorWithDetails = new StorageError(
      StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION,
      'Foreign key constraint failed',
      { table: 'instances', field: 'project_id' }
    )

    const wireResponse = toApiErrorResponse(errorWithDetails)
    expect(wireResponse).toEqual({
      error: {
        code: 'STORAGE_FOREIGN_KEY_VIOLATION',
        message: 'Foreign key constraint failed',
        subsystem: 'STORAGE',
        details: { table: 'instances', field: 'project_id' }
      }
    })

    const errorWithoutDetails = new StorageError(
      StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
      'Checkpoint not found'
    )

    const wireResponseNoDetails = toApiErrorResponse(errorWithoutDetails)
    expect(wireResponseNoDetails).toEqual({
      error: {
        code: 'STORAGE_CHECKPOINT_NOT_FOUND',
        message: 'Checkpoint not found',
        subsystem: 'STORAGE'
      }
    })
    expect(wireResponseNoDetails.error).not.toHaveProperty('details')
  })

  it('contains all required enum codes', () => {
    const expectedCodes: StorageErrorCode[] = [
      StorageErrorCode.STORAGE_CONNECTION_FAILED,
      StorageErrorCode.STORAGE_LOCK_CONFLICT,
      StorageErrorCode.STORAGE_LOCK_ACQUISITION_FAILED,
      StorageErrorCode.STORAGE_MIGRATION_FAILED,
      StorageErrorCode.STORAGE_INTEGRITY_CHECK_FAILED,
      StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION,
      StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
      StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
      StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
      StorageErrorCode.STORAGE_BLOB_NOT_FOUND,
      StorageErrorCode.STORAGE_CORRUPT_DATABASE,
      StorageErrorCode.STORAGE_TRANSACTION_FAILED,
      StorageErrorCode.STORAGE_VACUUM_FAILED,
      StorageErrorCode.STORAGE_VALIDATION_FAILED
    ]

    for (const code of expectedCodes) {
      expect(typeof code).toBe('string')
      expect(code.startsWith('STORAGE_')).toBe(true)
    }
  })
})
