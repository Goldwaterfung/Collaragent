/**
 * SqliteCheckpointStore: Native SQLite Checkpoint Store for LangGraph
 * Conforms to docs/sqlite-storage-architecture/spec.md, storage-engine-design.md,
 * and .agents/rules/coding-rules.md (Zero any, no hardcoded constants, cause preservation).
 */

import crypto from 'node:crypto'
import type { Statement } from 'better-sqlite3'
import { SQLITE_ENGINE_CONFIG } from './config/sqliteConfig'
import { SqliteDatabase } from './db/SqliteDatabase'
import { StorageError, StorageErrorCode } from './errors/StorageErrors'
import type { CheckpointStore } from './CheckpointStore'
import type {
  ICheckpointStore,
  CheckpointRecord,
  CheckpointBlobRecord,
  CheckpointWriteRecord
} from './interfaces/ICheckpointStore'

interface CheckpointRow {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly checkpoint_id: string
  readonly parent_checkpoint_id: string | null
  readonly checkpoint_json: string
  readonly metadata_json: string
  readonly created_at: number
}

interface BlobRow {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly channel: string
  readonly version: string
  readonly type: string
  readonly data_blob: Buffer | null
  readonly serialized: number
}

interface WriteRow {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly checkpoint_id: string
  readonly task_id: string
  readonly idx: number
  readonly channel: string
  readonly type: string
  readonly blob_json: string
}

interface RestoreHeadRow {
  readonly checkpoint_id: string
}

interface LargeToolOutputRow {
  readonly content_blob: Buffer
}

function isCheckpointRow(value: unknown): value is CheckpointRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.thread_id === 'string' &&
    typeof row.checkpoint_ns === 'string' &&
    typeof row.checkpoint_id === 'string' &&
    typeof row.checkpoint_json === 'string' &&
    typeof row.metadata_json === 'string' &&
    typeof row.created_at === 'number'
  )
}

function isCheckpointRowArray(values: unknown[]): values is CheckpointRow[] {
  return values.every(isCheckpointRow)
}

function isBlobRow(value: unknown): value is BlobRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.thread_id === 'string' &&
    typeof row.checkpoint_ns === 'string' &&
    typeof row.channel === 'string' &&
    typeof row.version === 'string' &&
    typeof row.type === 'string' &&
    (row.data_blob === null ||
      Buffer.isBuffer(row.data_blob) ||
      row.data_blob instanceof Uint8Array) &&
    typeof row.serialized === 'number'
  )
}

function isBlobRowArray(values: unknown[]): values is BlobRow[] {
  return values.every(isBlobRow)
}

function isWriteRow(value: unknown): value is WriteRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.thread_id === 'string' &&
    typeof row.checkpoint_ns === 'string' &&
    typeof row.checkpoint_id === 'string' &&
    typeof row.task_id === 'string' &&
    typeof row.idx === 'number' &&
    typeof row.channel === 'string' &&
    typeof row.type === 'string' &&
    typeof row.blob_json === 'string'
  )
}

function isWriteRowArray(values: unknown[]): values is WriteRow[] {
  return values.every(isWriteRow)
}

function isRestoreHeadRow(value: unknown): value is RestoreHeadRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.checkpoint_id === 'string'
}

