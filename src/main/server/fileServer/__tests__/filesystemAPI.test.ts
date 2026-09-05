import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { ListInstancesResponseSchema, GetInstanceByIdSchema } from '@shared/schemas/requests'
import { StorageErrorCode } from '../errors/StorageErrors'
import { startFilesystemApi, type FilesystemApiHandle } from '../filesystemAPI'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { SqliteDatabase } from '../db/SqliteDatabase'

describe('filesystemAPI Express REST Integration (Task 5.1 / Boundary A)', () => {
  let testDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let storage: SqliteStorageEngine
  let apiHandle: FilesystemApiHandle
  let baseUrl: string

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `collar-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'test-workspace.cagent')

    db = new SqliteDatabase(dbFilePath)
    storage = new SqliteStorageEngine(db, { cagentPath: dbFilePath })

    apiHandle = await startFilesystemApi({
      port: 0,
      filePath: dbFilePath,
      storageEngine: storage
    })
    baseUrl = `http://127.0.0.1:${apiHandle.port}`
  })

  afterEach(async () => {
    await apiHandle.close()
    await storage.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore directory removal failure
    }
  })

  // ============================================================================
  // API-REQ-01: List Instances Wire Contract
  // ============================================================================
  describe('GET /api/instances (API-REQ-01)', () => {
    it('returns empty instance and project arrays conforming to ListInstancesResponseSchema', async () => {
      const res = await fetch(`${baseUrl}/api/instances`)
      expect(res.status).toBe(200)

      const data = await res.json()
      const parseResult = ListInstancesResponseSchema.safeParse(data)
      expect(parseResult.success).toBe(true)
      expect(data).toEqual({ instances: [], projects: [] })
    })

    it('returns populated instances and projects conforming to ListInstancesResponseSchema', async () => {
      const project = storage.createProject('Project Alpha')
      const instance = storage.createInstance('document', {
        projectId: project.id,
        name: 'Spec Document',
        content: { text: 'Hello CollarAgent' }
      })

      const res = await fetch(`${baseUrl}/api/instances`)
      expect(res.status).toBe(200)

      const data = (await res.json()) as {
        instances: Array<{ id: string; name: string }>
        projects: Array<{ id: string; name: string }>
      }
      const parseResult = ListInstancesResponseSchema.safeParse(data)
      expect(parseResult.success).toBe(true)
      expect(data.instances).toHaveLength(1)
      expect(data.instances[0].id).toBe(instance.id)
      expect(data.instances[0].name).toBe('Spec Document')
      expect(data.projects).toHaveLength(1)
      expect(data.projects[0].id).toBe(project.id)
      expect(data.projects[0].name).toBe('Project Alpha')
    })
  })

  // ============================================================================
  // API-REQ-02: Instance Retrieval & Canonical Payload Property
  // ============================================================================
  describe('GET /api/instances/:id (API-REQ-02)', () => {
    it('returns instance with canonical payload and dual-key content for ws compatibility', async () => {
      const project = storage.createProject('Canvas Project')
      const payloadData = {
        schemaVersion: 1 as const,
        type: 'graph-canvas' as const,
        graph: {
          nodes: {
            n1: { id: 'n1', type: 'card' as const, name: 'Start' }
          },
          relationships: {}
        },
        layout: {
          layoutByNodeId: {
            n1: { x: 0, y: 0, width: 100, height: 100 }
          }
        }
      }
      const instance = storage.createInstance('canvas', {
        projectId: project.id,
        name: 'Process Flow',
        payload: payloadData
      })

      const res = await fetch(`${baseUrl}/api/instances/${instance.id}`)
      expect(res.status).toBe(200)

      const data = (await res.json()) as {
        id: string
        payload: { nodes: Array<{ id: string; label: string }> }
        content: { nodes: Array<{ id: string; label: string }> }
      }
      const parseResult = GetInstanceByIdSchema.safeParse(data)
      expect(parseResult.success).toBe(true)
      expect(data.id).toBe(instance.id)
      expect(data.payload).toEqual(payloadData)
      expect(data.content).toEqual(payloadData)
    })

    it('returns 404 when requesting a non-existent instance id', async () => {
      const missingId = '00000000-0000-0000-0000-000000000000'
      const res = await fetch(`${baseUrl}/api/instances/${missingId}`)
      expect(res.status).toBe(404)

      const data = (await res.json()) as {
        error: { code: string; subsystem: string; message: string }
      }
      expect(data.error.code).toBe(StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND)
      expect(data.error.subsystem).toBe('STORAGE')
    })
  })

  // ============================================================================
  // Instance Mutations (POST, PATCH, DELETE)
  // ============================================================================
  describe('Instance CRUD Operations', () => {
    it('creates an instance via POST /api/instances normalizing payload', async () => {
      const project = storage.createProject('Test Project')
      const res = await fetch(`${baseUrl}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Architecture Doc',
          projectId: project.id,
          type: 'document',
          payload: { text: 'Initial design draft' }
        })
      })

      expect(res.status).toBe(201)
      const created = (await res.json()) as { status: string; id: string }
      expect(created.status).toBe('created')
      expect(created.id).toBeDefined()

      const fetchRes = await fetch(`${baseUrl}/api/instances/${created.id}`)
      const fetched = (await fetchRes.json()) as { name: string; payload: { text: string } }
      expect(fetched.name).toBe('Architecture Doc')
      expect(fetched.payload).toEqual({ text: 'Initial design draft' })
    })

    it('updates instance metadata and payload via PATCH /api/instances/:id', async () => {
      const project = storage.createProject('Test Project')
      const instance = storage.createInstance('document', {
        projectId: project.id,
        name: 'Old Name',
        content: { version: 1 }
      })

      const patchRes = await fetch(`${baseUrl}/api/instances/${instance.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Name',
          payload: { version: 2 }
        })
      })

      expect(patchRes.status).toBe(200)
      const patchData = (await patchRes.json()) as { status: string; id: string }
      expect(patchData.status).toBe('ok')

      const fetchRes = await fetch(`${baseUrl}/api/instances/${instance.id}`)
      const fetched = (await fetchRes.json()) as { name: string; payload: { version: number } }
      expect(fetched.name).toBe('New Name')
      expect(fetched.payload).toEqual({ version: 2 })
    })

    it('deletes an instance via DELETE /api/instances/:id', async () => {
      const project = storage.createProject('Test Project')
      const instance = storage.createInstance('canvas', {
        projectId: project.id,
        name: 'Canvas to Delete'
      })

      const delRes = await fetch(`${baseUrl}/api/instances/${instance.id}`, {
        method: 'DELETE'
      })
      expect(delRes.status).toBe(200)
      const delData = (await delRes.json()) as { status: string; deleted: boolean }
      expect(delData.deleted).toBe(true)

      const checkRes = await fetch(`${baseUrl}/api/instances/${instance.id}`)
      expect(checkRes.status).toBe(404)
    })
  })

  // ============================================================================
  // Project REST Endpoints
  // ============================================================================
  describe('Projects REST API', () => {
    it('creates, lists, updates, and deletes projects', async () => {
      const createRes = await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CollarProject V4' })
      })
      expect(createRes.status).toBe(201)
      const created = (await createRes.json()) as { status: string; id: string }

      const listRes = await fetch(`${baseUrl}/api/projects`)
      const listData = (await listRes.json()) as { projects: Array<{ id: string; name: string }> }
      expect(
        listData.projects.some((p) => p.id === created.id && p.name === 'CollarProject V4')
      ).toBe(true)

      const patchRes = await fetch(`${baseUrl}/api/projects/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CollarProject V4 (Updated)' })
      })
      expect(patchRes.status).toBe(200)

      const delRes = await fetch(`${baseUrl}/api/projects/${created.id}`, {
        method: 'DELETE'
      })
      expect(delRes.status).toBe(200)
    })
  })

  // ============================================================================
  // Chat Sessions & Bounded Pagination (API-REQ-05)
  // ============================================================================
  describe('Chat Sessions & Messaging (API-REQ-05)', () => {
    it('creates messages and paginates using limit and before cursor', async () => {
      const project = storage.createProject('Chat Project')
      const session = storage.createChatSession(project.id, 'Research Chat')

      // Append 5 messages
      for (let i = 1; i <= 5; i++) {
        const postRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: i % 2 === 1 ? 'user' : 'assistant',
            content: `Message ${i}`,
            timestamp: 1000 + i * 10
          })
        })
        expect(postRes.status).toBe(201)
      }

      // Fetch with limit=2 (returns the latest 2 chronologically: Message 4, Message 5)
      const pageRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/messages?limit=2`)
      expect(pageRes.status).toBe(200)
      const pageData = (await pageRes.json()) as {
        messages: Array<{ content: string; timestamp: number }>
      }
      expect(pageData.messages).toHaveLength(2)
      expect(pageData.messages[0].content).toBe('Message 4')
      expect(pageData.messages[1].content).toBe('Message 5')

      // Fetch before Message 4's timestamp
      const beforeCursor = pageData.messages[0].timestamp
      const prevPageRes = await fetch(
        `${baseUrl}/api/chat/sessions/${session.id}/messages?limit=2&before=${beforeCursor}`
      )
      expect(prevPageRes.status).toBe(200)
      const prevData = (await prevPageRes.json()) as {
        messages: Array<{ content: string }>
      }
      expect(prevData.messages).toHaveLength(2)
      expect(prevData.messages[0].content).toBe('Message 2')
      expect(prevData.messages[1].content).toBe('Message 3')
    })

    it('truncates chat session via POST /api/chat/sessions/:id/restore', async () => {
      const project = storage.createProject('Restore Project')
      const session = storage.createChatSession(project.id, 'Branch Chat')

      const msgId1 = 'msg-1'
      const msgId2 = 'msg-2'

      storage.appendChatMessage(session.id, {
        id: msgId1,
        role: 'user',
        content: 'Question 1',
        timestamp: 1000
      })
      storage.appendChatMessage(session.id, {
        id: msgId2,
        role: 'assistant',
        content: 'Answer 1',
        timestamp: 2000
      })

      const restoreRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msgId1 })
      })
      expect(restoreRes.status).toBe(200)

      const sessionRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}`)
      const sessionData = (await sessionRes.json()) as { messages: Array<{ id: string }> }
      expect(sessionData.messages).toHaveLength(1)
      expect(sessionData.messages[0].id).toBe(msgId1)
    })
  })

  // ============================================================================
  // API-REQ-03: Standardized Error Envelope
  // ============================================================================
  describe('Standardized Error Handling (API-REQ-03)', () => {
    it('returns 400 with STORAGE_VALIDATION_FAILED on Zod validation failure', async () => {
      // POST /api/instances without required 'name', 'projectId', and 'type'
      const res = await fetch(`${baseUrl}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      expect(res.status).toBe(400)
      const data = (await res.json()) as {
        error: { code: string; message: string; subsystem: string; details?: unknown }
      }
      expect(data.error).toBeDefined()
      expect(data.error.code).toBe(StorageErrorCode.STORAGE_VALIDATION_FAILED)
      expect(data.error.subsystem).toBe('STORAGE')
      expect(typeof data.error.message).toBe('string')
      expect(data.error.details).toBeDefined()
    })

    it('returns 404 with structured error envelope when session is not found', async () => {
      const res = await fetch(`${baseUrl}/api/chat/sessions/missing-session-uuid`)
      expect(res.status).toBe(404)

      const data = (await res.json()) as {
        error: { code: string; message: string; subsystem: string }
      }
      expect(data.error.code).toBe(StorageErrorCode.STORAGE_SESSION_NOT_FOUND)
      expect(data.error.subsystem).toBe('STORAGE')
      expect(data.error.message).toContain('missing-session-uuid')
    })
  })

  // ============================================================================
  // Revisions & Checkpoint Bundles Endpoints
  // ============================================================================
  describe('Revisions & Checkpoint Bundles', () => {
    it('creates and lists file revisions', async () => {
      const createRes = await fetch(`${baseUrl}/api/checkpoints/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'checkpoint' })
      })
      expect(createRes.status).toBe(201)
      const revision = (await createRes.json()) as { id: string; reason: string }
      expect(revision.id).toBeDefined()
      expect(revision.reason).toBe('checkpoint')

      const listRes = await fetch(`${baseUrl}/api/checkpoints/revisions`)
      expect(listRes.status).toBe(200)
      const listData = (await listRes.json()) as { revisions: Array<{ id: string }> }
      expect(listData.revisions.some((r) => r.id === revision.id)).toBe(true)
    })

    it('puts and gets checkpoint bundle', async () => {
      const bundleId = 'bundle-12345'
      const putRes = await fetch(`${baseUrl}/api/checkpoints/bundles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleId,
          createdAt: new Date().toISOString(),
          sessionId: 'session-1',
          threadId: 'thread-1',
          chat: { messageId: 'msg-1' },
          instances: []
        })
      })
      expect(putRes.status).toBe(201)

      const getRes = await fetch(`${baseUrl}/api/checkpoints/bundles/${bundleId}`)
      expect(getRes.status).toBe(200)
      const bundleData = (await getRes.json()) as { id: string; threadId: string }
      expect(bundleData.id).toBe(bundleId)
      expect(bundleData.threadId).toBe('thread-1')
    })

    it('POST /api/checkpoints/restore clears chat session when messageId is __start__', async () => {
      const project = storage.createProject('Restore Start Project')
      const session = storage.createChatSession(project.id, 'Start Test Session')
      storage.appendChatMessage(session.id, {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: 1000
      })
      storage.appendChatMessage(session.id, {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: 2000
      })

      const bundleId = 'bundle-start-sentinel'
      const putRes = await fetch(`${baseUrl}/api/checkpoints/bundles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleId,
          createdAt: new Date().toISOString(),
          sessionId: session.id,
          threadId: session.id,
          chat: { messageId: '__start__' },
          instances: []
        })
      })
      expect(putRes.status).toBe(201)

      const restoreRes = await fetch(`${baseUrl}/api/checkpoints/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundleId,
          sessionId: session.id,
          threadId: session.id
        })
      })
      expect(restoreRes.status).toBe(200)

      const sessionRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}`)
      const sessionData = (await sessionRes.json()) as { messages: Array<{ id: string }> }
      expect(sessionData.messages).toHaveLength(0)
    })

    it('POST /api/checkpoints/restore truncates chat session when messageId is a regular message', async () => {
      const project = storage.createProject('Restore Truncate Project')
      const session = storage.createChatSession(project.id, 'Truncate Test Session')
      storage.appendChatMessage(session.id, {
        id: 'msg-t1',
        role: 'user',
        content: 'Question 1',
        timestamp: 1000
      })
      storage.appendChatMessage(session.id, {
        id: 'msg-t2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: 2000
      })

      const bundleId = 'bundle-truncate'
      const putRes = await fetch(`${baseUrl}/api/checkpoints/bundles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleId,
          createdAt: new Date().toISOString(),
          sessionId: session.id,
          threadId: session.id,
          chat: { messageId: 'msg-t1' },
          instances: []
        })
      })
      expect(putRes.status).toBe(201)

      const restoreRes = await fetch(`${baseUrl}/api/checkpoints/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bundleId,
          sessionId: session.id,
          threadId: session.id
        })
      })
      expect(restoreRes.status).toBe(200)

      const sessionRes = await fetch(`${baseUrl}/api/chat/sessions/${session.id}`)
      const sessionData = (await sessionRes.json()) as { messages: Array<{ id: string }> }
      expect(sessionData.messages).toHaveLength(1)
      expect(sessionData.messages[0].id).toBe('msg-t1')
    })

    it('filters checkpoint bundles by projectId query parameter', async () => {
      const projectA = storage.createProject('Project A')
      const projectB = storage.createProject('Project B')

      const bundleA = 'bundle-proj-a'
      const bundleB = 'bundle-proj-b'

      await fetch(`${baseUrl}/api/checkpoints/bundles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleA,
          createdAt: new Date().toISOString(),
          sessionId: 's-a',
          threadId: 't-a',
          projectId: projectA.id,
          chat: { messageId: '__start__' },
          instances: []
        })
      })

      await fetch(`${baseUrl}/api/checkpoints/bundles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleB,
          createdAt: new Date().toISOString(),
          sessionId: 's-b',
          threadId: 't-b',
          projectId: projectB.id,
          chat: { messageId: '__start__' },
          instances: []
        })
      })

      const resA = await fetch(`${baseUrl}/api/checkpoints/bundles?projectId=${projectA.id}`)
      expect(resA.status).toBe(200)
      const dataA = (await resA.json()) as { bundles: Array<{ id: string; projectId?: string }> }
      expect(dataA.bundles.some((b) => b.id === bundleA)).toBe(true)
      expect(dataA.bundles.some((b) => b.id === bundleB)).toBe(false)
    })
  })
})
