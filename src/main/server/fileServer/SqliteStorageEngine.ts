/**
 * SqliteStorageEngine: V4 Embedded SQLite Storage Engine
 * Conforms to docs/sqlite-storage-architecture/spec.md, storage-engine-design.md,
 * and .agents/rules/coding-rules.md (Zero any, no hardcoded constants, cause preservation).
 */

import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import type { Statement } from 'better-sqlite3'
import { pack, unpack } from 'msgpackr'
import type {
  WorkspaceSnapshot,
  WorkspaceCommandLogEntry,
  InstanceType,
  InstanceLogPosition,
  CommandPreviousState,
  CheckpointBundle,
  FileRevision
} from '@shared/checkpoints/types'
import {
  SQLITE_ENGINE_CONFIG,
  type SqliteEngineConfig,
  WAL_CHECKPOINT_MODES
} from './config/sqliteConfig'
import { SqliteDatabase } from './db/SqliteDatabase'
import { StorageError, StorageErrorCode } from './errors/StorageErrors'
import { ProjectLockManager } from './locks/ProjectLockManager'
import type { SqliteCheckpointStore } from './SqliteCheckpointStore'
import type {
  IStorageEngine,
  ProjectRecord,
  InstanceSummary,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChatSessionSummary,
  ChatSessionDetail,
  ChatMessageInput,
  ChatMessageRecord,
  CreateSnapshotInput,
  CommandLogInput
} from './interfaces/IStorageEngine'

export interface SqliteStorageEngineOptions {
  readonly cagentPath?: string
  readonly db?: SqliteDatabase
  readonly lockManager?: ProjectLockManager
  readonly config?: SqliteEngineConfig
  readonly checkpointStore?: SqliteCheckpointStore
}

interface ProjectRow {
  readonly id: string
  readonly name: string
  readonly metadata_json: string
  readonly created_at: number
  readonly updated_at: number
}

interface InstanceMetaRow {
  readonly id: string
  readonly project_id: string
  readonly type: string
  readonly name: string
  readonly metadata_json: string
  readonly created_at: string
  readonly updated_at: string
}

interface InstanceContentRow {
  readonly content_msgpack: Buffer | Uint8Array | null
}

interface ChatSessionRow {
  readonly id: string
  readonly project_id: string
  readonly title: string
  readonly created_at: number
  readonly updated_at: number
}

interface ChatMessageRow {
  readonly id: string
  readonly session_id: string
  readonly role: string
  readonly content: string
  readonly tool_calls_json: string
  readonly blocks_json: string
  readonly actions_json: string
  readonly usage_json: string | null
  readonly metadata_json: string
  readonly timestamp: number
  readonly rowid?: number
}

interface SnapshotRow {
  readonly snapshot_msgpack: Buffer | Uint8Array | null
}

interface CommandLogRow {
  readonly log_id: number
  readonly instance_id: string
  readonly command_id: string
  readonly command_type: string
  readonly payload_json: string
  readonly timestamp: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.metadata_json === 'string' &&
    typeof row.created_at === 'number' &&
    typeof row.updated_at === 'number'
  )
}

function isInstanceMetaRow(value: unknown): value is InstanceMetaRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.project_id === 'string' &&
    typeof row.type === 'string' &&
    typeof row.name === 'string' &&
    typeof row.metadata_json === 'string' &&
    typeof row.created_at === 'string' &&
    typeof row.updated_at === 'string'
  )
}

function isInstanceContentRow(value: unknown): value is InstanceContentRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    row.content_msgpack === null ||
    Buffer.isBuffer(row.content_msgpack) ||
    row.content_msgpack instanceof Uint8Array
  )
}

function isChatSessionRow(value: unknown): value is ChatSessionRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.project_id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.created_at === 'number' &&
    typeof row.updated_at === 'number'
  )
}

function isChatMessageRow(value: unknown): value is ChatMessageRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.session_id === 'string' &&
    typeof row.role === 'string' &&
    typeof row.content === 'string' &&
    typeof row.tool_calls_json === 'string' &&
    typeof row.blocks_json === 'string' &&
    typeof row.actions_json === 'string' &&
    (row.usage_json === null || typeof row.usage_json === 'string') &&
    typeof row.metadata_json === 'string' &&
    typeof row.timestamp === 'number'
  )
}

function isSnapshotRow(value: unknown): value is SnapshotRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    row.snapshot_msgpack === null ||
    Buffer.isBuffer(row.snapshot_msgpack) ||
    row.snapshot_msgpack instanceof Uint8Array
  )
}

function isCommandLogRow(value: unknown): value is CommandLogRow {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.log_id === 'number' &&
    typeof row.instance_id === 'string' &&
    typeof row.command_id === 'string' &&
    typeof row.command_type === 'string' &&
    typeof row.payload_json === 'string' &&
    typeof row.timestamp === 'number'
  )
}

function parseJsonObject(jsonStr: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(jsonStr)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function parseJsonArray(jsonStr: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed
    }
    return []
  } catch {
    return []
  }
}

function toBuffer(val: unknown): Buffer {
  if (Buffer.isBuffer(val)) {
    return val
  }
  if (val instanceof Uint8Array) {
    return Buffer.from(val)
  }
  const packed = pack(val)
  return Buffer.isBuffer(packed) ? packed : Buffer.from(packed)
}

function createDefaultCanvasPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: { nodes: {}, relationships: {} },
    layout: { layoutByNodeId: {} }
  }
}

function createDefaultDocumentPayload(): Record<string, unknown> {
  return {
    blocks: [
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [{ text: '' }]
      }
    ]
  }
}

export class SqliteStorageEngine extends EventEmitter implements IStorageEngine {
  private db: SqliteDatabase | null = null
  private readonly dbPath: string | null
  private readonly config: SqliteEngineConfig
  private readonly lockManager: ProjectLockManager
  private readonly checkpointStore?: SqliteCheckpointStore
  private idleTimer: NodeJS.Timeout | null = null

  // Prepared Statements: Projects
  private stmtGetProjects!: Statement
  private stmtGetProjectById!: Statement
  private stmtCreateProject!: Statement
  private stmtUpdateProject!: Statement
  private stmtDeleteProject!: Statement

