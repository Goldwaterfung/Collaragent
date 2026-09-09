import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { unpack } from 'msgpackr'

import { startWsServer, type WsServerHandle } from '../ws-server'
import { startFilesystemApi, type FilesystemApiHandle } from '../../fileServer/filesystemAPI'
import { SqliteStorageEngine } from '../../fileServer/SqliteStorageEngine'
import { SqliteDatabase } from '../../fileServer/db/SqliteDatabase'
import { DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID } from '@shared/constants'
import type { RelationalLedgerEntry } from '@shared/wiki'

describe('WsServer Event-Driven Persistence & Drain Queue (P0)', () => {
  let testDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let storage: SqliteStorageEngine
  let apiHandle: FilesystemApiHandle
  let apiBaseUrl: string
  let wsServer: WsServerHandle
  const openSockets: WebSocket[] = []

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `collar-ws-persistence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
    apiBaseUrl = `http://127.0.0.1:${apiHandle.port}/api/instances`

    wsServer = await startWsServer({
      port: 0,
      apiBaseUrl
    })
  })

  afterEach(async () => {
    for (const socket of openSockets) {
      try {
        socket.close()
      } catch {
        // ignore socket close errors
      }
    }
    openSockets.length = 0

    await wsServer.close()
    await apiHandle.close()
    await storage.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  function createConnectedClient(instanceId: string): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${wsServer.port}/ws/editor/${instanceId}`)
      socket.once('open', () => {
        openSockets.push(socket)
        resolve(socket)
      })
      socket.once('error', reject)
    })
  }

  it('P0: flushes document updates deterministically to SQLite disk via transactional barrier', async () => {
    const project = storage.createProject('Persistence Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Test Doc',
      payload: { blocks: [{ id: 'b0', type: 'paragraph', content: 'Initial Content' }] }
    })

    const client = await createConnectedClient(instance.id)

    const drainCompleted = new Promise<void>((resolve) => {
      const unsub = wsServer.drainQueue?.on((e) => {
        if (e.type === 'drain:completed' && e.instanceId === instance.id) {
          unsub?.()
          resolve()
        }
      })
    })

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'ui-client-1',
        payload: {
          blocks: [{ id: 'b0', type: 'paragraph', content: 'Event-Driven Persisted Content' }]
        }
      })
    )

    // Await write completion and transactional barrier
    await drainCompleted
    await wsServer.flush(instance.id)

    const diskContentBuf = storage.getInstanceContent(instance.id)
    expect(diskContentBuf).not.toBeNull()
    const diskPayload = diskContentBuf
      ? (unpack(diskContentBuf) as { blocks?: Array<{ id: string; content?: string }> })
      : null

    expect(diskPayload).toBeDefined()
    expect(diskPayload?.blocks?.[0]?.content).toBe('Event-Driven Persisted Content')
  })

  it('P0: coalesces rapid burst keystrokes and flushes the final document snapshot', async () => {
    const project = storage.createProject('Burst Coalescing Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Burst Doc',
      payload: { blocks: [{ id: 'b0', type: 'paragraph', content: 'v0' }] }
    })

    const client = await createConnectedClient(instance.id)

    // Wait until the final update has settled on disk
    const finalUpdateCompleted = new Promise<void>((resolve) => {
      const unsub = wsServer.drainQueue?.on((e) => {
        if (e.type === 'drain:completed' && e.instanceId === instance.id) {
          const buf = storage.getInstanceContent(instance.id)
          if (buf) {
            const payload = unpack(buf) as { blocks?: Array<{ content?: string }> }
            if (payload.blocks?.[0]?.content === 'Keystroke edit 10') {
              unsub?.()
              resolve()
            }
          }
        }
      })
    })

    // Send 10 rapid updates without waiting
    for (let i = 1; i <= 10; i++) {
      client.send(
        JSON.stringify({
          type: 'update',
          instanceId: instance.id,
          clientId: 'ui-client-typing',
          payload: {
            blocks: [{ id: 'b0', type: 'paragraph', content: `Keystroke edit ${i}` }]
          }
        })
      )
    }

    await finalUpdateCompleted
    await wsServer.flush(instance.id)

    const diskContentBuf = storage.getInstanceContent(instance.id)
    expect(diskContentBuf).not.toBeNull()
    const diskPayload = diskContentBuf
      ? (unpack(diskContentBuf) as { blocks?: Array<{ id: string; content?: string }> })
      : null

    expect(diskPayload?.blocks?.[0]?.content).toBe('Keystroke edit 10')
    expect(wsServer.drainQueue?.getState(instance.id)).toBe('IDLE')
  })

  it('P0: evicts instance worker cleanly from drainQueue on instance deletion', async () => {
    const project = storage.createProject('Eviction Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Doomed Doc',
      payload: { blocks: [{ id: 'b1', type: 'paragraph', content: 'temporary' }] }
    })

    const client = await createConnectedClient(instance.id)

    const drainCompleted = new Promise<void>((resolve) => {
      const unsub = wsServer.drainQueue?.on((e) => {
        if (e.type === 'drain:completed' && e.instanceId === instance.id) {
          unsub?.()
          resolve()
        }
      })
    })

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'ui-client',
        payload: {
          blocks: [{ id: 'b1', type: 'paragraph', content: 'pre-delete edit' }]
        }
      })
    )

    await drainCompleted
    await wsServer.flush(instance.id)
    expect(wsServer.drainQueue?.hasWorker(instance.id)).toBe(true)
    expect(wsServer.drainQueue?.getState(instance.id)).toBe('IDLE')

    // Prepare to listen for broadcast sync sent on deletion
    const deleteReceived = new Promise<void>((resolve) => {
      const handler = (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string; from?: string }
          if (msg.type === 'sync-snapshot' && msg.from === 'ui-client') {
            client.off('message', handler)
            resolve()
          }
        } catch {
          // ignore parse errors
        }
      }
      client.on('message', handler)
    })

    // Client requests instance deletion
    client.send(
      JSON.stringify({
        type: 'delete',
        instanceId: instance.id,
        clientId: 'ui-client'
      })
    )

    await deleteReceived

    // Worker must be evicted from the drain queue
    expect(wsServer.drainQueue?.hasWorker(instance.id)).toBe(false)
    expect(wsServer.drainQueue?.getState(instance.id)).toBe('IDLE')
  })

  it('P0: guarantees zero data loss on wsServer.close() with unflushed mutations', async () => {
    const project = storage.createProject('Shutdown Flush Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Shutdown Doc',
      payload: { blocks: [{ id: 'b1', type: 'paragraph', content: 'before close' }] }
    })

    const client = await createConnectedClient(instance.id)

    // Wait for the mutation trigger to enter the drain queue before calling close()
    const drainStarted = new Promise<void>((resolve) => {
      const unsub = wsServer.drainQueue?.on((e) => {
        if (
          (e.type === 'drain:started' || e.type === 'drain:coalesced') &&
          e.instanceId === instance.id
        ) {
          unsub?.()
          resolve()
        }
      })
    })

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'ui-client',
        payload: {
          blocks: [
            { id: 'b1', type: 'paragraph', content: 'Critical final change before shutdown' }
          ]
        }
      })
    )

    await drainStarted

    // Close wsServer immediately without explicit flush() call
    await wsServer.close()

    const diskContentBuf = storage.getInstanceContent(instance.id)
    expect(diskContentBuf).not.toBeNull()
    const diskPayload = diskContentBuf
      ? (unpack(diskContentBuf) as { blocks?: Array<{ id: string; content?: string }> })
      : null

    expect(diskPayload?.blocks?.[0]?.content).toBe('Critical final change before shutdown')
  })

  it('P0: flushes relational ledger mutations via flush() without temporal timers', async () => {
    storage.createProject('Ledger Persistence Project')

    const edge: RelationalLedgerEntry = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      sourceEntityId: 'doc-alpha',
      targetEntityId: 'doc-beta',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      meta: {
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        author: 'user'
      }
    }

    wsServer.ledgerStore.upsertEdge(edge)

    // Flush ledger instance barrier
    await wsServer.flush(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)

    const diskContentBuf = storage.getInstanceContent(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)
    expect(diskContentBuf).not.toBeNull()
    const diskPayload = diskContentBuf
      ? (unpack(diskContentBuf) as { edges?: RelationalLedgerEntry[] })
      : null

    expect(diskPayload?.edges).toBeDefined()
    expect(diskPayload?.edges?.some((e) => e.id === edge.id)).toBe(true)
  })
})
