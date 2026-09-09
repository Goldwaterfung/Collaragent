import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { unpack } from 'msgpackr'

import { startWsServer, type WsServerHandle } from '@main/server/ws/ws-server'
import { startFilesystemApi, type FilesystemApiHandle } from '@main/server/fileServer/filesystemAPI'
import { SqliteStorageEngine } from '@main/server/fileServer/SqliteStorageEngine'
import { SqliteDatabase } from '@main/server/fileServer/db/SqliteDatabase'
import { DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID } from '@shared/constants'
import { LiveWikiWorkspaceAdapter } from '../adapters'
import { runL1Audit } from '@workspace/wiki/L1StructuralLinter'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { RelationalLedgerEntry } from '@shared/wiki'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

describe('Read-After-Write Consistency with Transactional Read Barriers (Phase 3)', () => {
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
      `collar-read-safety-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
      } catch {
        // Ignore close error
      }
    }
    openSockets.length = 0

    await wsServer.close()
    await apiHandle.close()
    await storage.close()

    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore removal error
    }
  })

  function createConnectedClient(endpointPath = '/ws/editor-content'): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${wsServer.port}${endpointPath}`)
      socket.once('open', () => {
        openSockets.push(socket)
        resolve(socket)
      })
      socket.once('error', reject)
    })
  }

  function waitForMessage<T extends Record<string, unknown>>(
    socket: WebSocket,
    predicate: (msg: T) => boolean
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString()
          const parsed = JSON.parse(raw) as T
          if (predicate(parsed)) {
            socket.off('message', onMessage)
            resolve(parsed)
          }
        } catch {
          // Ignore parse error
        }
      }
      socket.on('message', onMessage)
    })
  }

  function waitForDrainTrigger(instanceId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const unsub = wsServer.drainQueue?.on((e) => {
        if (
          e.instanceId === instanceId &&
          (e.type === 'drain:started' || e.type === 'drain:coalesced')
        ) {
          unsub?.()
          resolve()
        }
      })
    })
  }

  it('P0: Over-the-wire WebSocket client sends { type: "flush" } and receives { type: "flush-ack" }', async () => {
    const client = await createConnectedClient('/ws/editor-content')
    const flushId = 'test-barrier-uuid-001'

    const ackPromise = waitForMessage<{ type: string; flushId: string }>(
      client,
      (msg) => msg.type === 'flush-ack' && msg.flushId === flushId
    )

    client.send(
      JSON.stringify({
        type: 'flush',
        flushId
      })
    )

    const ack = await ackPromise
    expect(ack.type).toBe('flush-ack')
    expect(ack.flushId).toBe(flushId)
  })

  it('P0: Over-the-wire WebSocket client sends instance-scoped flush and receives flush-ack', async () => {
    const client = await createConnectedClient('/ws/editor-content')
    const flushId = 'test-barrier-uuid-002'

    const ackPromise = waitForMessage<{ type: string; flushId: string }>(
      client,
      (msg) => msg.type === 'flush-ack' && msg.flushId === flushId
    )

    client.send(
      JSON.stringify({
        type: 'flush',
        instanceId: DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
        flushId
      })
    )

    const ack = await ackPromise
    expect(ack.type).toBe('flush-ack')
    expect(ack.flushId).toBe(flushId)
  })

  it('P0: Read-after-write consistency: rapid updates with claims -> loadLedger({ flushBeforeRead: true }) returns 100% fresh data with 0 sleep', async () => {
    const project = storage.createProject('Quantum Research')
    const initialDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-0',
          type: 'paragraph',
          children: [{ text: 'Initial abstract draft without claims.' }]
        }
      ]
    }

    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Quantum Computing',
      payload: initialDoc
    })

    const client = await createConnectedClient(`/ws/editor/${instance.id}`)

    const adapter = new LiveWikiWorkspaceAdapter({
      apiPort: apiHandle.port,
      wsPort: wsServer.port,
      wsHandle: { flush: (id, opts) => wsServer.flush(id, opts) }
    })

    // Rapid sequential edits simulating continuous keystrokes and claim additions
    const updatedDoc1: DocumentPayload = {
      blocks: [
        {
          id: 'blk-1',
          type: 'paragraph',
          children: [{ text: 'Draft revision 1' }]
        }
      ]
    }

    const finalDocWithClaims: DocumentPayload = {
      blocks: [
        {
          id: 'blk-1',
          type: 'paragraph',
          children: [
            { text: 'Quantum algorithms such as ' },
            {
              text: '',
              claimBadge: {
                badgeId: 'b-shor',
                targetEntityId: 'shors-algorithm',
                rel: 'supports',
                justification: 'Achieves polynomial time integer factorization'
              }
            },
            { text: ' demonstrate significant speedup.' }
          ]
        },
        {
          id: 'blk-2',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-rsa',
                targetEntityId: 'classical-rsa',
                rel: 'supersedes',
                justification: 'Undermines asymmetric encryption security'
              }
            }
          ]
        }
      ]
    }

    // Set up drain listener to ensure the write is in-flight before read barrier
    const writeTriggered = waitForDrainTrigger(instance.id)

    // Fire rapid updates into WebSocket
    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'author-session',
        payload: updatedDoc1
      })
    )

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'author-session',
        payload: finalDocWithClaims
      })
    )

    // Await message receipt and active in-flight drain cycle
    await writeTriggered

    // Tool executes immediately: zero sleep, zero setTimeout!
    const loadedStore = await adapter.loadLedger({ flushBeforeRead: true })

    // Assert that the ledger store returned has the fresh claims
    const edges = loadedStore.getAllEdges()
    expect(edges.length).toBeGreaterThanOrEqual(2)

    const shorEdge = edges.find((e) => e.targetEntityId === 'shors-algorithm')
    expect(shorEdge).toBeDefined()
    expect(shorEdge?.rel).toBe('supports')
    expect(shorEdge?.provenance).toBe('document_claim')

    const rsaEdge = edges.find((e) => e.targetEntityId === 'classical-rsa')
    expect(rsaEdge).toBeDefined()
    expect(rsaEdge?.rel).toBe('supersedes')

    // Verify that SQLite disk storage is also 100% consistent
    const diskContentBuf = storage.getInstanceContent(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)
    expect(diskContentBuf).not.toBeNull()
    const diskPayload = diskContentBuf
      ? (unpack(diskContentBuf) as { edges?: RelationalLedgerEntry[] })
      : null

    expect(diskPayload?.edges?.some((e) => e.targetEntityId === 'shors-algorithm')).toBe(true)
    expect(diskPayload?.edges?.some((e) => e.targetEntityId === 'classical-rsa')).toBe(true)
  })

  it('P0: Read-after-write consistency using over-the-wire WebSocket flush (no in-memory wsHandle)', async () => {
    const project = storage.createProject('Distributed Wiki Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Search Algorithms',
      payload: { blocks: [] }
    })

    const client = await createConnectedClient(`/ws/editor/${instance.id}`)

    // Adapter without wsHandle - must perform flush over raw WebSocket connection
    const remoteAdapter = new LiveWikiWorkspaceAdapter({
      apiPort: apiHandle.port,
      wsPort: wsServer.port
    })

    const docWithGrover: DocumentPayload = {
      blocks: [
        {
          id: 'blk-g1',
          type: 'paragraph',
          children: [
            { text: 'Search algorithms: ' },
            {
              text: '',
              claimBadge: {
                badgeId: 'b-grover',
                targetEntityId: 'grovers-algorithm',
                rel: 'supports',
                justification: 'Quadratic speedup in database search'
              }
            }
          ]
        }
      ]
    }

    const writeTriggered = waitForDrainTrigger(instance.id)

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'author-session',
        payload: docWithGrover
      })
    )

    await writeTriggered

    // Flush over the wire and query ledger
    const loadedStore = await remoteAdapter.loadLedger({ flushBeforeRead: true })
    const edges = loadedStore.getAllEdges()

    expect(edges.some((e) => e.targetEntityId === 'grovers-algorithm')).toBe(true)
  })

  it('P0: Pre-audit barrier in runL1Audit guarantees fresh graph analysis without sleep', async () => {
    const project = storage.createProject('Audit Project')
    const instance = storage.createInstance('document', {
      projectId: project.id,
      name: 'Neural Networks',
      payload: { blocks: [] }
    })

    const client = await createConnectedClient(`/ws/editor/${instance.id}`)

    const adapter = new LiveWikiWorkspaceAdapter({
      apiPort: apiHandle.port,
      wsPort: wsServer.port,
      wsHandle: { flush: (id, opts) => wsServer.flush(id, opts) }
    })

    const docWithClaim: DocumentPayload = {
      blocks: [
        {
          id: 'blk-nn1',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-bp',
                targetEntityId: 'missing-backpropagation-target',
                rel: 'derived_from',
                justification: 'Gradient optimization'
              }
            }
          ]
        }
      ]
    }

    const writeTriggered = waitForDrainTrigger(instance.id)

    client.send(
      JSON.stringify({
        type: 'update',
        instanceId: instance.id,
        clientId: 'author-session',
        payload: docWithClaim
      })
    )

    await writeTriggered

    // Execute L1 structural audit immediately with flushBeforeAudit: true (default)
    const auditResult = await runL1Audit(adapter, { flushBeforeAudit: true })
    expect(auditResult).toBeDefined()
    expect(Array.isArray(auditResult.errors)).toBe(true)
    expect(Array.isArray(auditResult.warnings)).toBe(true)
    expect(auditResult.valid).toBe(false)
    expect(
      auditResult.errors.some(
        (err) => err.code === WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL
      )
    ).toBe(true)
  })
})