  // Prepared Statements: Instances
  private stmtGetInstancesMeta!: Statement
  private stmtGetInstancesMetaByProject!: Statement
  private stmtGetInstanceById!: Statement
  private stmtGetInstanceContent!: Statement
  private stmtCreateInstance!: Statement
  private stmtUpdateInstance!: Statement
  private stmtUpdateInstanceContent!: Statement
  private stmtDeleteInstance!: Statement

  // Prepared Statements: Snapshots
  private stmtCreateSnapshot!: Statement
  private stmtGetSnapshot!: Statement
  private stmtGetWorkspaceSnapshotById!: Statement
  private stmtGetWorkspaceSnapshotContentById!: Statement

  // Prepared Statements: Command Logs
  private stmtAppendCommandLog!: Statement
  private stmtGetCommandLogs!: Statement
  private stmtGetCommandLogsWithLimit!: Statement
  private stmtGetCommandLogsWithBeforeLimit!: Statement

  // Prepared Statements: Chat Sessions
  private stmtGetChatSessionsAll!: Statement
  private stmtGetChatSessionsByProject!: Statement
  private stmtGetChatSessionById!: Statement
  private stmtCreateChatSession!: Statement
  private stmtUpdateChatSessionUpdatedAt!: Statement
  private stmtDeleteChatSession!: Statement

  // Prepared Statements: Chat Messages
  private stmtGetChatMessages!: Statement
  private stmtGetChatMessagesWithLimit!: Statement
  private stmtGetChatMessageById!: Statement
  private stmtAppendChatMessage!: Statement
  private stmtDeleteChatMessagesAfter!: Statement
  private stmtUpdateChatMessageContentAndBlocks!: Statement
  private stmtDeleteAllChatMessagesInSession!: Statement

  // Prepared Statements: File Revisions
  private stmtGetFileRevisions!: Statement
  private stmtGetFileRevisionById!: Statement
  private stmtInsertFileRevision!: Statement

  // Prepared Statements: Thread Lineage Deletion
  private stmtDeleteThreadWrites!: Statement
  private stmtDeleteThreadBlobs!: Statement
  private stmtDeleteThreadCheckpoints!: Statement
  private stmtDeleteThreadRestoreHeads!: Statement

  constructor(dbPathOrDb: string | SqliteDatabase, options?: SqliteStorageEngineOptions) {
    super()
    this.config = options?.config ?? SQLITE_ENGINE_CONFIG
    this.lockManager = options?.lockManager ?? new ProjectLockManager()
    this.checkpointStore = options?.checkpointStore

    if (dbPathOrDb instanceof SqliteDatabase) {
      this.db = dbPathOrDb
      this.dbPath = options?.cagentPath ?? null
      this.initStatements()
    } else {
      this.dbPath = dbPathOrDb
      if (options?.db) {
        this.db = options.db
        this.initStatements()
      }
    }
  }

  public get database(): SqliteDatabase | null {
    return this.db
  }

  public get hasActiveIdleTimer(): boolean {
    return this.idleTimer !== null
  }

