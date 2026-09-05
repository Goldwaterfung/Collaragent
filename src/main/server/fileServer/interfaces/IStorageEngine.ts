/**
 * Internal Storage Engine Interface (Boundary B)
 * Conforms to docs/sqlite-storage-architecture/spec.md Section 6.4
 * and .agents/rules/coding-rules.md (Zero any policy)
 */

import type {
  WorkspaceSnapshot,
  WorkspaceCommandLogEntry,
  InstanceType,
  CheckpointBundle,
  FileRevision
} from '@shared/checkpoints/types'
import type { SqliteDatabase } from '../db/SqliteDatabase'

export interface ProjectRecord {
  readonly id: string
  readonly name: string
  readonly metadata: Record<string, unknown>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface InstanceSummary {
  readonly id: string
  readonly projectId: string
  readonly type: 'document' | 'canvas'
  readonly name: string
  readonly metadata: Record<string, unknown>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface InstanceDetail extends InstanceSummary {
  readonly payload: unknown
}

export interface CreateInstanceInput {
  readonly id?: string
  readonly projectId: string
  readonly name: string
  readonly content?: unknown
  readonly payload?: unknown
  readonly metadata?: Record<string, unknown>
}

export interface UpdateInstanceInput {
  readonly name?: string
  readonly projectId?: string
  readonly content?: unknown
  readonly payload?: unknown
  readonly metadata?: Record<string, unknown>
}

export interface ChatSessionSummary {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ChatMessageInput {
  readonly id?: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly toolCalls?: unknown[]
  readonly blocks?: unknown[]
  readonly actions?: unknown[]
  readonly usage?: unknown
  readonly metadata?: Record<string, unknown>
  readonly timestamp?: number
}

export interface ChatMessageRecord {
  readonly id: string
  readonly sessionId: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly toolCalls: unknown[]
  readonly blocks: unknown[]
  readonly actions: unknown[]
  readonly usage?: unknown
  readonly metadata: Record<string, unknown>
  readonly timestamp: number
}

export interface ChatSessionDetail extends ChatSessionSummary {
  readonly messages: ChatMessageRecord[]
}

export interface CreateSnapshotInput {
  readonly id?: string
  readonly instanceId: string
  readonly projectId: string
  readonly instanceType: InstanceType
  readonly snapshotRef: string
  readonly snapshotHash: string
  readonly snapshotCursor?: Record<string, unknown>
  readonly snapshotPayload: Buffer | unknown
  readonly createdAt?: string
}

export interface CommandLogInput {
  readonly commandId: string
  readonly commandType: string
  readonly payload: unknown
  readonly timestamp?: number
}

export interface IStorageEngine {
  readonly database?: SqliteDatabase | null

  // Lifecycle
  initialize(): Promise<void>
  close(): Promise<void>
  prepareClose(): Promise<void>

  // Projects & Instances
  getProjects(): ProjectRecord[]
  getProjectById?(projectId: string): ProjectRecord | null
  createProject(name: string, metadata?: Record<string, unknown>): ProjectRecord
  updateProject?(
    projectId: string,
    updates: { name?: string; metadata?: Record<string, unknown> }
  ): ProjectRecord | null
  deleteProject?(projectId: string): boolean
  getInstancesMeta(projectId?: string): InstanceSummary[]
  getInstanceContent(instanceId: string): Buffer | null
  createInstance(type: 'document' | 'canvas', data: CreateInstanceInput): InstanceSummary
  updateInstance(instanceId: string, updates: UpdateInstanceInput): void
  deleteInstance(instanceId: string): void

  // Chat & Messaging
  getChatSessions(projectId?: string): ChatSessionSummary[]
  getChatSession(sessionId: string): ChatSessionDetail | null
  getChatMessages?(
    sessionId: string,
    options?: { limit?: number; before?: string | number }
  ): ChatMessageRecord[]
  createChatSession(projectId: string, title: string): ChatSessionSummary
  appendChatMessage(sessionId: string, message: ChatMessageInput): void
  deleteChatSession(sessionId: string): void // Cascades checkpoints & writes
  truncateChatSession?(sessionId: string, messageId: string, blockIndex?: number): boolean
  clearChatSession?(sessionId: string): void

  // Snapshots & Command Logs
  createSnapshot(snapshot: CreateSnapshotInput): WorkspaceSnapshot
  getSnapshot(snapshotRef: string): Buffer | null
  getWorkspaceSnapshot?(id: string): WorkspaceSnapshot | undefined
  loadWorkspaceSnapshot?(id: string): Promise<unknown | null>
  createWorkspaceSnapshot?(data: {
    instanceId: string
    instanceType: InstanceType
    projectId: string
    snapshot: unknown
    snapshotCursor?: Record<string, unknown>
  }): Promise<WorkspaceSnapshot>
  appendCommandLog(instanceId: string, command: CommandLogInput): void
  getCommandLogs(instanceId: string, limit?: number, before?: number): WorkspaceCommandLogEntry[]
  appendWorkspaceLogEntry?(entry: WorkspaceCommandLogEntry): void
  getWorkspaceLogEntries?(
    instanceId: string,
    limit?: number,
    before?: number
  ): WorkspaceCommandLogEntry[]

  // Revisions & Checkpoint Bundles
  getFileRevisions?(): FileRevision[]
  getFileRevision?(id: string): FileRevision | undefined
  createFileRevision?(reason?: 'checkpoint' | 'autosave'): Promise<FileRevision>
  restoreFileRevision?(id: string): Promise<FileRevision | null>
  listCheckpointBundles?(filter?: {
    sessionId?: string
    threadId?: string
    projectId?: string
  }): CheckpointBundle[]
  getCheckpointBundle?(id: string): CheckpointBundle | undefined
  createCheckpointBundle?(bundle: CheckpointBundle): CheckpointBundle
  getProjectBundles?(projectId: string): CheckpointBundle[]
  getAllProjectBundles?(): CheckpointBundle[]

  // Process & Export State
  flushPendingSaves(): Promise<void>
  getCloseState(): unknown
  markArchiveExported(targetPath: string): Promise<void>
  stopWatcher(): void

  // Event Handling (compatible with EventEmitter)
  on(event: string, listener: (...args: unknown[]) => void): this
  emit?(event: string, ...args: unknown[]): boolean
}
