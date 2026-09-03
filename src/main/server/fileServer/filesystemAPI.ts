/**
 * filesystemAPI.ts: Loopback Express REST API for CollarAgent V4 Embedded Storage Architecture
 * Conforms to docs/sqlite-storage-architecture/spec.md (Boundary A, API-REQ-01..06)
 * and .agents/rules/coding-rules.md (Zero any, no hardcoded constants, structured errors).
 */

import express from 'express'
import http from 'node:http'
import WebSocket from 'ws'
import cors from 'cors'
import path from 'node:path'
import { z } from 'zod'
import { unpack } from 'msgpackr'
import { SqliteDatabase } from './db/SqliteDatabase'

import { ListInstancesResponseSchema, GetInstanceByIdSchema } from '@shared/schemas/requests'
import {
  CheckpointBundleSchema,
  WorkspaceCommandLogEntrySchema,
  WorkspaceSnapshotSchema
} from '@shared/checkpoints/validators'
import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import { applyWorkspaceCommands } from '@workspace/persistence/checkpointRestoreHelpers'
import { InverseCommandEngine } from '@collaragent/runtime/InverseCommandEngine'

import { SQLITE_ENGINE_CONFIG } from './config/sqliteConfig'
import { SqliteStorageEngine } from './SqliteStorageEngine'
import { SqliteCheckpointStore } from './SqliteCheckpointStore'
import { FileSystemSaver } from './FileSystemSaver'
import {
  StorageError,
  StorageErrorCode,
  isStorageError,
  toApiErrorResponse
} from './errors/StorageErrors'
import type { IStorageEngine } from './interfaces/IStorageEngine'
import type { ICheckpointStore } from './interfaces/ICheckpointStore'

// ============================================================================
// BOUNDARY REQUEST & QUERY SCHEMAS (API-REQ-04)
// ============================================================================

const IdParamSchema = z.object({
  id: z.string().min(1)
})

const ThreadIdParamSchema = z.object({
  threadId: z.string().min(1)
})

const InstanceIdParamSchema = z.object({
  instanceId: z.string().min(1)
})

const PaginationQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(SQLITE_ENGINE_CONFIG.maxPaginationCeiling)
    .optional()
    .default(SQLITE_ENGINE_CONFIG.defaultPaginationLimit),
  before: z.string().optional()
})