function isLargeToolOutputRow(value: unknown): value is LargeToolOutputRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return Buffer.isBuffer(row.content_blob) || row.content_blob instanceof Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(jsonStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(jsonStr) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function rowToCheckpointRecord(row: CheckpointRow): CheckpointRecord {
  return {
    thread_id: row.thread_id,
    checkpoint_ns: row.checkpoint_ns,
    checkpoint_id: row.checkpoint_id,
    parent_checkpoint_id: row.parent_checkpoint_id ?? undefined,
    checkpoint: parseJsonRecord(row.checkpoint_json),
    metadata: parseJsonRecord(row.metadata_json),
    created_at: row.created_at
  }
}

function rowToBlobRecord(row: BlobRow): CheckpointBlobRecord {
  let blobValue: unknown = null
  if (row.data_blob !== null && row.data_blob !== undefined) {
    const buf = Buffer.isBuffer(row.data_blob)
      ? row.data_blob
      : Buffer.from(row.data_blob as Uint8Array)

    if (row.type === 'bytes') {
      blobValue = buf
    } else if (row.serialized === 1) {
      blobValue = buf.toString('utf8')
    } else if (row.type === 'json') {
      try {
        blobValue = JSON.parse(buf.toString('utf8'))
      } catch {
        blobValue = buf.toString('utf8')
      }
    } else {
      try {
        blobValue = JSON.parse(buf.toString('utf8'))
      } catch {
        blobValue = buf.toString('utf8')
      }
    }
  }

  return {
    thread_id: row.thread_id,
    checkpoint_ns: row.checkpoint_ns,
    channel: row.channel,
    version: row.version,
    type: row.type,
    blob: blobValue,
    serialized: row.serialized === 1
  }
}

export class SqliteCheckpointStore implements ICheckpointStore, CheckpointStore {
  private readonly db: SqliteDatabase

  // Prepared Statements for Checkpoints
  private readonly stmtGetCheckpointsByThread: Statement
  private readonly stmtGetCheckpointsByThreadAndNs: Statement
  private readonly stmtGetLatestCheckpoint: Statement
  private readonly stmtGetLatestCheckpointByThread: Statement
  private readonly stmtGetCheckpointById: Statement
  private readonly stmtPutCheckpoint: Statement

  // Prepared Statements for Blobs
  private readonly stmtGetBlob: Statement
  private readonly stmtGetBlobNoNs: Statement
  private readonly stmtGetBlobsByThreadAndNs: Statement
  private readonly stmtGetBlobsByThread: Statement
  private readonly stmtPutBlob: Statement
  private readonly stmtDeleteBlob: Statement
  private readonly stmtDeleteBlobNoNs: Statement

  // Prepared Statements for Restore Heads
  private readonly stmtGetRestoreHead: Statement
  private readonly stmtPutRestoreHead: Statement
  private readonly stmtClearRestoreHead: Statement

  // Prepared Statements for Task Writes
  private readonly stmtGetWrites: Statement
  private readonly stmtPutWrite: Statement
  private readonly stmtPruneWrites: Statement

  // Prepared Statements for ADR-006 Large Tool Outputs
  private readonly stmtPutLargeToolOutput: Statement
  private readonly stmtGetLargeToolOutput: Statement
  private readonly stmtCheckChatSessionExists: Statement
  private readonly stmtGetFirstProjectId: Statement
  private readonly stmtCreateDefaultProject: Statement
  private readonly stmtCreateSkeletonChatSession: Statement

  // Prepared Statements for Thread Deletion
  private readonly stmtDeleteThreadWrites: Statement
  private readonly stmtDeleteThreadBlobs: Statement
  private readonly stmtDeleteThreadCheckpoints: Statement
  private readonly stmtDeleteThreadRestoreHeads: Statement

  constructor(db: SqliteDatabase) {
    this.db = db

    // Checkpoints
    this.stmtGetCheckpointsByThread = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at
      FROM langgraph_checkpoints
      WHERE thread_id = ?
      ORDER BY created_at ASC
    `)

    this.stmtGetCheckpointsByThreadAndNs = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at
      FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
      ORDER BY created_at ASC
    `)

    this.stmtGetLatestCheckpoint = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at
      FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)

    this.stmtGetLatestCheckpointByThread = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at
      FROM langgraph_checkpoints
      WHERE thread_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)

    this.stmtGetCheckpointById = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at
      FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      LIMIT 1
    `)

    this.stmtPutCheckpoint = this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_checkpoints
      (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    // Blobs
    this.stmtGetBlob = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, channel, version, type, data_blob, serialized
      FROM langgraph_blobs
      WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ?
      LIMIT 1
    `)

    this.stmtGetBlobNoNs = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, channel, version, type, data_blob, serialized
      FROM langgraph_blobs
      WHERE thread_id = ? AND channel = ? AND version = ?
      LIMIT 1
    `)

    this.stmtGetBlobsByThreadAndNs = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, channel, version, type, data_blob, serialized
      FROM langgraph_blobs
      WHERE thread_id = ? AND checkpoint_ns = ?
    `)

    this.stmtGetBlobsByThread = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, channel, version, type, data_blob, serialized
      FROM langgraph_blobs
      WHERE thread_id = ?
    `)

    this.stmtPutBlob = this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_blobs
      (thread_id, checkpoint_ns, channel, version, type, data_blob, serialized)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmtDeleteBlob = this.db.prepare(`
      DELETE FROM langgraph_blobs
      WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ?
    `)

    this.stmtDeleteBlobNoNs = this.db.prepare(`
      DELETE FROM langgraph_blobs
      WHERE thread_id = ? AND channel = ? AND version = ?
    `)

    // Restore Heads
    this.stmtGetRestoreHead = this.db.prepare(`
      SELECT checkpoint_id
      FROM langgraph_restore_heads
      WHERE thread_id = ? AND checkpoint_ns = ?
      LIMIT 1
    `)

    this.stmtPutRestoreHead = this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_restore_heads
      (thread_id, checkpoint_ns, checkpoint_id, updated_at)
      VALUES (?, ?, ?, ?)
    `)

    this.stmtClearRestoreHead = this.db.prepare(`
      DELETE FROM langgraph_restore_heads
      WHERE thread_id = ? AND checkpoint_ns = ?
    `)

    // Task Writes
    this.stmtGetWrites = this.db.prepare(`
      SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob_json
      FROM langgraph_writes
      WHERE thread_id = ? AND checkpoint_id = ?
      ORDER BY idx ASC
    `)

    this.stmtPutWrite = this.db.prepare(`
      INSERT OR REPLACE INTO langgraph_writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmtPruneWrites = this.db.prepare(`
      DELETE FROM langgraph_writes
      WHERE thread_id = ?
        AND checkpoint_id NOT IN (
          SELECT checkpoint_id
          FROM langgraph_checkpoints
          WHERE thread_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        )
    `)

    // Large Tool Outputs
    this.stmtPutLargeToolOutput = this.db.prepare(`
      INSERT OR REPLACE INTO large_tool_outputs
      (id, session_id, content_blob, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.stmtGetLargeToolOutput = this.db.prepare(`
      SELECT content_blob
      FROM large_tool_outputs
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtCheckChatSessionExists = this.db.prepare(`
      SELECT 1 FROM chat_sessions WHERE id = ? LIMIT 1
    `)

    this.stmtGetFirstProjectId = this.db.prepare(`
      SELECT id FROM projects ORDER BY created_at ASC LIMIT 1
    `)

    this.stmtCreateDefaultProject = this.db.prepare(`
      INSERT INTO projects (id, name, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.stmtCreateSkeletonChatSession = this.db.prepare(`
      INSERT OR IGNORE INTO chat_sessions (id, project_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    // Thread Deletion
    this.stmtDeleteThreadWrites = this.db.prepare(`
      DELETE FROM langgraph_writes WHERE thread_id = ?
    `)

    this.stmtDeleteThreadBlobs = this.db.prepare(`
      DELETE FROM langgraph_blobs WHERE thread_id = ?
    `)

    this.stmtDeleteThreadCheckpoints = this.db.prepare(`
      DELETE FROM langgraph_checkpoints WHERE thread_id = ?
    `)

    this.stmtDeleteThreadRestoreHeads = this.db.prepare(`
      DELETE FROM langgraph_restore_heads WHERE thread_id = ?
    `)
  }

  // ============================================================================
  // 1. CHECKPOINTS
  // ============================================================================

  public async getCheckpoints(
    threadId: string,
    checkpointNs?: string
  ): Promise<CheckpointRecord[]> {
    if (!threadId) return []

    const rows =
      checkpointNs !== undefined
        ? this.stmtGetCheckpointsByThreadAndNs.all(threadId, checkpointNs)
        : this.stmtGetCheckpointsByThread.all(threadId)

    if (!isCheckpointRowArray(rows)) {
      return []
    }

    return rows.map(rowToCheckpointRecord)
  }

  public async getLatestCheckpoint(
    threadId: string,
    checkpointNs?: string
  ): Promise<CheckpointRecord | undefined> {
    if (!threadId) return undefined

    const row =
      checkpointNs !== undefined
        ? this.stmtGetLatestCheckpoint.get(threadId, checkpointNs)
        : this.stmtGetLatestCheckpointByThread.get(threadId)

    if (row && isCheckpointRow(row)) {
      return rowToCheckpointRecord(row)
    }

    return undefined
  }

  public async getCheckpoint(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<CheckpointRecord | undefined> {
    if (!threadId || !checkpointId) return undefined

    const row = this.stmtGetCheckpointById.get(threadId, checkpointNs, checkpointId)
    if (row && isCheckpointRow(row)) {
      return rowToCheckpointRecord(row)
    }

    return undefined
  }

  public async putCheckpoint(record: CheckpointRecord): Promise<void> {
    const createdAt = record.created_at ?? Date.now()
    const checkpointJson = JSON.stringify(record.checkpoint)
    const metadataJson = JSON.stringify(record.metadata)

    this.stmtPutCheckpoint.run(
      record.thread_id,
      record.checkpoint_ns ?? '',
      record.checkpoint_id,
      record.parent_checkpoint_id ?? null,
      checkpointJson,
      metadataJson,
      createdAt
    )
  }

  // ============================================================================
  // 2. CHANNEL VERSION BLOBS
  // ============================================================================

  public async getBlob(
    threadId: string,
    checkpointNs: string,
    channel: string,
    version: string
  ): Promise<CheckpointBlobRecord | undefined>
  public async getBlob(key: string): Promise<CheckpointBlobRecord | undefined>
  public async getBlob(
    threadIdOrKey: string,
    checkpointNs?: string,
    channel?: string,
    version?: string
  ): Promise<CheckpointBlobRecord | undefined> {
    if (checkpointNs !== undefined && channel !== undefined && version !== undefined) {
      const row = this.stmtGetBlob.get(threadIdOrKey, checkpointNs, channel, version)
      if (row && isBlobRow(row)) {
        return rowToBlobRecord(row)
      }
      return undefined
    }

    const parts = threadIdOrKey.split(':')
    if (parts.length === 3) {
      const [threadId, ch, ver] = parts
      const row = this.stmtGetBlobNoNs.get(threadId, ch, ver)
      if (row && isBlobRow(row)) {
        return rowToBlobRecord(row)
      }
      return undefined
    }

    if (parts.length >= 4) {
      const threadId = parts[0]
      const ns = parts[1]
      const ch = parts[2]
      const ver = parts.slice(3).join(':')
      const row = this.stmtGetBlob.get(threadId, ns, ch, ver)
      if (row && isBlobRow(row)) {
        return rowToBlobRecord(row)
      }
      return undefined
    }

    return undefined
  }

  public async getBlobsByPrefix(
    threadId: string,
    checkpointNs: string
  ): Promise<CheckpointBlobRecord[]>
  public async getBlobsByPrefix(prefix: string): Promise<CheckpointBlobRecord[]>
  public async getBlobsByPrefix(
    threadIdOrPrefix: string,
    checkpointNs?: string
  ): Promise<CheckpointBlobRecord[]> {
    if (checkpointNs !== undefined) {
      const rows = this.stmtGetBlobsByThreadAndNs.all(threadIdOrPrefix, checkpointNs)
      if (!isBlobRowArray(rows)) return []
      return rows.map(rowToBlobRecord)
    }

    const prefix = threadIdOrPrefix
    if (prefix.endsWith(':')) {
      const trimmed = prefix.slice(0, -1)
      const parts = trimmed.split(':')
      if (parts.length === 1) {
        const threadId = parts[0]
        const rows = this.stmtGetBlobsByThread.all(threadId)
        if (!isBlobRowArray(rows)) return []
        return rows.map(rowToBlobRecord)
      }
      if (parts.length === 2) {
        const [threadId, ns] = parts
        const rows = this.stmtGetBlobsByThreadAndNs.all(threadId, ns)
        if (!isBlobRowArray(rows)) return []
        return rows.map(rowToBlobRecord)
      }
    }

    const parts = prefix.split(':')
    const threadId = parts[0]
    const rows = this.stmtGetBlobsByThread.all(threadId)
    if (!isBlobRowArray(rows)) return []

    return rows.map(rowToBlobRecord).filter((b) => {
      const k3 = `${b.thread_id}:${b.channel}:${b.version}`
      const k4 = `${b.thread_id}:${b.checkpoint_ns}:${b.channel}:${b.version}`
      return k3.startsWith(prefix) || k4.startsWith(prefix)
    })
  }

  public async putBlob(record: CheckpointBlobRecord): Promise<void>
  public async putBlob(key: string, record: CheckpointBlobRecord): Promise<void>
  public async putBlob(
    keyOrRecord: string | CheckpointBlobRecord,
    maybeRecord?: CheckpointBlobRecord
  ): Promise<void> {
    const record = typeof keyOrRecord === 'string' ? maybeRecord : keyOrRecord
    if (!record) {
      throw new StorageError(
        StorageErrorCode.STORAGE_VALIDATION_FAILED,
        'putBlob requires a valid CheckpointBlobRecord'
      )
    }

    let dataBlob: Buffer | null = null
    if (record.blob !== undefined && record.blob !== null) {
      if (Buffer.isBuffer(record.blob)) {
        dataBlob = record.blob
      } else if (record.blob instanceof Uint8Array) {
        dataBlob = Buffer.from(record.blob.buffer, record.blob.byteOffset, record.blob.byteLength)
      } else if (typeof record.blob === 'string') {
        dataBlob = Buffer.from(record.blob, 'utf8')
      } else {
        dataBlob = Buffer.from(JSON.stringify(record.blob), 'utf8')
      }
    }

    const serializedInt = record.serialized ? 1 : 0

    this.stmtPutBlob.run(
      record.thread_id,
      record.checkpoint_ns ?? '',
      record.channel,
      record.version,
      record.type,
      dataBlob,
      serializedInt
    )
  }

  public async deleteBlobs(keys: string[]): Promise<void> {
    if (keys.length === 0) return

    this.db.immediateTransaction(() => {
      for (const key of keys) {
        const parts = key.split(':')
        if (parts.length === 3) {
          const [threadId, ch, ver] = parts
          this.stmtDeleteBlobNoNs.run(threadId, ch, ver)
        } else if (parts.length >= 4) {
          const threadId = parts[0]
          const ns = parts[1]
          const ch = parts[2]
          const ver = parts.slice(3).join(':')
          this.stmtDeleteBlob.run(threadId, ns, ch, ver)
        }
      }
    })
  }

  // ============================================================================
  // 3. RESTORE HEADS
  // ============================================================================

  public async getRestoreHead(
    threadId: string,
    checkpointNs: string = ''
  ): Promise<string | undefined> {
    if (!threadId) return undefined

    const row = this.stmtGetRestoreHead.get(threadId, checkpointNs)
    if (row && isRestoreHeadRow(row)) {
      return row.checkpoint_id
    }

    return undefined
  }

  public async putRestoreHead(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<void> {
    if (!threadId || !checkpointId) return

    this.stmtPutRestoreHead.run(threadId, checkpointNs ?? '', checkpointId, Date.now())
  }

  public async setRestoreHead(
    threadId: string,
    checkpointId: string,
    checkpointNs: string = ''
  ): Promise<void> {
    await this.putRestoreHead(threadId, checkpointNs, checkpointId)
  }

  public async clearRestoreHead(threadId: string, checkpointNs: string = ''): Promise<void> {
    if (!threadId) return

    this.stmtClearRestoreHead.run(threadId, checkpointNs)
  }

  // ============================================================================
  // 4. TASK WRITES & 3-TURN PRUNING
  // ============================================================================

  public async getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]> {
    if (!threadId || !checkpointId) return []

    const rows = this.stmtGetWrites.all(threadId, checkpointId)
    if (!isWriteRowArray(rows)) return []

    return rows.map((r) => {
      let blob: unknown
      try {
        blob = JSON.parse(r.blob_json)
      } catch {
        blob = r.blob_json
      }

      return {
        thread_id: r.thread_id,
        checkpoint_ns: r.checkpoint_ns,
        checkpoint_id: r.checkpoint_id,
        task_id: r.task_id,
        idx: r.idx,
        channel: r.channel,
        type: r.type,
        blob
      }
    })
  }

  public async putWrites(records: CheckpointWriteRecord[]): Promise<void>
  public async putWrites(threadId: string, writes: CheckpointWriteRecord[]): Promise<void>
  public async putWrites(
    arg1: string | CheckpointWriteRecord[],
    arg2?: CheckpointWriteRecord[]
  ): Promise<void> {
    const writes = typeof arg1 === 'string' ? (arg2 ?? []) : arg1
    if (writes.length === 0) return

    this.db.immediateTransaction(() => {
      for (const w of writes) {
        const blobJson =
          typeof w.blob === 'string' ? JSON.stringify(w.blob) : JSON.stringify(w.blob)
        this.stmtPutWrite.run(
          w.thread_id,
          w.checkpoint_ns ?? '',
          w.checkpoint_id,
          w.task_id,
          w.idx,
          w.channel,
          w.type ?? 'json',
          blobJson
        )
      }
    })
  }

  public async pruneWrites(
    threadId: string,
    keepTurns: number = SQLITE_ENGINE_CONFIG.maxWriteRetentionTurns
  ): Promise<number> {
    if (!threadId) return 0

    const result = this.stmtPruneWrites.run(threadId, threadId, keepTurns)
    return Number(result.changes)
  }

  // ============================================================================
  // 5. ADR-006 LARGE TOOL OUTPUT STORAGE
  // ============================================================================

  public async putLargeToolOutput(id: string, sessionId: string, buffer: Buffer): Promise<void> {
    if (!id || !buffer) {
      throw new StorageError(
        StorageErrorCode.STORAGE_VALIDATION_FAILED,
        'putLargeToolOutput requires valid id and buffer'
      )
    }

    const resolvedSessionId = sessionId && sessionId.length > 0 ? sessionId : null

    if (resolvedSessionId) {
      const exists = this.stmtCheckChatSessionExists.get(resolvedSessionId)
      if (!exists) {
        const projectRow = this.stmtGetFirstProjectId.get()
        let projectId: string
        if (projectRow && isRecord(projectRow) && typeof projectRow.id === 'string') {
          projectId = projectRow.id
        } else {
          projectId = crypto.randomUUID()
          const nowIso = new Date().toISOString()
          this.stmtCreateDefaultProject.run(projectId, 'Default Project', '{}', nowIso, nowIso)
        }
        const now = Date.now()
        this.stmtCreateSkeletonChatSession.run(
          resolvedSessionId,
          projectId,
          `Chat ${resolvedSessionId.slice(0, 8)}`,
          now,
          now
        )
      }
    }

    this.stmtPutLargeToolOutput.run(id, resolvedSessionId, buffer, buffer.length, Date.now())
  }

  public async getLargeToolOutput(id: string): Promise<Buffer | undefined> {
    if (!id) return undefined

    const row = this.stmtGetLargeToolOutput.get(id)
    if (row && isLargeToolOutputRow(row)) {
      return Buffer.isBuffer(row.content_blob)
        ? row.content_blob
        : Buffer.from(row.content_blob as Uint8Array)
    }

    return undefined
  }

  // ============================================================================
  // 6. THREAD DELETION
  // ============================================================================

  public async deleteThread(threadId: string): Promise<void> {
    if (!threadId) return

    this.db.immediateTransaction(() => {
      this.stmtDeleteThreadWrites.run(threadId)
      this.stmtDeleteThreadBlobs.run(threadId)
      this.stmtDeleteThreadCheckpoints.run(threadId)
      this.stmtDeleteThreadRestoreHeads.run(threadId)
    })
  }
}
