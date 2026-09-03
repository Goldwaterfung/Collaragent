/**
 * Internal Checkpoint Store Interface (Boundary B)
 * Conforms to docs/sqlite-storage-architecture/spec.md Section 6.4
 * and .agents/rules/coding-rules.md (Zero any policy)
 */

export interface CheckpointRecord {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly checkpoint_id: string
  readonly parent_checkpoint_id?: string
  readonly checkpoint: Record<string, unknown>
  readonly metadata: Record<string, unknown>
  readonly created_at?: number
}

export interface CheckpointBlobRecord {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly channel: string
  readonly version: string
  readonly type: string // 'json' | 'bytes' | 'empty' | LangChain class type
  readonly blob: unknown
  readonly serialized?: boolean
}

export interface CheckpointWriteRecord {
  readonly thread_id: string
  readonly checkpoint_ns: string
  readonly checkpoint_id: string
  readonly task_id: string
  readonly idx: number
  readonly channel: string
  readonly type: string
  readonly blob: unknown
}

export interface LargeToolOutputRecord {
  readonly id: string
  readonly sessionId: string
  readonly contentBlob: Buffer
  readonly byteSize: number
  readonly createdAt: number
}

export interface ICheckpointStore {
  // LangGraph Core
  getCheckpoints(threadId: string, checkpointNs?: string): Promise<CheckpointRecord[]>
  getLatestCheckpoint(
    threadId: string,
    checkpointNs?: string
  ): Promise<CheckpointRecord | undefined>
  putCheckpoint(record: CheckpointRecord): Promise<void>

  // Channel Version Blobs
  getBlob(
    threadId: string,
    checkpointNs: string,
    channel: string,
    version: string
  ): Promise<CheckpointBlobRecord | undefined>
  getBlob(key: string): Promise<CheckpointBlobRecord | undefined>
  getBlobsByPrefix(threadId: string, checkpointNs: string): Promise<CheckpointBlobRecord[]>
  putBlob(record: CheckpointBlobRecord): Promise<void>
  deleteBlobs(keys: string[]): Promise<void>

  // Pending Task Writes & Retention
  getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]>
  putWrites(records: CheckpointWriteRecord[]): Promise<void>
  pruneWrites(threadId: string, keepTurns?: number): Promise<number>

  // Restore Heads
  getRestoreHead(threadId: string, checkpointNs: string): Promise<string | undefined>
  putRestoreHead(threadId: string, checkpointNs: string, checkpointId: string): Promise<void>

  // ADR-006 Large Tool Results
  putLargeToolOutput(id: string, sessionId: string, buffer: Buffer): Promise<void>
  getLargeToolOutput(id: string): Promise<Buffer | undefined>

  // Optional Thread Management
  deleteThread?(threadId: string): Promise<void>
}