const CreateProjectBodySchema = z.object({
  name: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const UpdateProjectBodySchema = z.object({
  name: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const CreateInstanceBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(100),
  projectId: z.string().min(1),
  type: z.enum(['document', 'canvas']),
  content: z.unknown().optional(),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const UpdateInstanceBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  projectId: z.string().min(1).optional(),
  content: z.unknown().optional(),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const ChatMessageBodySchema = z.object({
  id: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']).default('assistant'),
  content: z.string().default(''),
  toolCalls: z.array(z.unknown()).optional().default([]),
  blocks: z.array(z.unknown()).optional().default([]),
  actions: z.array(z.unknown()).optional().default([]),
  usage: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  timestamp: z.number().optional()
})

const ChatRestoreBodySchema = z.object({
  messageId: z.string().min(1),
  blockIndex: z.number().int().nonnegative().optional()
})

const CheckpointListQuerySchema = z.object({
  checkpoint_ns: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  before: z.string().optional()
})

const CheckpointLatestQuerySchema = z.object({
  checkpoint_ns: z.string().optional(),
  checkpoint_id: z.string().optional(),
  raw: z.string().optional()
})

const CheckpointPutBodySchema = z.object({
  config: z.record(z.string(), z.unknown()),
  checkpoint: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
  newVersions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  blobs: z.record(z.string(), z.unknown()).optional()
})

const WritesPutBodySchema = z.object({
  config: z.record(z.string(), z.unknown()),
  writes: z.array(z.tuple([z.string(), z.unknown()])),
  taskId: z.string().min(1)
})

const FileRevisionCreateBodySchema = z.object({
  reason: z.enum(['checkpoint', 'autosave']).optional()
})

const BundlesQuerySchema = z.object({
  sessionId: z.string().optional(),
  threadId: z.string().optional()
})

const CheckpointRestoreBodySchema = z.object({
  bundleId: z.string().min(1),
  sessionId: z.string().optional(),
  threadId: z.string().optional()
})

// ============================================================================
// STANDARDIZED API ERROR HANDLER (API-REQ-03)
// ============================================================================

export function handleApiError(res: express.Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: StorageErrorCode.STORAGE_VALIDATION_FAILED,
        message:
          err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') ||
          'Validation failed',
        subsystem: 'STORAGE',
        details: err.flatten()
      }
    })
    return
  }

  if (isStorageError(err)) {
    let status = 500
    switch (err.code) {
      case StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND:
      case StorageErrorCode.STORAGE_SESSION_NOT_FOUND:
      case StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND:
      case StorageErrorCode.STORAGE_BLOB_NOT_FOUND:
        status = 404
        break
      case StorageErrorCode.STORAGE_LOCK_CONFLICT:
      case StorageErrorCode.STORAGE_LOCK_ACQUISITION_FAILED:
      case StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION:
        status = 409
        break
      case StorageErrorCode.STORAGE_VALIDATION_FAILED:
        status = 422
        break
      default:
        status = 500
    }
    res.status(status).json(toApiErrorResponse(err))
    return
  }

  const message = err instanceof Error ? err.message : 'Internal Server Error'
  res.status(500).json({
    error: {
      code: StorageErrorCode.STORAGE_TRANSACTION_FAILED,
      message,
      subsystem: 'STORAGE',
      ...(err instanceof Error && err.message ? { details: err.message } : {})
    }
  })
}

// ============================================================================
// TYPES & HANDLE
// ============================================================================

export type FilesystemApiHandle = {
  port: number
  close: () => Promise<void>
  storage: IStorageEngine
  saver: FileSystemSaver
  setWsPort: (port: number) => void
}

export interface StartFilesystemApiOptions {
  port?: number
  filePath?: string
  workingDirectory?: string
  storageEngine?: IStorageEngine
  checkpointStore?: ICheckpointStore
  saver?: FileSystemSaver
}

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

