import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { startWsServer, type WsServerHandle } from '../ws-server'
import { startFilesystemApi, type FilesystemApiHandle } from '../../fileServer/filesystemAPI'
import { SqliteStorageEngine } from '../../fileServer/SqliteStorageEngine'
import { SqliteDatabase } from '../../fileServer/db/SqliteDatabase'
import { DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID } from '@shared/constants'
import type { RelationalLedgerEntry } from '@shared/wiki'

describe('WsServer Relational Ledger Isolation & Persistence (P0 & P1)', () => {
  let testDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let storage: SqliteStorageEngine
  let apiHandle: FilesystemApiHandle
  let apiBaseUrl: string

  beforeEach(async () => {
    testDir = path.join(
      os.tmpdir(),
      `collar-ws-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
  })

  afterEach(async () => {
    await apiHandle.close()
    await storage.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  it('P0: guarantees two distinct WsServer instances have isolated in-memory ledger stores', async () => {
    const ws1: WsServerHandle = await startWsServer({ port: 0, apiBaseUrl })
    const ws2: WsServerHandle = await startWsServer({ port: 0, apiBaseUrl })

    try {
      const edge1: RelationalLedgerEntry = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        sourceEntityId: 'project-a-doc',
        targetEntityId: 'concept-1',
        rel: 'details',
        provenance: 'canvas_relational',
        status: 'active',
        meta: {
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
          author: 'user'
        }
      }

      ws1.ledgerStore.upsertEdge(edge1)

      expect(ws1.ledgerStore.getAllEdges()).toHaveLength(1)
      expect(ws1.ledgerStore.getEdge(edge1.id)).toBeDefined()

      // Server 2 must remain completely unaffected by Server 1's ledger mutations
      expect(ws2.ledgerStore.getAllEdges()).toHaveLength(0)
      expect(ws2.ledgerStore.getEdge(edge1.id)).toBeUndefined()
    } finally {
      await ws1.close()
      await ws2.close()
    }
  })

  it('P1: persists relational ledger to disk via POST on initial creation and PATCH on subsequent updates', async () => {
    const project = storage.createProject('Test Project')
    const ws: WsServerHandle = await startWsServer({ port: 0, apiBaseUrl })

    try {
      const edge1: RelationalLedgerEntry = {
        id: '550e8400-e29b-41d4-a716-446655440011',
        sourceEntityId: 'doc-alpha',
        targetEntityId: 'claim-beta',
        rel: 'supports',
        provenance: 'document_claim',
        anchor: {
          blockId: 'blk-001',
          justification: 'alpha supports beta'
        },
        status: 'active',
        meta: {
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
          author: 'user'
        }
      }

      ws.ledgerStore.upsertEdge(edge1)

      // Trigger flush which executes persistLedgerToApi
      await ws.flush(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)

      // Verify the instance exists in the file API
      const getRes = await fetch(`${apiBaseUrl}/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`)
      expect(getRes.status).toBe(200)

      const instanceData = (await getRes.json()) as {
        id: string
        projectId: string
        type: string
        payload?: { edges?: RelationalLedgerEntry[] }
        content?: { edges?: RelationalLedgerEntry[] }
      }

      expect(instanceData.id).toBe(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)
      expect(instanceData.projectId).toBe(project.id)
      expect(instanceData.type).toBe('ledger')

      const savedEdges = instanceData.payload?.edges ?? instanceData.content?.edges
      expect(savedEdges).toHaveLength(1)
      expect(savedEdges?.[0].id).toBe(edge1.id)

      // Test subsequent update (PATCH path)
      const edge2: RelationalLedgerEntry = {
        id: '550e8400-e29b-41d4-a716-446655440022',
        sourceEntityId: 'doc-gamma',
        targetEntityId: 'claim-delta',
        rel: 'derived_from',
        provenance: 'document_claim',
        anchor: {
          blockId: 'blk-002',
          justification: 'gamma derived from delta'
        },
        status: 'active',
        meta: {
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:00:00.000Z',
          author: 'user'
        }
      }

      ws.ledgerStore.upsertEdge(edge2)
      await ws.flush(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)

      const getRes2 = await fetch(`${apiBaseUrl}/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`)
      expect(getRes2.status).toBe(200)
      const instanceData2 = (await getRes2.json()) as {
        payload?: { edges?: RelationalLedgerEntry[] }
        content?: { edges?: RelationalLedgerEntry[] }
      }
      const updatedEdges = instanceData2.payload?.edges ?? instanceData2.content?.edges
      expect(updatedEdges).toHaveLength(2)

      // Test startup hydration on a fresh WsServer instance pointing at the same project
      const wsNew = await startWsServer({ port: 0, apiBaseUrl })
      try {
        // Await deterministic flush to guarantee initial async hydration has completed
        await wsNew.flush(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID)
        expect(wsNew.ledgerStore.getAllEdges()).toHaveLength(2)
        expect(wsNew.ledgerStore.getEdge(edge1.id)).toBeDefined()
        expect(wsNew.ledgerStore.getEdge(edge2.id)).toBeDefined()
      } finally {
        await wsNew.close()
      }
    } finally {
      await ws.close()
    }
  })
})