  private initStatements(): void {
    if (!this.db) return

    // Projects
    this.stmtGetProjects = this.db.prepare(`
      SELECT id, name, metadata_json, created_at, updated_at
      FROM projects
      ORDER BY created_at ASC
    `)

    this.stmtGetProjectById = this.db.prepare(`
      SELECT id, name, metadata_json, created_at, updated_at
      FROM projects
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtCreateProject = this.db.prepare(`
      INSERT INTO projects (id, name, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.stmtUpdateProject = this.db.prepare(`
      UPDATE projects
      SET name = COALESCE(?, name),
          metadata_json = COALESCE(?, metadata_json),
          updated_at = ?
      WHERE id = ?
    `)

    this.stmtDeleteProject = this.db.prepare(`
      DELETE FROM projects
      WHERE id = ?
    `)

    // Instances
    this.stmtGetInstancesMeta = this.db.prepare(`
      SELECT id, project_id, type, name, metadata_json, created_at, updated_at
      FROM instances
      ORDER BY created_at ASC
    `)

    this.stmtGetInstancesMetaByProject = this.db.prepare(`
      SELECT id, project_id, type, name, metadata_json, created_at, updated_at
      FROM instances
      WHERE project_id = ?
      ORDER BY created_at ASC
    `)

    this.stmtGetInstanceById = this.db.prepare(`
      SELECT id, project_id, type, name, metadata_json, created_at, updated_at
      FROM instances
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtGetInstanceContent = this.db.prepare(`
      SELECT content_msgpack
      FROM instances
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtCreateInstance = this.db.prepare(`
      INSERT INTO instances (id, project_id, type, name, content_msgpack, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmtUpdateInstance = this.db.prepare(`
      UPDATE instances
      SET name = COALESCE(?, name),
          project_id = COALESCE(?, project_id),
          content_msgpack = COALESCE(?, content_msgpack),
          metadata_json = COALESCE(?, metadata_json),
          updated_at = ?
      WHERE id = ?
    `)

    this.stmtUpdateInstanceContent = this.db.prepare(`
      UPDATE instances
      SET content_msgpack = ?,
          updated_at = ?
      WHERE id = ?
    `)

    this.stmtDeleteInstance = this.db.prepare(`
      DELETE FROM instances
      WHERE id = ?
    `)

    // Snapshots
    this.stmtCreateSnapshot = this.db.prepare(`
      INSERT OR IGNORE INTO workspace_snapshots
      (id, instance_id, project_id, instance_type, snapshot_ref, snapshot_hash, snapshot_cursor_json, snapshot_msgpack, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmtGetSnapshot = this.db.prepare(`
      SELECT snapshot_msgpack
      FROM workspace_snapshots
      WHERE snapshot_ref = ?
      LIMIT 1
    `)

    this.stmtGetWorkspaceSnapshotById = this.db.prepare(`
      SELECT id, instance_id, project_id, instance_type, snapshot_ref, snapshot_hash, snapshot_cursor_json, created_at
      FROM workspace_snapshots
      WHERE id = ? OR snapshot_ref = ?
      LIMIT 1
    `)

    this.stmtGetWorkspaceSnapshotContentById = this.db.prepare(`
      SELECT snapshot_msgpack
      FROM workspace_snapshots
      WHERE id = ? OR snapshot_ref = ?
      LIMIT 1
    `)

    // Command Logs
    this.stmtAppendCommandLog = this.db.prepare(`
      INSERT INTO workspace_command_logs
      (instance_id, command_id, command_type, payload_json, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.stmtGetCommandLogs = this.db.prepare(`
      SELECT log_id, instance_id, command_id, command_type, payload_json, timestamp
      FROM workspace_command_logs
      WHERE instance_id = ?
      ORDER BY timestamp ASC, log_id ASC
    `)

    this.stmtGetCommandLogsWithLimit = this.db.prepare(`
      SELECT log_id, instance_id, command_id, command_type, payload_json, timestamp
      FROM workspace_command_logs
      WHERE instance_id = ?
      ORDER BY timestamp ASC, log_id ASC
      LIMIT ?
    `)

    this.stmtGetCommandLogsWithBeforeLimit = this.db.prepare(`
      SELECT log_id, instance_id, command_id, command_type, payload_json, timestamp
      FROM workspace_command_logs
      WHERE instance_id = ? AND log_id < ?
      ORDER BY timestamp ASC, log_id ASC
      LIMIT ?
    `)

    // Chat Sessions
    this.stmtGetChatSessionsAll = this.db.prepare(`
      SELECT id, project_id, title, created_at, updated_at
      FROM chat_sessions
      ORDER BY updated_at DESC, rowid DESC
    `)

    this.stmtGetChatSessionsByProject = this.db.prepare(`
      SELECT id, project_id, title, created_at, updated_at
      FROM chat_sessions
      WHERE project_id = ?
      ORDER BY updated_at DESC, rowid DESC
    `)

    this.stmtGetChatSessionById = this.db.prepare(`
      SELECT id, project_id, title, created_at, updated_at
      FROM chat_sessions
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtCreateChatSession = this.db.prepare(`
      INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.stmtUpdateChatSessionUpdatedAt = this.db.prepare(`
      UPDATE chat_sessions
      SET updated_at = ?
      WHERE id = ?
    `)

    this.stmtDeleteChatSession = this.db.prepare(`
      DELETE FROM chat_sessions
      WHERE id = ?
    `)

    // Chat Messages
    this.stmtGetChatMessages = this.db.prepare(`
      SELECT id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY timestamp ASC, rowid ASC
    `)

    this.stmtGetChatMessagesWithLimit = this.db.prepare(`
      SELECT id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp
      FROM chat_messages
      WHERE session_id = ? AND timestamp < ?
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ?
    `)

    this.stmtGetChatMessageById = this.db.prepare(`
      SELECT id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp, rowid
      FROM chat_messages
      WHERE session_id = ? AND id = ?
      LIMIT 1
    `)

    this.stmtAppendChatMessage = this.db.prepare(`
      INSERT INTO chat_messages
      (id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    this.stmtDeleteChatMessagesAfter = this.db.prepare(`
      DELETE FROM chat_messages
      WHERE session_id = ? AND (timestamp > ? OR (timestamp = ? AND rowid > ?))
    `)

    this.stmtUpdateChatMessageContentAndBlocks = this.db.prepare(`
      UPDATE chat_messages
      SET content = ?, blocks_json = ?
      WHERE id = ?
    `)

    this.stmtDeleteAllChatMessagesInSession = this.db.prepare(`
      DELETE FROM chat_messages
      WHERE session_id = ?
    `)

    // File Revisions
    this.stmtGetFileRevisions = this.db.prepare(`
      SELECT id, name, description, snapshot_ref, created_at
      FROM file_revisions
      ORDER BY created_at DESC
    `)

    this.stmtGetFileRevisionById = this.db.prepare(`
      SELECT id, name, description, snapshot_ref, created_at
      FROM file_revisions
      WHERE id = ?
      LIMIT 1
    `)

    this.stmtInsertFileRevision = this.db.prepare(`
      INSERT INTO file_revisions (id, name, description, snapshot_ref, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    // Thread Lineage Deletion
    this.stmtDeleteThreadWrites = this.db.prepare(`
      DELETE FROM langgraph_writes
      WHERE thread_id = ?
    `)

    this.stmtDeleteThreadBlobs = this.db.prepare(`
      DELETE FROM langgraph_blobs
      WHERE thread_id = ?
    `)

    this.stmtDeleteThreadCheckpoints = this.db.prepare(`
      DELETE FROM langgraph_checkpoints
      WHERE thread_id = ?
    `)

    this.stmtDeleteThreadRestoreHeads = this.db.prepare(`
      DELETE FROM langgraph_restore_heads
      WHERE thread_id = ?
    `)
  }

  private getDb(): SqliteDatabase {
    if (!this.db) {
      if (this.dbPath) {
        this.db = new SqliteDatabase(this.dbPath, { config: this.config })
        this.initStatements()
      } else {
        throw new StorageError(
          StorageErrorCode.STORAGE_CONNECTION_FAILED,
          'SqliteStorageEngine database connection is not open'
        )
      }
    }
    return this.db
  }

  // ============================================================================
  // LIFECYCLE & COMPACTION HOOKS
  // ============================================================================

  public async initialize(): Promise<void> {
    if (this.dbPath && this.dbPath !== ':memory:' && !this.dbPath.startsWith('file::memory:')) {
      await this.lockManager.acquire(this.dbPath)
    }

    if (!this.db) {
      this.db = new SqliteDatabase(this.dbPath ?? ':memory:', { config: this.config })
    }

    this.initStatements()
    this.setupIdleTimer()
  }

  public setupIdleTimer(): void {
    this.clearIdleTimer()
    const delay = this.config.idleCheckpointDelayMs
    if (delay > 0) {
      this.idleTimer = setTimeout(() => {
        this.runIdleCheckpoint()
      }, delay)
      if (this.idleTimer.unref) {
        this.idleTimer.unref()
      }
    }
  }

  public clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  public runIdleCheckpoint(): void {
    if (this.db && this.db.isOpen) {
      try {
        this.db.walCheckpoint(WAL_CHECKPOINT_MODES.PASSIVE)
      } catch {
        // Non-blocking passive checkpoint: suppress background error
      }
    }
    this.setupIdleTimer()
  }

  public async prepareClose(): Promise<void> {
    this.clearIdleTimer()

    if (this.db && this.db.isOpen) {
      this.db.incrementalVacuum(this.config.incrementalVacuumPages)
      this.db.walCheckpoint(WAL_CHECKPOINT_MODES.TRUNCATE)
      this.db.close()
    }

    if (this.dbPath && this.dbPath !== ':memory:' && !this.dbPath.startsWith('file::memory:')) {
      await this.lockManager.release(this.dbPath)
    }
  }

  public async close(): Promise<void> {
    this.clearIdleTimer()

    if (this.db && this.db.isOpen) {
      this.db.close()
    }

    if (this.dbPath && this.dbPath !== ':memory:' && !this.dbPath.startsWith('file::memory:')) {
      await this.lockManager.release(this.dbPath)
    }
  }

  // ============================================================================
  // PROJECTS
  // ============================================================================

  public getProjects(): ProjectRecord[] {
    this.getDb()
    const rawRows = this.stmtGetProjects.all()
    const results: ProjectRecord[] = []

    for (const raw of rawRows) {
      if (isProjectRow(raw)) {
        results.push({
          id: raw.id,
          name: raw.name,
          metadata: parseJsonObject(raw.metadata_json),
          createdAt: raw.created_at,
          updatedAt: raw.updated_at
        })
      }
    }

    return results
  }

  public getProjectById(projectId: string): ProjectRecord | null {
    this.getDb()
    const raw = this.stmtGetProjectById.get(projectId)
    if (!raw || !isProjectRow(raw)) {
      return null
    }
    return {
      id: raw.id,
      name: raw.name,
      metadata: parseJsonObject(raw.metadata_json),
      createdAt: raw.created_at,
      updatedAt: raw.updated_at
    }
  }

  public createProject(name: string, metadata?: Record<string, unknown>): ProjectRecord {
    this.getDb()
    const id = crypto.randomUUID()
    const now = Date.now()
    const meta = metadata ?? {}
    const metadataJson = JSON.stringify(meta)

    this.stmtCreateProject.run(id, name, metadataJson, now, now)
    this.setupIdleTimer()

    return {
      id,
      name,
      metadata: meta,
      createdAt: now,
      updatedAt: now
    }
  }

  public updateProject(
    projectId: string,
    updates: { name?: string; metadata?: Record<string, unknown> }
  ): ProjectRecord | null {
    this.getDb()
    const existing = this.getProjectById(projectId)
    if (!existing) return null

    const name = updates.name ?? existing.name
    const metadata = updates.metadata
      ? { ...existing.metadata, ...updates.metadata }
      : existing.metadata
    const now = Date.now()

    this.stmtUpdateProject.run(name, JSON.stringify(metadata), now, projectId)
    this.setupIdleTimer()

    return {
      id: projectId,
      name,
      metadata,
      createdAt: existing.createdAt,
      updatedAt: now
    }
  }

  public deleteProject(projectId: string): boolean {
    this.getDb()
    const existing = this.getProjectById(projectId)
    if (!existing) return false

    this.stmtDeleteProject.run(projectId)
    this.setupIdleTimer()
    return true
  }

  // ============================================================================
  // INSTANCES (LAZY PAYLOAD ACCESS)
  // ============================================================================

  public getInstancesMeta(projectId?: string): InstanceSummary[] {
    this.getDb()
    const rawRows = projectId
      ? this.stmtGetInstancesMetaByProject.all(projectId)
      : this.stmtGetInstancesMeta.all()

    const summaries: InstanceSummary[] = []

    for (const raw of rawRows) {
      if (isInstanceMetaRow(raw)) {
        summaries.push({
          id: raw.id,
          projectId: raw.project_id,
          type: raw.type === 'canvas' ? 'canvas' : 'document',
          name: raw.name,
          metadata: parseJsonObject(raw.metadata_json),
          createdAt: raw.created_at,
          updatedAt: raw.updated_at
        })
      }
    }

    return summaries
  }

  public getInstanceContent(instanceId: string): Buffer | null {
    this.getDb()
    const raw = this.stmtGetInstanceContent.get(instanceId)
    if (!raw || !isInstanceContentRow(raw)) {
      return null
    }
    if (raw.content_msgpack === null) {
      const meta = this.stmtGetInstanceById.get(instanceId)
      if (meta && isRecord(meta) && typeof meta.type === 'string') {
        const defaultPayload =
          meta.type === 'canvas' || meta.type === 'graph-canvas'
            ? createDefaultCanvasPayload()
            : createDefaultDocumentPayload()
        const buffer = toBuffer(defaultPayload)
        const nowIso = new Date().toISOString()
        this.stmtUpdateInstanceContent.run(buffer, nowIso, instanceId)
        return buffer
      }
      return null
    }
    return toBuffer(raw.content_msgpack)
  }

  public createInstance(type: 'document' | 'canvas', data: CreateInstanceInput): InstanceSummary {
    this.getDb()
    const id = data.id ?? crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const meta = data.metadata ?? {}
    const metadataJson = JSON.stringify(meta)

    const rawPayload = data.payload !== undefined ? data.payload : data.content
    const finalPayload =
      rawPayload !== undefined && rawPayload !== null
        ? rawPayload
        : type === 'canvas'
          ? createDefaultCanvasPayload()
          : createDefaultDocumentPayload()

    const contentBuffer = toBuffer(finalPayload)

    this.stmtCreateInstance.run(
      id,
      data.projectId,
      type,
      data.name,
      contentBuffer,
      metadataJson,
      nowIso,
      nowIso
    )
    this.setupIdleTimer()

    return {
      id,
      projectId: data.projectId,
      type,
      name: data.name,
      metadata: meta,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  }

  public updateInstance(instanceId: string, updates: UpdateInstanceInput): void {
    this.getDb()
    const existing = this.stmtGetInstanceById.get(instanceId)
    if (!existing || !isInstanceMetaRow(existing)) {
      throw new StorageError(
        StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
        `Instance with id '${instanceId}' not found`,
        { instanceId }
      )
    }

    const rawPayload = updates.payload !== undefined ? updates.payload : updates.content
    const contentBuffer =
      rawPayload !== undefined && rawPayload !== null ? toBuffer(rawPayload) : null
    const metadataJson = updates.metadata !== undefined ? JSON.stringify(updates.metadata) : null
    const nowIso = new Date().toISOString()

    this.stmtUpdateInstance.run(
      updates.name ?? null,
      updates.projectId ?? null,
      contentBuffer,
      metadataJson,
      nowIso,
      instanceId
    )
    this.setupIdleTimer()
  }

  public deleteInstance(instanceId: string): void {
    this.getDb()
    this.stmtDeleteInstance.run(instanceId)
    this.setupIdleTimer()
  }

  // ============================================================================
  // WORKSPACE SNAPSHOTS
  // ============================================================================

  private mapRowToWorkspaceSnapshot(raw: Record<string, unknown>): WorkspaceSnapshot {
    const cursor = parseJsonObject(
      typeof raw.snapshot_cursor_json === 'string' ? raw.snapshot_cursor_json : '{}'
    )
    const normalizedCursor: InstanceLogPosition =
      'seq' in cursor && typeof cursor.seq === 'number'
        ? (cursor as unknown as InstanceLogPosition)
        : { seq: 0, at: String(raw.created_at) }

    return {
      id: String(raw.id),
      createdAt: String(raw.created_at),
      instanceId: String(raw.instance_id),
      instanceType:
        raw.instance_type === 'canvas' || raw.instance_type === 'graph-canvas'
          ? 'graph-canvas'
          : 'document',
      projectId: String(raw.project_id),
      snapshotRef: String(raw.snapshot_ref),
      snapshotHash: typeof raw.snapshot_hash === 'string' ? raw.snapshot_hash : undefined,
      snapshotCursor: normalizedCursor
    }
  }

  public createSnapshot(snapshot: CreateSnapshotInput): WorkspaceSnapshot {
    this.getDb()

    // 1. Check if snapshot with snapshotRef already exists (content-addressed idempotency)
    const existingRaw = this.stmtGetWorkspaceSnapshotById.get(
      snapshot.snapshotRef,
      snapshot.snapshotRef
    )
    if (existingRaw && isRecord(existingRaw)) {
      return this.mapRowToWorkspaceSnapshot(existingRaw)
    }

    const id = snapshot.id ?? crypto.randomUUID()
    const createdAt = snapshot.createdAt ?? new Date().toISOString()
    const snapshotBuffer = toBuffer(snapshot.snapshotPayload)
    const cursor = snapshot.snapshotCursor ?? { seq: 0, at: createdAt }
    const cursorJson = JSON.stringify(cursor)

    const result = this.stmtCreateSnapshot.run(
      id,
      snapshot.instanceId,
      snapshot.projectId,
      snapshot.instanceType,
      snapshot.snapshotRef,
      snapshot.snapshotHash,
      cursorJson,
      snapshotBuffer,
      createdAt
    )
    this.setupIdleTimer()

    // Defense-in-depth under concurrent race conditions
    if (result.changes === 0) {
      const racedRaw = this.stmtGetWorkspaceSnapshotById.get(
        snapshot.snapshotRef,
        snapshot.snapshotRef
      )
      if (racedRaw && isRecord(racedRaw)) {
        return this.mapRowToWorkspaceSnapshot(racedRaw)
      }
    }

    const normalizedCursor: InstanceLogPosition =
      typeof cursor === 'object' && cursor !== null && 'seq' in cursor
        ? (cursor as unknown as InstanceLogPosition)
        : { seq: 0, at: createdAt }

    return {
      id,
      createdAt,
      instanceId: snapshot.instanceId,
      instanceType: snapshot.instanceType,
      projectId: snapshot.projectId,
      snapshotRef: snapshot.snapshotRef,
      snapshotHash: snapshot.snapshotHash,
      snapshotCursor: normalizedCursor
    }
  }

  public getSnapshot(snapshotRef: string): Buffer | null {
    this.getDb()
    const raw = this.stmtGetSnapshot.get(snapshotRef)
    if (!raw || !isSnapshotRow(raw)) {
      return null
    }
    if (raw.snapshot_msgpack === null) {
      return null
    }
    return toBuffer(raw.snapshot_msgpack)
  }

  public getWorkspaceSnapshot(id: string): WorkspaceSnapshot | undefined {
    this.getDb()
    const raw = this.stmtGetWorkspaceSnapshotById.get(id, id)
    if (!raw || !isRecord(raw)) return undefined
    return this.mapRowToWorkspaceSnapshot(raw)
  }

  public async loadWorkspaceSnapshot(id: string): Promise<unknown | null> {
    this.getDb()
    const raw = this.stmtGetWorkspaceSnapshotContentById.get(id, id)
    if (!raw || !isSnapshotRow(raw) || raw.snapshot_msgpack === null) return null
    try {
      return unpack(toBuffer(raw.snapshot_msgpack))
    } catch {
      return null
    }
  }

  public async createWorkspaceSnapshot(data: {
    instanceId: string
    instanceType: InstanceType
    projectId: string
    snapshot: unknown
    snapshotCursor?: Record<string, unknown>
  }): Promise<WorkspaceSnapshot> {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const buffer = toBuffer(data.snapshot)
    const snapshotHash = crypto.createHash('sha256').update(buffer).digest('hex')
    const snapshotRef = `${snapshotHash}.msgpack`
    return this.createSnapshot({
      id,
      instanceId: data.instanceId,
      instanceType: data.instanceType,
      projectId: data.projectId,
      snapshotRef,
      snapshotHash,
      snapshotCursor: data.snapshotCursor ?? { seq: 0, at: createdAt },
      snapshotPayload: buffer,
      createdAt
    })
  }

  // ============================================================================
  // WORKSPACE COMMAND LOGS
  // ============================================================================

  public appendCommandLog(instanceId: string, command: CommandLogInput): void {
    this.getDb()
    const timestamp = command.timestamp ?? Date.now()
    const payloadJson = JSON.stringify(command.payload)

    this.stmtAppendCommandLog.run(
      instanceId,
      command.commandId,
      command.commandType,
      payloadJson,
      timestamp
    )
    this.setupIdleTimer()
  }

  public appendWorkspaceLogEntry(entry: WorkspaceCommandLogEntry): void {
    const timestamp = entry.cursor.at ? Date.parse(entry.cursor.at) : Date.now()
    this.appendCommandLog(entry.instanceId, {
      commandId: String(entry.cursor.seq),
      commandType: 'command',
      payload: entry,
      timestamp: isNaN(timestamp) ? Date.now() : timestamp
    })
  }

  public getWorkspaceLogEntries(
    instanceId: string,
    limit?: number,
    before?: number
  ): WorkspaceCommandLogEntry[] {
    return this.getCommandLogs(instanceId, limit, before)
  }

  public getCommandLogs(
    instanceId: string,
    limit?: number,
    before?: number
  ): WorkspaceCommandLogEntry[] {
    this.getDb()
    let rawRows: unknown[]
    if (typeof limit === 'number' && limit > 0 && typeof before === 'number' && before > 0) {
      rawRows = this.stmtGetCommandLogsWithBeforeLimit.all(instanceId, before, limit)
    } else if (typeof limit === 'number' && limit > 0) {
      rawRows = this.stmtGetCommandLogsWithLimit.all(instanceId, limit)
    } else {
      rawRows = this.stmtGetCommandLogs.all(instanceId)
    }

    const instanceRaw = this.stmtGetInstanceById.get(instanceId)
    const instanceMeta = instanceRaw && isInstanceMetaRow(instanceRaw) ? instanceRaw : null
    const defaultInstanceType: InstanceType =
      instanceMeta?.type === 'canvas' ? 'graph-canvas' : 'document'
    const defaultProjectId = instanceMeta?.project_id ?? ''

    const entries: WorkspaceCommandLogEntry[] = []

    for (const raw of rawRows) {
      if (isCommandLogRow(raw)) {
        const payloadObj = parseJsonObject(raw.payload_json)

        const entryInstanceType: InstanceType =
          payloadObj.instanceType === 'graph-canvas' || payloadObj.instanceType === 'document'
            ? (payloadObj.instanceType as InstanceType)
            : defaultInstanceType

        const entryProjectId =
          typeof payloadObj.projectId === 'string' ? payloadObj.projectId : defaultProjectId

        const entryInstanceId =
          typeof payloadObj.instanceId === 'string' ? payloadObj.instanceId : raw.instance_id

        const cursor: InstanceLogPosition =
          payloadObj.cursor && typeof payloadObj.cursor === 'object' && 'seq' in payloadObj.cursor
            ? (payloadObj.cursor as unknown as InstanceLogPosition)
            : { seq: raw.log_id, at: new Date(raw.timestamp).toISOString() }

        const commandData = payloadObj.command !== undefined ? payloadObj.command : payloadObj

        const source =
          payloadObj.source === 'ui' ||
          payloadObj.source === 'agent' ||
          payloadObj.source === 'sync'
            ? payloadObj.source
            : undefined

        entries.push({
          instanceId: entryInstanceId,
          instanceType: entryInstanceType,
          projectId: entryProjectId,
          cursor,
          command: commandData,
          source,
          previousState: payloadObj.previousState as CommandPreviousState | undefined
        })
      }
    }

    return entries
  }

  // ============================================================================
  // CHAT SESSIONS & GRANULAR MESSAGING
  // ============================================================================

  public getChatSessions(projectId?: string): ChatSessionSummary[] {
    this.getDb()
    const rawRows = projectId
      ? this.stmtGetChatSessionsByProject.all(projectId)
      : this.stmtGetChatSessionsAll.all()
    const sessions: ChatSessionSummary[] = []

    for (const raw of rawRows) {
      if (isChatSessionRow(raw)) {
        sessions.push({
          id: raw.id,
          projectId: raw.project_id,
          title: raw.title,
          createdAt: raw.created_at,
          updatedAt: raw.updated_at
        })
      }
    }

    return sessions
  }

  public getChatMessages(
    sessionId: string,
    options?: { limit?: number; before?: string | number }
  ): ChatMessageRecord[] {
    this.getDb()
    const limit = options?.limit ?? SQLITE_ENGINE_CONFIG.defaultPaginationLimit

    let beforeTimestamp = Number.MAX_SAFE_INTEGER
    if (options?.before !== undefined) {
      const num = Number(options.before)
      if (!isNaN(num) && num > 0) {
        beforeTimestamp = num
      } else if (typeof options.before === 'string') {
        const targetMsg = this.stmtGetChatMessageById.get(sessionId, options.before)
        if (targetMsg && isChatMessageRow(targetMsg)) {
          beforeTimestamp = targetMsg.timestamp
        }
      }
    }

    const isPaginated = options?.limit !== undefined || options?.before !== undefined
    const messageRows = isPaginated
      ? this.stmtGetChatMessagesWithLimit.all(sessionId, beforeTimestamp, limit)
      : this.stmtGetChatMessages.all(sessionId)
    const messages: ChatMessageRecord[] = []

    for (const raw of messageRows) {
      if (isChatMessageRow(raw)) {
        const usage = raw.usage_json ? parseJsonObject(raw.usage_json) : undefined
        messages.push({
          id: raw.id,
          sessionId: raw.session_id,
          role: raw.role as 'user' | 'assistant' | 'system',
          content: raw.content,
          toolCalls: parseJsonArray(raw.tool_calls_json),
          blocks: parseJsonArray(raw.blocks_json),
          actions: parseJsonArray(raw.actions_json),
          usage,
          metadata: parseJsonObject(raw.metadata_json),
          timestamp: raw.timestamp
        })
      }
    }

    // Return in chronological order
    return isPaginated ? messages.reverse() : messages
  }

  public getChatSession(sessionId: string): ChatSessionDetail | null {
    this.getDb()
    const sessionRaw = this.stmtGetChatSessionById.get(sessionId)
    if (!sessionRaw || !isChatSessionRow(sessionRaw)) {
      return null
    }

    // Limit recent messages to maxPaginationCeiling for backward compatibility & V8 protection
    const messages = this.getChatMessages(sessionId, {
      limit: SQLITE_ENGINE_CONFIG.maxPaginationCeiling
    })

    return {
      id: sessionRaw.id,
      projectId: sessionRaw.project_id,
      title: sessionRaw.title,
      createdAt: sessionRaw.created_at,
      updatedAt: sessionRaw.updated_at,
      messages
    }
  }

  public truncateChatSession(sessionId: string, messageId: string, blockIndex?: number): boolean {
    const db = this.getDb()
    const target = this.stmtGetChatMessageById.get(sessionId, messageId)
    if (!target || !isChatMessageRow(target)) {
      return false
    }

    const targetRowId = typeof target.rowid === 'number' ? target.rowid : 0

    db.immediateTransaction(() => {
      this.stmtDeleteChatMessagesAfter.run(
        sessionId,
        target.timestamp,
        target.timestamp,
        targetRowId
      )

      if (typeof blockIndex === 'number' && blockIndex >= 0) {
        const blocks = parseJsonArray(target.blocks_json)
        const nextBlocks = blocks.slice(0, blockIndex + 1)
        let nextContent = target.content
        if (nextBlocks.length > 0) {
          const textBlocks = nextBlocks
            .filter((b): b is Record<string, unknown> => isRecord(b) && b.type === 'text')
            .map((b) => (typeof b.content === 'string' ? b.content : ''))
            .join('')
          if (textBlocks.length > 0) {
            nextContent = textBlocks
          }
        }
        this.stmtUpdateChatMessageContentAndBlocks.run(
          nextContent,
          JSON.stringify(nextBlocks),
          messageId
        )
      }

      const now = Date.now()
      this.stmtUpdateChatSessionUpdatedAt.run(now, sessionId)
    })

    this.setupIdleTimer()
    return true
  }

  public clearChatSession(sessionId: string): void {
    const db = this.getDb()
    db.immediateTransaction(() => {
      this.stmtDeleteAllChatMessagesInSession.run(sessionId)
      const now = Date.now()
      this.stmtUpdateChatSessionUpdatedAt.run(now, sessionId)
    })
    this.setupIdleTimer()
  }

  public createChatSession(projectId: string, title: string): ChatSessionSummary {
    this.getDb()
    const id = crypto.randomUUID()
    const now = Date.now()

    this.stmtCreateChatSession.run(id, projectId, title, now, now)
    this.setupIdleTimer()

    return {
      id,
      projectId,
      title,
      createdAt: now,
      updatedAt: now
    }
  }

  public appendChatMessage(sessionId: string, message: ChatMessageInput): void {
    const db = this.getDb()
    let sessionRaw = this.stmtGetChatSessionById.get(sessionId)
    if (!sessionRaw || !isChatSessionRow(sessionRaw)) {
      const projects = this.getProjects()
      const targetProject = projects[0] ?? this.createProject('Default Project')
      const now = Date.now()
      const title = `Chat ${sessionId.slice(0, 8)}`
      this.stmtCreateChatSession.run(sessionId, targetProject.id, title, now, now)
      sessionRaw = this.stmtGetChatSessionById.get(sessionId)
    }

    const messageId = message.id ?? crypto.randomUUID()
    const timestamp = message.timestamp ?? Date.now()
    const toolCallsJson = JSON.stringify(message.toolCalls ?? [])
    const blocksJson = JSON.stringify(message.blocks ?? [])
    const actionsJson = JSON.stringify(message.actions ?? [])
    const usageJson = message.usage !== undefined ? JSON.stringify(message.usage) : null
    const metadataJson = JSON.stringify(message.metadata ?? {})

    db.immediateTransaction(() => {
      this.stmtAppendChatMessage.run(
        messageId,
        sessionId,
        message.role,
        message.content,
        toolCallsJson,
        blocksJson,
        actionsJson,
        usageJson,
        metadataJson,
        timestamp
      )
      this.stmtUpdateChatSessionUpdatedAt.run(timestamp, sessionId)
    })

    this.setupIdleTimer()
  }

  public deleteChatSession(sessionId: string): void {
    const db = this.getDb()

    db.immediateTransaction(() => {
      // Cascade thread lineage in LangGraph tables where thread_id matches sessionId
      this.stmtDeleteThreadWrites.run(sessionId)
      this.stmtDeleteThreadBlobs.run(sessionId)
      this.stmtDeleteThreadCheckpoints.run(sessionId)
      this.stmtDeleteThreadRestoreHeads.run(sessionId)

      // Deleting chat_sessions row cascades to chat_messages and large_tool_outputs via SQLite foreign keys
      this.stmtDeleteChatSession.run(sessionId)
    })

    if (this.checkpointStore) {
      void this.checkpointStore.deleteThread(sessionId).catch(() => {})
    }

    this.setupIdleTimer()
  }

  // ============================================================================
  // FILE REVISIONS
  // ============================================================================

  public getFileRevisions(): FileRevision[] {
    this.getDb()
    const rawRows = this.stmtGetFileRevisions.all()
    const revisions: FileRevision[] = []
    for (const raw of rawRows) {
      if (isRecord(raw)) {
        const id = typeof raw.id === 'string' ? raw.id : ''
        const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
        const reason = raw.description === 'autosave' ? 'autosave' : 'checkpoint'
        const snapshotRef = typeof raw.snapshot_ref === 'string' ? raw.snapshot_ref : undefined
        revisions.push({ id, createdAt, reason, snapshotRef })
      }
    }
    return revisions
  }

  public getFileRevision(id: string): FileRevision | undefined {
    this.getDb()
    const raw = this.stmtGetFileRevisionById.get(id)
    if (!raw || !isRecord(raw)) return undefined
    const revId = typeof raw.id === 'string' ? raw.id : ''
    const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
    const reason = raw.description === 'autosave' ? 'autosave' : 'checkpoint'
    const snapshotRef = typeof raw.snapshot_ref === 'string' ? raw.snapshot_ref : undefined
    return { id: revId, createdAt, reason, snapshotRef }
  }

  public async createFileRevision(
    reason: 'checkpoint' | 'autosave' = 'checkpoint'
  ): Promise<FileRevision> {
    this.getDb()
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const snapshotRef = `${id}.msgpack`

    const instances = this.getInstancesMeta()
    const instancesData: Record<string, unknown> = {}
    for (const inst of instances) {
      const content = this.getInstanceContent(inst.id)
      instancesData[inst.id] = {
        ...inst,
        content: content ? unpack(content) : null
      }
    }
    const projects = this.getProjects()
    const snapshotPayload = { projects, instances: instancesData }
    const snapshotBuffer = toBuffer(snapshotPayload)
    const snapshotHash = crypto.createHash('sha256').update(snapshotBuffer).digest('hex')

    const targetProject = projects[0]
    const targetInstance = instances[0]

    const snapshotId = crypto.randomUUID()
    const cursorJson = JSON.stringify({ seq: 0, at: createdAt })

    this.stmtCreateSnapshot.run(
      snapshotId,
      targetInstance ? targetInstance.id : null,
      targetProject ? targetProject.id : null,
      targetInstance ? (targetInstance.type === 'canvas' ? 'graph-canvas' : 'document') : null,
      snapshotRef,
      snapshotHash,
      cursorJson,
      snapshotBuffer,
      createdAt
    )

    this.stmtInsertFileRevision.run(
      id,
      `Revision ${id.slice(0, 8)}`,
      reason,
      snapshotRef,
      createdAt
    )
    this.setupIdleTimer()

    return { id, createdAt, reason, snapshotRef }
  }

  public async restoreFileRevision(id: string): Promise<FileRevision | null> {
    const revision = this.getFileRevision(id)
    if (!revision || !revision.snapshotRef) return null

    const snapshotRaw = this.getSnapshot(revision.snapshotRef)
    if (!snapshotRaw) return null

    try {
      const decoded = unpack(snapshotRaw)
      if (isRecord(decoded) && isRecord(decoded.instances)) {
        for (const [instId, instData] of Object.entries(decoded.instances)) {
          if (isRecord(instData)) {
            const content = instData.content
            this.updateInstance(instId, {
              content,
              payload: content,
              name: typeof instData.name === 'string' ? instData.name : undefined,
              metadata: isRecord(instData.metadata) ? instData.metadata : undefined
            })
          }
        }
      }
      return revision
    } catch {
      return null
    }
  }

  // ============================================================================
  // CHECKPOINT BUNDLES
  // ============================================================================

  public getProjectBundles(projectId: string): CheckpointBundle[] {
    const project = this.getProjectById(projectId)
    if (!project) return []
    const bundlesRaw = project.metadata.checkpointBundles
    if (Array.isArray(bundlesRaw)) {
      return bundlesRaw as CheckpointBundle[]
    }
    return []
  }

  public getAllProjectBundles(): CheckpointBundle[] {
    const projects = this.getProjects()
    const bundleMap = new Map<string, CheckpointBundle>()
    for (const project of projects) {
      const bundles = this.getProjectBundles(project.id)
      for (const bundle of bundles) {
        if (!bundleMap.has(bundle.id)) {
          bundleMap.set(bundle.id, bundle)
        }
      }
    }
    return Array.from(bundleMap.values())
  }

  public saveProjectBundles(bundles: CheckpointBundle[], projectId?: string): void {
    let targetProject: ProjectRecord | undefined
    const projects = this.getProjects()
    if (projects.length === 0) {
      targetProject = this.createProject('Default Project')
    } else if (projectId) {
      targetProject = projects.find((p) => p.id === projectId)
    } else {
      targetProject = projects[0]
    }
    if (!targetProject) return
    const nextMeta = {
      ...targetProject.metadata,
      checkpointBundles: bundles
    }
    this.updateProject(targetProject.id, { metadata: nextMeta })
  }

  public listCheckpointBundles(filter?: {
    sessionId?: string
    threadId?: string
    projectId?: string
  }): CheckpointBundle[] {
    let bundles = filter?.projectId
      ? this.getProjectBundles(filter.projectId)
      : this.getAllProjectBundles()

    if (filter?.threadId) {
      bundles = bundles.filter((b) => b.threadId === filter.threadId)
    } else if (filter?.sessionId) {
      bundles = bundles.filter((b) => b.sessionId === filter.sessionId)
    }
    return bundles
  }

  public getCheckpointBundle(id: string): CheckpointBundle | undefined {
    return this.getAllProjectBundles().find((b) => b.id === id)
  }

  public createCheckpointBundle(bundle: CheckpointBundle): CheckpointBundle {
    const targetProjectId =
      bundle.projectId || bundle.instances[0]?.projectId || this.getProjects()[0]?.id
    const bundles = targetProjectId ? this.getProjectBundles(targetProjectId) : []
    const existingIdx = bundles.findIndex((b) => b.id === bundle.id)
    if (existingIdx >= 0) {
      bundles[existingIdx] = bundle
    } else {
      bundles.push(bundle)
    }
    this.saveProjectBundles(bundles, targetProjectId)
    return bundle
  }

  // ============================================================================
  // PROCESS LIFECYCLE & EXPORT HELPERS
  // ============================================================================

  public async flushPendingSaves(): Promise<void> {
    if (this.db && this.db.isOpen) {
      try {
        this.db.walCheckpoint(WAL_CHECKPOINT_MODES.PASSIVE)
      } catch {
        // Suppress non-blocking WAL flush background error
      }
    }
  }

  public getCloseState(): unknown {
    return {
      sourceArchivePath: this.dbPath,
      isUpdated: false,
      lastExportedAt: null,
      liveWorkspacePath: null,
      isArchiveBacked: true
    }
  }

  public async markArchiveExported(_targetPath: string): Promise<void> {
    // Single-file SQLite database format requires no secondary archive packaging
  }

  public stopWatcher(): void {
    this.clearIdleTimer()
  }
}
