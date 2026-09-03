/**
 * Centralized SQLite Engine Configuration & Constraints
 * Conforms to .agents/rules/coding-rules.md Section 2 (No hardcoded constants)
 * and docs/sqlite-storage-architecture/spec.md
 */

export interface SqliteEngineConfig {
  readonly busyTimeoutMs: number
  readonly cacheSizeKb: number
  readonly mmapSizeByte: number
  readonly walAutoCheckpointPages: number
  readonly idleCheckpointDelayMs: number
  readonly incrementalVacuumPages: number
  readonly maxWriteRetentionTurns: number
  readonly largeToolOutputThresholdBytes: number
  readonly defaultPaginationLimit: number
  readonly maxPaginationCeiling: number
}

export const SQLITE_ENGINE_CONFIG: Readonly<SqliteEngineConfig> = {
  busyTimeoutMs: 5000,
  cacheSizeKb: 64000,
  mmapSizeByte: 134217728, // 128 MB memory-mapped I/O
  walAutoCheckpointPages: 1000,
  idleCheckpointDelayMs: 30000, // 30 seconds idle trigger
  incrementalVacuumPages: 500,
  maxWriteRetentionTurns: 3, // Retain last 3 turns of transient task writes
  largeToolOutputThresholdBytes: 81920, // 80 KB (~20k tokens, ADR-006)
  defaultPaginationLimit: 50,
  maxPaginationCeiling: 200
} as const

export type WalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'

export const WAL_CHECKPOINT_MODES = {
  PASSIVE: 'PASSIVE',
  FULL: 'FULL',
  RESTART: 'RESTART',
  TRUNCATE: 'TRUNCATE'
} as const

export const SQLITE_PRAGMAS = {
  JOURNAL_MODE_WAL: 'WAL',
  SYNCHRONOUS_NORMAL: 'NORMAL',
  FOREIGN_KEYS_ON: 'ON',
  TEMP_STORE_MEMORY: 'MEMORY',
  AUTO_VACUUM_INCREMENTAL: 'INCREMENTAL'
} as const

export interface StorageMigrationConfig {
  readonly maxBlobValidationSampleCount: number
  readonly headerMagicBytesLength: number
}

export const STORAGE_MIGRATION_CONFIG: Readonly<StorageMigrationConfig> = {
  maxBlobValidationSampleCount: 5,
  headerMagicBytesLength: 16
} as const

export const SQLITE_MAGIC_HEADER = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00
]) // "SQLite format 3\0"

export const ZIP_MAGIC_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"
