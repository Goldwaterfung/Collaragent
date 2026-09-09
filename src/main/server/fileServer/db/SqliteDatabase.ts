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
import { V5_CAS_BLOBS_SQL } from './migrations/v5_cas_blobs_sql'
import { V6_CHECKPOINT_ALIGNMENT_SQL } from './migrations/v6_checkpoint_alignment_sql'

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
      if (currentVersion < 4) {
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
      }

      if (this.getUserVersion() < 5) {
        let ddlV5: string
        const migrationFileV5 = path.join(this.migrationsDir, '002_cas_blobs.sql')
        if (fs.existsSync(migrationFileV5)) {
          ddlV5 = fs.readFileSync(migrationFileV5, 'utf8')
        } else {
          ddlV5 = V5_CAS_BLOBS_SQL
        }

        this.immediateTransaction(() => {
          this.db.pragma('foreign_keys = OFF')
          this.db.exec(ddlV5)
          this.db.pragma('foreign_keys = ON')
        })
      }

      if (this.getUserVersion() < 6) {
        let ddlV6: string
        const migrationFileV6 = path.join(this.migrationsDir, '003_checkpoint_alignment.sql')
        if (fs.existsSync(migrationFileV6)) {
          ddlV6 = fs.readFileSync(migrationFileV6, 'utf8')
        } else {
          ddlV6 = V6_CHECKPOINT_ALIGNMENT_SQL
        }

        this.immediateTransaction(() => {
          this.db.exec(ddlV6)
          this.backfillCheckpointBlobs()
        })
      }

      if (this.getUserVersion() < 7) {
        this.immediateTransaction(() => {
          this.db.pragma('foreign_keys = OFF')

          const chatMsgCols = (
            this.db.pragma('table_info(chat_messages)') as Array<{ name: string }>
          ).map((c) => c.name)

          if (!chatMsgCols.includes('parent_message_id')) {
            this.db.exec(
              'ALTER TABLE chat_messages ADD COLUMN parent_message_id TEXT REFERENCES chat_messages(id);'
            )
          }
          if (!chatMsgCols.includes('checkpoint_id')) {
            this.db.exec('ALTER TABLE chat_messages ADD COLUMN checkpoint_id TEXT;')
          }
          if (!chatMsgCols.includes('branch_id')) {
            this.db.exec('ALTER TABLE chat_messages ADD COLUMN branch_id TEXT;')
          }

          const sessionCols = (
            this.db.pragma('table_info(chat_sessions)') as Array<{ name: string }>
          ).map((c) => c.name)

          if (!sessionCols.includes('active_message_id')) {
            this.db.exec(
              'ALTER TABLE chat_sessions ADD COLUMN active_message_id TEXT REFERENCES chat_messages(id);'
            )
          }
          if (!sessionCols.includes('active_checkpoint_id')) {
            this.db.exec('ALTER TABLE chat_sessions ADD COLUMN active_checkpoint_id TEXT;')
          }

          this.db.exec(`
            PRAGMA user_version = 7;
            CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_message_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_checkpoint ON chat_messages(checkpoint_id);
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_active_msg ON chat_sessions(active_message_id);
          `)

          this.db.pragma('foreign_keys = ON')
          this.backfillChatDagLineage()
        })
      }

      // Ensure instances table check constraint includes 'ledger'
      const instancesTableSql = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='instances'")
        .get() as { sql?: string } | undefined
      if (
        instancesTableSql &&
        typeof instancesTableSql.sql === 'string' &&
        !instancesTableSql.sql.includes("'ledger'")
      ) {
        this.immediateTransaction(() => {
          this.db.pragma('foreign_keys = OFF')
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS instances_new (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK(type IN ('document', 'canvas', 'ledger')),
                name TEXT NOT NULL,
                content_msgpack BLOB,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO instances_new SELECT id, project_id, type, name, content_msgpack, metadata_json, created_at, updated_at FROM instances;
            DROP TABLE instances;
            ALTER TABLE instances_new RENAME TO instances;
            CREATE INDEX IF NOT EXISTS idx_instances_project ON instances(project_id);
          `)
          this.db.pragma('foreign_keys = ON')
        })
      }

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

  public getFreelistCount(): number {
    try {
      const count = this.db.pragma('freelist_count', { simple: true })
      return typeof count === 'number' ? count : Number(count)
    } catch (err: unknown) {
      throw this.wrapError(
        err,
        StorageErrorCode.STORAGE_VACUUM_FAILED,
        'Failed to read freelist_count PRAGMA'
      )
    }
  }

  public incrementalVacuum(pages: number = this.config.incrementalVacuumPages): void {
    try {
      if (pages <= 0) {
        this.db.pragma('incremental_vacuum')
      } else {
        this.db.pragma(`incremental_vacuum(${pages})`)
      }
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

  private backfillCheckpointBlobs(): void {
    try {
      const hasTablesRaw = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name IN ('langgraph_checkpoints', 'langgraph_blobs')`
        )
        .get()

      if (
        !hasTablesRaw ||
        typeof hasTablesRaw !== 'object' ||
        typeof (hasTablesRaw as Record<string, unknown>).count !== 'number' ||
        ((hasTablesRaw as Record<string, unknown>).count as number) < 2
      ) {
        return
      }

      const rawRows = this.db
        .prepare(
          `SELECT thread_id, checkpoint_ns, checkpoint_id, checkpoint_json FROM langgraph_checkpoints`
        )
        .all()

      const updateStmt = this.db.prepare(
        `UPDATE langgraph_checkpoints SET checkpoint_json = ? WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
      )

      const blobStmt = this.db.prepare(
        `SELECT type, data_blob, serialized FROM langgraph_blobs WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ? LIMIT 1`
      )

      const blobStmtNoNs = this.db.prepare(
        `SELECT type, data_blob, serialized FROM langgraph_blobs WHERE thread_id = ? AND channel = ? AND version = ? LIMIT 1`
      )

      for (const row of rawRows) {
        if (!row || typeof row !== 'object') continue
        const cpRow = row as Record<string, unknown>
        if (
          typeof cpRow.thread_id !== 'string' ||
          typeof cpRow.checkpoint_ns !== 'string' ||
          typeof cpRow.checkpoint_id !== 'string' ||
          typeof cpRow.checkpoint_json !== 'string'
        ) {
          continue
        }

        let cpObj: Record<string, unknown>
        try {
          const parsed = JSON.parse(cpRow.checkpoint_json) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
          cpObj = parsed as Record<string, unknown>
        } catch {
          continue
        }

        const existingChannelValues = cpObj.channel_values
        if (
          existingChannelValues &&
          typeof existingChannelValues === 'object' &&
          !Array.isArray(existingChannelValues) &&
          Object.keys(existingChannelValues).length > 0
        ) {
          continue
        }

        const channelVersions = cpObj.channel_versions
        if (
          !channelVersions ||
          typeof channelVersions !== 'object' ||
          Array.isArray(channelVersions)
        ) {
          continue
        }

        const channelValues: Record<string, unknown> = {}
        let hasAnyBlob = false

        for (const [channel, version] of Object.entries(
          channelVersions as Record<string, unknown>
        )) {
          const vStr = String(version)
          let blobRow = blobStmt.get(cpRow.thread_id, cpRow.checkpoint_ns, channel, vStr)
          if (!blobRow) {
            blobRow = blobStmtNoNs.get(cpRow.thread_id, channel, vStr)
          }

          if (blobRow && typeof blobRow === 'object') {
            const b = blobRow as Record<string, unknown>
            if (typeof b.type === 'string' && b.data_blob !== null && b.data_blob !== undefined) {
              hasAnyBlob = true
              const buf = Buffer.isBuffer(b.data_blob)
                ? b.data_blob
                : Buffer.from(b.data_blob as Uint8Array)

              channelValues[channel] = {
                type: b.type,
                blob: buf.toString('utf8'),
                serialized: b.serialized === 1
              }
            }
          }
        }

        if (hasAnyBlob) {
          cpObj.channel_values = channelValues
          updateStmt.run(
            JSON.stringify(cpObj),
            cpRow.thread_id,
            cpRow.checkpoint_ns,
            cpRow.checkpoint_id
          )
        }
      }
    } catch (err: unknown) {
      console.warn('[SqliteDatabase] Checkpoint blob backfill skipped or encountered warning:', err)
    }
  }

  public backfillChatDagLineage(): void {
    try {
      const sessions = this.db
        .prepare('SELECT id, active_message_id FROM chat_sessions')
        .all() as Array<{ id: string; active_message_id: string | null }>

      const stmtGetMessages = this.db.prepare(`
        SELECT id, rowid
        FROM chat_messages
        WHERE session_id = ?
        ORDER BY timestamp ASC, rowid ASC
      `)

      const stmtUpdateParent = this.db.prepare(`
        UPDATE chat_messages
        SET parent_message_id = ?
        WHERE id = ? AND parent_message_id IS NULL
      `)

      const stmtUpdateActive = this.db.prepare(`
        UPDATE chat_sessions
        SET active_message_id = ?
        WHERE id = ? AND active_message_id IS NULL
      `)

      for (const session of sessions) {
        const messages = stmtGetMessages.all(session.id) as Array<{ id: string; rowid: number }>
        if (messages.length === 0) continue

        let prevId: string | null = null
        for (const msg of messages) {
          if (prevId !== null) {
            stmtUpdateParent.run(prevId, msg.id)
          }
          prevId = msg.id
        }

        if (!session.active_message_id && prevId !== null) {
          stmtUpdateActive.run(prevId, session.id)
        }
      }
    } catch (err: unknown) {
      console.warn('[SqliteDatabase] Chat DAG lineage backfill warning:', err)
    }
  }
}