export async function startFilesystemApi(
  options: StartFilesystemApiOptions = {}
): Promise<FilesystemApiHandle> {
  const API_PORT = Number(process.env.API_PORT) || 0
  const port = options.port !== undefined ? options.port : API_PORT
  const filePath =
    options.filePath ||
    process.env.CAGENT_FILE_PATH ||
    path.resolve(process.cwd(), 'local-data.cagent')

  let currentWsPort = Number(process.env.WS_PORT) || 0

  // Storage and Checkpointer initialization
  const storage: IStorageEngine = options.storageEngine ?? new SqliteStorageEngine(filePath)
  await storage.initialize()

  let checkpointStore: ICheckpointStore
  if (options.checkpointStore) {
    checkpointStore = options.checkpointStore
  } else if (storage.database) {
    checkpointStore = new SqliteCheckpointStore(storage.database)
  } else {
    const db = new SqliteDatabase(filePath)
    db.migrate()
    checkpointStore = new SqliteCheckpointStore(db)
  }

  const saver: FileSystemSaver = options.saver ?? new FileSystemSaver(checkpointStore)

  // WebSocket notification relay
  let notifyWs: WebSocket | null = null
  const notifyQueue: unknown[] = []
  let isConnectingWs = false

  const connectNotifyWs = (): void => {
    if (isConnectingWs || (notifyWs && notifyWs.readyState === WebSocket.OPEN)) return
    isConnectingWs = true
    const wsUrl = `ws://localhost:${currentWsPort}/ws/editor-content`
    const ws = new WebSocket(wsUrl)

    ws.on('open', () => {
      isConnectingWs = false
      notifyWs = ws
      while (notifyQueue.length > 0) {
        const msg = notifyQueue.shift()
        ws.send(JSON.stringify(msg))
      }
    })

    ws.on('error', () => {
      isConnectingWs = false
    })

    ws.on('close', () => {
      isConnectingWs = false
      notifyWs = null
    })
  }

  const notifyWsServer = (message: unknown): void => {
    if (notifyWs && notifyWs.readyState === WebSocket.OPEN) {
      notifyWs.send(JSON.stringify(message))
    } else {
      notifyQueue.push(message)
      connectNotifyWs()
    }
  }

  connectNotifyWs()

  // Express application setup
  const app = express()
  app.use(cors({ origin: '*' }))
  app.use(express.json({ limit: '50mb' }))

  // ============================================================================
  // INSTANCES REST ENDPOINTS
  // ============================================================================

  // GET /api/instances (API-REQ-01)
  app.get('/api/instances', (_req, res) => {
    try {
      const rawInstances = storage.getInstancesMeta()
      const rawProjects = storage.getProjects()

      const instances = rawInstances.map((inst) => ({
        id: inst.id,
        projectId: inst.projectId,
        name: inst.name,
        type: inst.type,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
        metadata: inst.metadata
      }))

      const projects = rawProjects.map((proj) => ({
        id: proj.id,
        name: proj.name
      }))

      const responseData = { instances, projects }
      const validated = ListInstancesResponseSchema.parse(responseData)
      res.json(validated)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // GET /api/instances/:id (API-REQ-02)
  app.get('/api/instances/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const instances = storage.getInstancesMeta()
      const meta = instances.find((inst) => inst.id === id)

      if (!meta) {
        throw new StorageError(
          StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
          `Instance with id '${id}' not found`,
          { instanceId: id }
        )
      }

      const contentBuffer = storage.getInstanceContent(id)
      let payload: unknown = undefined
      if (contentBuffer !== null) {
        try {
          payload = unpack(contentBuffer)
        } catch {
          payload = contentBuffer
        }
      }

      const responseData = {
        id: meta.id,
        projectId: meta.projectId,
        name: meta.name,
        type: meta.type,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        metadata: meta.metadata,
        payload,
        content: payload // Compatible with ws-server expectation
      }

      const validated = GetInstanceByIdSchema.safeParse(responseData)
      if (validated.success) {
        res.json({ ...validated.data, content: validated.data.payload })
      } else {
        res.json(responseData)
      }
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // POST /api/instances (Normalizes content vs payload)
  app.post('/api/instances', (req, res) => {
    try {
      const body = CreateInstanceBodySchema.parse(req.body)
      const rawPayload = body.payload !== undefined ? body.payload : body.content

      const instance = storage.createInstance(body.type, {
        id: body.id,
        name: body.name,
        projectId: body.projectId,
        payload: rawPayload,
        metadata: body.metadata
      })

      res.status(201).json({ status: 'created', id: instance.id })

      notifyWsServer({
        type: 'internal:instanceCreated',
        instance: {
          id: instance.id,
          name: instance.name,
          type: instance.type,
          projectId: instance.projectId,
          updatedAt: instance.updatedAt,
          metadata: instance.metadata
        }
      })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // PATCH /api/instances/:id (Normalizes content vs payload)
  app.patch('/api/instances/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const body = UpdateInstanceBodySchema.parse(req.body)
      const rawPayload = body.payload !== undefined ? body.payload : body.content

      storage.updateInstance(id, {
        name: body.name,
        projectId: body.projectId,
        payload: rawPayload,
        metadata: body.metadata
      })

      res.json({ status: 'ok', id })

      if (rawPayload !== undefined) {
        notifyWsServer({
          type: 'update',
          instanceId: id,
          payload: rawPayload,
          clientId: 'system-persistence-confirm'
        })
      }

      if (body.name !== undefined || body.projectId !== undefined || body.metadata !== undefined) {
        const instances = storage.getInstancesMeta()
        const updatedMeta = instances.find((inst) => inst.id === id)
        if (updatedMeta) {
          notifyWsServer({
            type: 'internal:instanceUpdated',
            instance: {
              id: updatedMeta.id,
              name: updatedMeta.name,
              type: updatedMeta.type,
              projectId: updatedMeta.projectId,
              updatedAt: updatedMeta.updatedAt,
              metadata: updatedMeta.metadata
            }
          })
        }
      }
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // DELETE /api/instances/:id
  app.delete('/api/instances/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const instances = storage.getInstancesMeta()
      const exists = instances.some((inst) => inst.id === id)

      if (!exists) {
        throw new StorageError(
          StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
          `Instance with id '${id}' not found`,
          { instanceId: id }
        )
      }

      storage.deleteInstance(id)
      res.json({ status: 'deleted', id, deleted: true })

      notifyWsServer({ type: 'delete', instanceId: id, clientId: 'api-delete' })
      notifyWsServer({ type: 'internal:instanceDeleted', instanceId: id })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // PROJECTS REST ENDPOINTS
  // ============================================================================

  app.get('/api/projects', (_req, res) => {
    try {
      res.json({ projects: storage.getProjects() })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/projects', (req, res) => {
    try {
      const body = CreateProjectBodySchema.parse(req.body)
      const project = storage.createProject(body.name, body.metadata)
      res.status(201).json({ status: 'created', id: project.id })
      notifyWsServer({ type: 'instancesUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.patch('/api/projects/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const body = UpdateProjectBodySchema.parse(req.body)

      if (!storage.updateProject) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'updateProject is not supported by current storage engine'
        )
      }

      const project = storage.updateProject(id, body)
      if (!project) {
        throw new StorageError(
          StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
          `Project with id '${id}' not found`,
          { projectId: id }
        )
      }

      res.json({ status: 'ok', id: project.id })
      notifyWsServer({ type: 'instancesUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.delete('/api/projects/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)

      if (!storage.deleteProject) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'deleteProject is not supported by current storage engine'
        )
      }

      const deleted = storage.deleteProject(id)
      if (!deleted) {
        throw new StorageError(
          StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND,
          `Project with id '${id}' not found`,
          { projectId: id }
        )
      }

      res.json({ status: 'deleted', id })
      notifyWsServer({ type: 'instancesUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // CHAT SESSIONS & MESSAGES (API-REQ-05 PAGINATION)
  // ============================================================================

  app.get('/api/chat/sessions', (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined
      const sessions = storage.getChatSessions(projectId)
      res.json({ sessions })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.get('/api/chat/sessions/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const session = storage.getChatSession(id)
      if (!session) {
        throw new StorageError(
          StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
          `Chat session with id '${id}' not found`,
          { sessionId: id }
        )
      }
      res.json(session)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // GET /api/chat/sessions/:id/messages (API-REQ-05 Bounded Pagination)
  app.get('/api/chat/sessions/:id/messages', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const query = PaginationQuerySchema.parse(req.query)

      const session = storage.getChatSession(id)
      if (!session) {
        throw new StorageError(
          StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
          `Chat session with id '${id}' not found`,
          { sessionId: id }
        )
      }

      const messages = storage.getChatMessages
        ? storage.getChatMessages(id, { limit: query.limit, before: query.before })
        : session.messages

      res.json({ messages })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/chat/sessions/:id/messages', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const body = ChatMessageBodySchema.parse(req.body)

      const message = {
        id: body.id,
        role: body.role,
        content: body.content,
        toolCalls: body.toolCalls,
        blocks: body.blocks,
        actions: body.actions,
        usage: body.usage,
        metadata: body.metadata,
        timestamp: body.timestamp ?? Date.now()
      }

      storage.appendChatMessage(id, message)
      res.status(201).json({ status: 'created', sessionId: id })

      notifyWsServer({ type: 'chat:message', sessionId: id, message })
      notifyWsServer({ type: 'chat:sessionsUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.delete('/api/chat/sessions/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const session = storage.getChatSession(id)
      if (!session) {
        throw new StorageError(
          StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
          `Chat session with id '${id}' not found`,
          { sessionId: id }
        )
      }

      storage.deleteChatSession(id)
      res.json({ status: 'deleted', id })
      notifyWsServer({ type: 'chat:sessionsUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/chat/sessions/:id/restore', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const body = ChatRestoreBodySchema.parse(req.body)

      if (!storage.truncateChatSession) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'truncateChatSession is not supported by current storage engine'
        )
      }

      const ok = storage.truncateChatSession(id, body.messageId, body.blockIndex)
      if (!ok) {
        throw new StorageError(
          StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
          `Session or message '${body.messageId}' not found`,
          { sessionId: id, messageId: body.messageId }
        )
      }

      res.json({
        status: 'restored',
        sessionId: id,
        messageId: body.messageId,
        blockIndex: body.blockIndex
      })
      notifyWsServer({ type: 'chat:sessionsUpdated' })
      notifyWsServer({
        type: 'chat:restored',
        sessionId: id,
        messageId: body.messageId,
        blockIndex: body.blockIndex
      })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // PERSISTENCE (LANGGRAPH CHECKPOINTS)
  // ============================================================================

  app.get('/api/persistence/checkpoints/:threadId', async (req, res) => {
    try {
      const { threadId } = ThreadIdParamSchema.parse(req.params)
      const query = CheckpointListQuerySchema.parse(req.query)

      const config = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: query.checkpoint_ns ?? ''
        }
      }

      const options: {
        limit?: number
        before?: { configurable: { checkpoint_id?: string } }
      } = {}
      if (query.limit !== undefined) options.limit = query.limit
      if (query.before !== undefined) {
        options.before = { configurable: { checkpoint_id: query.before } }
      }

      const checkpoints: unknown[] = []
      for await (const tuple of saver.list(config, options)) {
        checkpoints.push(tuple)
      }
      res.json(checkpoints)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.get('/api/persistence/checkpoints/:threadId/latest', async (req, res) => {
    try {
      const { threadId } = ThreadIdParamSchema.parse(req.params)
      const query = CheckpointLatestQuerySchema.parse(req.query)

      const config = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: query.checkpoint_ns ?? '',
          checkpoint_id: query.checkpoint_id
        }
      }

      const tuple =
        query.raw === 'true' ? await saver.getRawTuple(config) : await saver.getTuple(config)

      if (!tuple) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          'Checkpoint not found',
          { threadId, checkpointNs: query.checkpoint_ns, checkpointId: query.checkpoint_id }
        )
      }

      res.json(tuple)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.put('/api/persistence/checkpoints', async (req, res) => {
    try {
      const body = CheckpointPutBodySchema.parse(req.body)

      const result = await saver.put(
        body.config,
        body.checkpoint as unknown as Parameters<typeof saver.put>[1],
        body.metadata as unknown as Parameters<typeof saver.put>[2],
        body.newVersions || {},
        body.blobs
      )

      res.json(result)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.put('/api/persistence/writes', async (req, res) => {
    try {
      const body = WritesPutBodySchema.parse(req.body)
      await saver.putWrites(body.config, body.writes, body.taskId)
      res.json({ status: 'ok' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.delete('/api/persistence/threads/:threadId', async (req, res) => {
    try {
      const { threadId } = ThreadIdParamSchema.parse(req.params)
      await saver.deleteThread(threadId)
      res.json({ status: 'deleted' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // FILE REVISIONS
  // ============================================================================

  app.get('/api/checkpoints/revisions', (_req, res) => {
    try {
      const revisions = storage.getFileRevisions ? storage.getFileRevisions() : []
      res.json({ revisions })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.get('/api/checkpoints/revisions/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const revision = storage.getFileRevision ? storage.getFileRevision(id) : undefined
      if (!revision) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          `File revision '${id}' not found`,
          { revisionId: id }
        )
      }
      res.json(revision)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/checkpoints/revisions', async (req, res) => {
    try {
      const body = FileRevisionCreateBodySchema.parse(req.body)
      if (!storage.createFileRevision) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'createFileRevision is not supported by current storage engine'
        )
      }
      const revision = await storage.createFileRevision(body.reason)
      res.status(201).json(revision)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/checkpoints/revisions/:id/restore', async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      if (!storage.restoreFileRevision) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'restoreFileRevision is not supported by current storage engine'
        )
      }
      const revision = await storage.restoreFileRevision(id)
      if (!revision) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          `File revision '${id}' not found`,
          { revisionId: id }
        )
      }
      res.json({ status: 'restored', revision })
      notifyWsServer({ type: 'instancesUpdated' })
      notifyWsServer({ type: 'chat:sessionsUpdated' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // WORKSPACE SNAPSHOTS & COMMAND LOGS
  // ============================================================================

  app.post('/api/checkpoints/workspace/snapshots', async (req, res) => {
    try {
      const parsed = WorkspaceSnapshotSchema.omit({
        id: true,
        createdAt: true,
        snapshotRef: true
      })
        .extend({ snapshot: z.unknown() })
        .parse(req.body)

      if (!storage.createWorkspaceSnapshot) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'createWorkspaceSnapshot is not supported by current storage engine'
        )
      }

      const snapshot = await storage.createWorkspaceSnapshot({
        instanceId: parsed.instanceId,
        instanceType: parsed.instanceType,
        projectId: parsed.projectId,
        snapshot: parsed.snapshot,
        snapshotCursor: parsed.snapshotCursor
      })

      res.status(201).json(snapshot)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.get('/api/checkpoints/workspace/snapshots/:id', async (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)

      const snapshot = storage.getWorkspaceSnapshot ? storage.getWorkspaceSnapshot(id) : undefined
      if (!snapshot) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          `Workspace snapshot '${id}' not found`,
          { snapshotId: id }
        )
      }

      const payload = storage.loadWorkspaceSnapshot ? await storage.loadWorkspaceSnapshot(id) : null
      res.json({ snapshot, payload })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/checkpoints/workspace/logs', (req, res) => {
    try {
      const parsed = WorkspaceCommandLogEntrySchema.parse(req.body)

      if (!storage.appendWorkspaceLogEntry) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'appendWorkspaceLogEntry is not supported by current storage engine'
        )
      }

      storage.appendWorkspaceLogEntry(parsed)
      res.status(201).json({ status: 'ok' })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // GET /api/checkpoints/workspace/logs/:instanceId (API-REQ-05 Bounded Pagination)
  app.get('/api/checkpoints/workspace/logs/:instanceId', (req, res) => {
    try {
      const { instanceId } = InstanceIdParamSchema.parse(req.params)
      const query = PaginationQuerySchema.parse(req.query)

      let beforeNum: number | undefined
      if (query.before !== undefined) {
        const parsedNum = Number(query.before)
        if (!isNaN(parsedNum)) {
          beforeNum = parsedNum
        }
      }

      const entries = storage.getWorkspaceLogEntries
        ? storage.getWorkspaceLogEntries(instanceId, query.limit, beforeNum)
        : storage.getCommandLogs(instanceId, query.limit, beforeNum)

      res.json({ entries })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // CHECKPOINT BUNDLES & UNIFIED RESTORE
  // ============================================================================

  app.get('/api/checkpoints/bundles', (req, res) => {
    try {
      const query = BundlesQuerySchema.parse(req.query)
      const bundles = storage.listCheckpointBundles
        ? storage.listCheckpointBundles({ sessionId: query.sessionId, threadId: query.threadId })
        : []
      res.json({ bundles })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.get('/api/checkpoints/bundles/:id', (req, res) => {
    try {
      const { id } = IdParamSchema.parse(req.params)
      const bundle = storage.getCheckpointBundle ? storage.getCheckpointBundle(id) : undefined
      if (!bundle) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          `Checkpoint bundle '${id}' not found`,
          { bundleId: id }
        )
      }
      res.json(bundle)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.put('/api/checkpoints/bundles', (req, res) => {
    try {
      const parsed = CheckpointBundleSchema.parse(req.body)
      if (!storage.createCheckpointBundle) {
        throw new StorageError(
          StorageErrorCode.STORAGE_TRANSACTION_FAILED,
          'createCheckpointBundle is not supported by current storage engine'
        )
      }
      const bundle = storage.createCheckpointBundle(parsed)
      res.status(201).json(bundle)
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  app.post('/api/checkpoints/restore', async (req, res) => {
    try {
      const body = CheckpointRestoreBodySchema.parse(req.body)
      const bundleId = body.bundleId
      const sessionId = body.sessionId
      const threadId = body.threadId

      const bundle = storage.getCheckpointBundle ? storage.getCheckpointBundle(bundleId) : undefined
      if (!bundle) {
        throw new StorageError(
          StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
          `Checkpoint bundle '${bundleId}' not found`,
          { bundleId }
        )
      }

      if (sessionId && bundle.sessionId !== sessionId) {
        return res.status(409).json({
          error: {
            code: StorageErrorCode.STORAGE_VALIDATION_FAILED,
            message: 'Checkpoint bundle session mismatch',
            subsystem: 'STORAGE'
          }
        })
      }

      if (threadId && bundle.threadId !== threadId) {
        return res.status(409).json({
          error: {
            code: StorageErrorCode.STORAGE_VALIDATION_FAILED,
            message: 'Checkpoint bundle thread mismatch',
            subsystem: 'STORAGE'
          }
        })
      }

      if (bundle.agentCheckpointId) {
        const tuple = await saver.getRawTuple({
          configurable: {
            thread_id: bundle.threadId,
            checkpoint_ns: '',
            checkpoint_id: bundle.agentCheckpointId
          }
        })
        if (!tuple) {
          throw new StorageError(
            StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
            `Agent checkpoint '${bundle.agentCheckpointId}' not found`,
            { checkpointId: bundle.agentCheckpointId }
          )
        }
      }

      // 1. Capture current live content
      const instancePayloads = new Map<string, unknown>()
      for (const instance of bundle.instances) {
        const contentBuf = storage.getInstanceContent(instance.instanceId)
        let currentContent: unknown = undefined
        if (contentBuf) {
          try {
            currentContent = unpack(contentBuf)
          } catch {
            currentContent = contentBuf
          }
        }
        instancePayloads.set(instance.instanceId, currentContent)
      }

      // 2. Restore file revision if present
      if (bundle.fileRevisionId && storage.restoreFileRevision) {
        const revision = await storage.restoreFileRevision(bundle.fileRevisionId)
        if (!revision) {
          throw new StorageError(
            StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
            `File revision '${bundle.fileRevisionId}' not found`,
            { fileRevisionId: bundle.fileRevisionId }
          )
        }
        notifyWsServer({ type: 'instancesUpdated' })
        notifyWsServer({ type: 'chat:sessionsUpdated' })
      }

      // 3. Restore instance snapshots and reverse command logs
      for (const instance of bundle.instances) {
        let restoredPayload: unknown = undefined

        if (instance.snapshotId && storage.loadWorkspaceSnapshot) {
          restoredPayload = await storage.loadWorkspaceSnapshot(instance.snapshotId)
        }

        if (restoredPayload === undefined) {
          const livePayload = instancePayloads.get(instance.instanceId)
          const logEntries = storage.getWorkspaceLogEntries
            ? storage.getWorkspaceLogEntries(instance.instanceId)
            : storage.getCommandLogs(instance.instanceId)
          const targetSeq = instance.targetCursor?.seq ?? -Infinity

          const agentEntriesToUndo = logEntries.filter((e) => {
            return e.source === 'agent' && (e.cursor?.seq ?? -Infinity) > targetSeq
          })

          if (agentEntriesToUndo.length > 0 && livePayload !== undefined) {
            restoredPayload = livePayload
            const sorted = [...agentEntriesToUndo].sort(
              (a, b) => (b.cursor.seq || 0) - (a.cursor.seq || 0)
            )
            const undoEntries: WorkspaceCommandLogEntry[] = []
            for (const entry of sorted) {
              const undoCommand = InverseCommandEngine.invert(entry)
              if (undoCommand) {
                undoEntries.push({ ...entry, command: undoCommand })
              }
            }
            if (undoEntries.length > 0) {
              restoredPayload = applyWorkspaceCommands(
                restoredPayload,
                instance.instanceType,
                undoEntries
              )
            }
          } else if (livePayload !== undefined) {
            restoredPayload = livePayload
          }
        }

        if (restoredPayload === undefined) {
          continue
        }

        storage.updateInstance(instance.instanceId, {
          payload: restoredPayload,
          content: restoredPayload
        })

        notifyWsServer({
          type: 'update',
          instanceId: instance.instanceId,
          payload: restoredPayload,
          clientId: 'system-checkpoint-restore'
        })
      }

      // 4. Truncate or clear chat session
      if (bundle.chat?.messageId && storage.truncateChatSession) {
        const ok = storage.truncateChatSession(
          bundle.threadId,
          bundle.chat.messageId,
          bundle.chat.blockIndex
        )
        if (!ok) {
          throw new StorageError(
            StorageErrorCode.STORAGE_SESSION_NOT_FOUND,
            'Chat session or message not found',
            { threadId: bundle.threadId, messageId: bundle.chat.messageId }
          )
        }
        notifyWsServer({ type: 'chat:sessionsUpdated' })
        notifyWsServer({
          type: 'chat:restored',
          sessionId: bundle.threadId,
          messageId: bundle.chat.messageId,
          blockIndex: bundle.chat.blockIndex
        })
      } else if (bundle.chat && storage.clearChatSession) {
        storage.clearChatSession(bundle.threadId)
        notifyWsServer({ type: 'chat:sessionsUpdated' })
        notifyWsServer({
          type: 'chat:restored',
          sessionId: bundle.threadId
        })
      }

      // 5. Restore LangGraph restore head
      if (bundle.agentCheckpointId) {
        await saver.setRestoreHead(bundle.threadId, bundle.agentCheckpointId, '')
      }

      res.json({ status: 'restored', bundleId, bundle })
    } catch (err: unknown) {
      handleApiError(res, err)
    }
  })

  // ============================================================================
  // SERVER START & HANDLE
  // ============================================================================

  const server = http.createServer(app)

  return new Promise((resolve) => {
    server.listen(port, () => {
      let actualPort = port
      try {
        const address = server.address()
        if (address && typeof address === 'object' && 'port' in address) {
          actualPort = address.port
        }
      } catch {
        // Suppress address inspection error
      }

      if (typeof storage.on === 'function') {
        storage.on('reload', () => {
          notifyWsServer({ type: 'system:reload' })
        })
        storage.on('saving', () => {
          notifyWsServer({ type: 'system:persistence_status', status: 'saving' })
        })
        storage.on('saved', () => {
          notifyWsServer({ type: 'system:persistence_status', status: 'saved' })
        })
      }

      resolve({
        port: actualPort,
        storage,
        saver,
        setWsPort: (p: number) => {
          currentWsPort = p
          if (notifyWs) {
            notifyWs.close()
          } else {
            connectNotifyWs()
          }
        },
        close: async () => {
          if (typeof storage.stopWatcher === 'function') {
            storage.stopWatcher()
          }
          if (notifyWs) {
            try {
              notifyWs.close()
            } catch {
              // Ignore close error
            }
          }
          await new Promise<void>((resClose) => server.close(() => resClose()))
        }
      })
    })
  })
}
