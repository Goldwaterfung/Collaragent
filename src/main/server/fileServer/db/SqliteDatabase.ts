/**
 * SqliteDatabase Connection Factory & Forward-Only Migration Runner
 * Conforms to docs/sqlite-storage-architecture/spec.md, storage-engine-design.md,
 * and .agents/rules/coding-rules.md (Zero any, structured errors, cause preservation).
 */

import fs from 'node:fs'
import path from 'node:path'
import Database, { type Database as DatabaseType, type Statement } from 'better-sqlite3'
import {
  SQLITE_ENGINE_CONFIG,
  SQLITE_PRAGMAS,
  type SqliteEngineConfig,
  type WalCheckpointMode,
  WAL_CHECKPOINT_MODES
} from '../config/sqliteConfig'
import { StorageError, StorageErrorCode, isStorageError } from '../errors/StorageErrors'
import { V4_INIT_SQL } from './migrations/v4_init_sql'

export interface SqliteDatabaseOptions {
  config?: SqliteEngineConfig
  migrationsDir?: string
  readonly?: boolean
  autoMigrate?: boolean
}

export class SqliteDatabase {
  private readonly db: DatabaseType
  private readonly config: SqliteEngineConfig
  private readonly migrationsDir: string
  private readonly dbPath: string

  constructor(dbPath: string, options?: SqliteDatabaseOptions) {
    this.dbPath = dbPath
    this.config = options?.config ?? SQLITE_ENGINE_CONFIG
    this.migrationsDir = options?.migrationsDir ?? path.join(__dirname, 'migrations')

    try {
      if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
        const dir = path.dirname(dbPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
      }

      this.db = new Database(dbPath, {
        timeout: this.config.busyTimeoutMs,
        readonly: options?.readonly ?? false
      })
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_CONNECTION_FAILED,
        `Failed to open SQLite database at ${dbPath}`
      )
    }

    this.applyPragmas()

    if (!options?.readonly && (options?.autoMigrate ?? true)) {
      this.migrate()
    }
  }

  private applyPragmas(): void {
    try {
      // auto_vacuum MUST be configured before journal_mode initializes database header
      this.db.pragma(`auto_vacuum = ${SQLITE_PRAGMAS.AUTO_VACUUM_INCREMENTAL}`)
      this.db.pragma(`journal_mode = ${SQLITE_PRAGMAS.JOURNAL_MODE_WAL}`)
      this.db.pragma(`synchronous = ${SQLITE_PRAGMAS.SYNCHRONOUS_NORMAL}`)
      this.db.pragma(`foreign_keys = ${SQLITE_PRAGMAS.FOREIGN_KEYS_ON}`)
      this.db.pragma(`temp_store = ${SQLITE_PRAGMAS.TEMP_STORE_MEMORY}`)
      this.db.pragma(`cache_size = -${this.config.cacheSizeKb}`)
      this.db.pragma(`mmap_size = ${this.config.mmapSizeByte}`)
      this.db.pragma(`busy_timeout = ${this.config.busyTimeoutMs}`)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_CONNECTION_FAILED,
        `Failed to configure SQLite PRAGMAs for ${this.dbPath}`
      )
    }
  }

  public getUserVersion(): number {
    try {
      const version = this.db.pragma('user_version', { simple: true })
      return typeof version === 'number' ? version : Number(version)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_CONNECTION_FAILED,
        'Failed to read user_version PRAGMA'
      )
    }
  }

  public migrate(): void {
    try {
      const currentVersion = this.getUserVersion()
      if (currentVersion >= 4) {
        return
      }

      let ddl: string
      const migrationFile = path.join(this.migrationsDir, '001_v4_init.sql')
      if (fs.existsSync(migrationFile)) {
        ddl = fs.readFileSync(migrationFile, 'utf8')
      } else {
        ddl = V4_INIT_SQL
      }

      this.immediateTransaction(() => {
        this.db.exec(ddl)
      })

      if (!this.foreignKeyCheck()) {
        throw new StorageError(
          StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION,
          'Post-migration foreign key check failed'
        )
      }

      if (!this.integrityCheck()) {
        throw new StorageError(
          StorageErrorCode.STORAGE_INTEGRITY_CHECK_FAILED,
          'Post-migration database integrity check failed'
        )
      }
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_MIGRATION_FAILED,
        'Database migration failed'
      )
    }
  }

  public transaction<T>(fn: () => T): T {
    try {
      const runTx = this.db.transaction(fn)
      return runTx()
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_TRANSACTION_FAILED,
        'Transaction execution failed'
      )
    }
  }

  public immediateTransaction<T>(fn: () => T): T {
    try {
      const runImmediateTx = this.db.transaction(fn).immediate
      return runImmediateTx()
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_TRANSACTION_FAILED,
        'Immediate transaction execution failed'
      )
    }
  }

  public walCheckpoint(mode: WalCheckpointMode = WAL_CHECKPOINT_MODES.PASSIVE): void {
    try {
      this.db.pragma(`wal_checkpoint(${mode})`)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_VACUUM_FAILED,
        `WAL checkpoint (${mode}) failed`
      )
    }
  }

  public incrementalVacuum(pages: number = this.config.incrementalVacuumPages): void {
    try {
      this.db.pragma(`incremental_vacuum(${pages})`)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_VACUUM_FAILED,
        `Incremental vacuum (${pages} pages) failed`
      )
    }
  }

  public integrityCheck(): boolean {
    try {
      const rows = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>
      return rows.length === 1 && rows[0]?.integrity_check === 'ok'
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_INTEGRITY_CHECK_FAILED,
        'Failed to execute integrity_check'
      )
    }
  }

  public foreignKeyCheck(): boolean {
    try {
      const rows = this.db.pragma('foreign_key_check') as unknown[]
      return rows.length === 0
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION,
        'Failed to execute foreign_key_check'
      )
    }
  }

  public close(): void {
    try {
      if (this.db.open) {
        this.db.close()
      }
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_CONNECTION_FAILED,
        'Failed to close database'
      )
    }
  }

  public get isOpen(): boolean {
    return this.db.open
  }

  public get dbInstance(): DatabaseType {
    return this.db
  }

  public prepare(sql: string): Statement {
    try {
      const stmt = this.db.prepare(sql)
      const originalRun = stmt.run.bind(stmt)
      const originalGet = stmt.get.bind(stmt)
      const originalAll = stmt.all.bind(stmt)

      stmt.run = (...params: unknown[]) => {
        try {
          return originalRun(...params)
        } catch (err: unknown) {
          throw this.wrapError(
            err,
            StorageErrorCode.STORAGE_TRANSACTION_FAILED,
            `Failed to execute statement: ${sql}`
          )
        }
      }

      stmt.get = (...params: unknown[]) => {
        try {
          return originalGet(...params)
        } catch (err: unknown) {
          throw this.wrapError(
            err,
            StorageErrorCode.STORAGE_TRANSACTION_FAILED,
            `Failed to query statement: ${sql}`
          )
        }
      }

      stmt.all = (...params: unknown[]) => {
        try {
          return originalAll(...params)
        } catch (err: unknown) {
          throw this.wrapError(
            err,
            StorageErrorCode.STORAGE_TRANSACTION_FAILED,
            `Failed to query statement all: ${sql}`
          )
        }
      }

      return stmt
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_TRANSACTION_FAILED,
        `Failed to prepare statement: ${sql}`
      )
    }
  }

  public exec(sql: string): void {
    try {
      this.db.exec(sql)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_TRANSACTION_FAILED,
        'Failed to execute SQL'
      )
    }
  }

  public pragma(pragmaStr: string, options?: { simple?: boolean }): unknown {
    try {
      return this.db.pragma(pragmaStr, options)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_TRANSACTION_FAILED,
        `Failed to execute PRAGMA ${pragmaStr}`
      )
    }
  }

  private wrapError(
    err: unknown,
    defaultCode: StorageErrorCode,
    contextMessage: string
  ): StorageError {
    if (isStorageError(err)) {
      return err
    }

    const cause = err instanceof Error ? err : new Error(String(err))
    let code = defaultCode

    if ('code' in cause) {
      const sqliteCode = String((cause as { code: unknown }).code)
      if (sqliteCode === 'SQLITE_BUSY' || sqliteCode === 'SQLITE_LOCKED') {
        code = StorageErrorCode.STORAGE_LOCK_CONFLICT
      } else if (sqliteCode === 'SQLITE_CORRUPT' || sqliteCode === 'SQLITE_NOTADB') {
        code = StorageErrorCode.STORAGE_CORRUPT_DATABASE
      } else if (
        sqliteCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        cause.message.includes('FOREIGN KEY')
      ) {
        code = StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION
      }
    } else if (cause.message.includes('FOREIGN KEY constraint failed')) {
      code = StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION
    }

    return new StorageError(
      code,
      `${contextMessage}: ${cause.message}`,
      { cause, originalMessage: cause.message },
      cause
    )
  }
}
