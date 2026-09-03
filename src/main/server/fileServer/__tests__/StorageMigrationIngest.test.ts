import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pack, unpack } from 'msgpackr'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StorageMigrationEngine } from '../StorageMigrationEngine'
import { SqliteDatabase } from '../db/SqliteDatabase'

describe('StorageMigrationEngine - Staging Ingestion (Task 4.2)', () => {
  let testDir: string
  let workspaceDir: string
  let stagingDbPath: string
  let stagingDb: SqliteDatabase
  let engine: StorageMigrationEngine

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-migrate-ingest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    workspaceDir = path.join(testDir, 'source-workspace')
    stagingDbPath = path.join(testDir, 'test.cagent.tmp')

    fs.mkdirSync(workspaceDir, { recursive: true })
    stagingDb = new SqliteDatabase(stagingDbPath, { autoMigrate: true })
    engine = new StorageMigrationEngine()
  })

  afterEach(() => {
    try {
      if (stagingDb.isOpen) {
        stagingDb.close()
      }
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore teardown errors
    }
  })

  it('ingests all V3 entities transactionally into SQLite staging database', () => {
    // 1. Setup manifest.json
    const manifest = {
      header: { magic: 'CAGENT', version: 3 },
      projects: {
        'proj-1': {
          id: 'proj-1',
          name: 'Quantum Analysis',
          metadata: { discipline: 'physics' },
          createdAt: 1700000000000,
          updatedAt: 1700000001000
        }
      },
      instances: {
        'doc-1': {
          id: 'doc-1',
          projectId: 'proj-1',
          type: 'document',
          name: 'Paper Draft',
          metadata: { status: 'draft' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        'canvas-1': {
          id: 'canvas-1',
          projectId: 'proj-1',
          type: 'canvas',
          name: 'Concept Map',
          metadata: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }
    fs.writeFileSync(path.join(workspaceDir, 'manifest.json'), JSON.stringify(manifest))

    // 2. Setup instances content BLOBs
    const docPayload = { root: { children: [{ text: 'Quantum entanglement notes' }] } }
    const canvasPayload = { nodes: [{ id: 'n1', x: 100, y: 250, label: 'Node 1' }], edges: [] }

    const docDir = path.join(workspaceDir, 'instances', 'doc-1')
    const canvasDir = path.join(workspaceDir, 'instances', 'canvas-1')
    fs.mkdirSync(docDir, { recursive: true })
    fs.mkdirSync(canvasDir, { recursive: true })

    fs.writeFileSync(path.join(docDir, 'content.msgpack'), pack(docPayload))
    fs.writeFileSync(path.join(canvasDir, 'content.msgpack'), pack(canvasPayload))

    // 3. Setup state.json with chat, snapshots, logs, and revisions
    const snapRef = 'sha256-abc123.msgpack'
    const state = {
      chat: {
        sessions: {
          'sess-1': {
            id: 'sess-1',
            projectId: 'proj-1',
            title: 'Research Session',
            createdAt: 1700000002000,
            updatedAt: 1700000005000,
            messages: [
              {
                id: 'msg-1',
                role: 'user',
                content: 'Derive Bell inequality',
                timestamp: 1700000003000
              },
              {
                id: 'msg-2',
                role: 'assistant',
                content: 'Here is the step-by-step derivation...',
                timestamp: 1700000004000
              }
            ]
          }
        }
      },
      workspaceSnapshots: [
        {
          id: 'snap-1',
          instanceId: 'doc-1',
          projectId: 'proj-1',
          instanceType: 'document',
          snapshotRef: snapRef,
          snapshotHash: 'abc123hash',
          snapshotCursor: { seq: 1 },
          createdAt: '2026-01-01T01:00:00.000Z'
        }
      ],
      workspaceLogs: {
        byInstanceId: {
          'doc-1': [
            {
              commandId: 'cmd-1',
              commandType: 'insert',
              payload: { text: 'Initial word' },
              timestamp: 1700000002500
            }
          ]
        }
      },
      fileRevisions: [
        {
          id: 'rev-1',
          name: 'Milestone 1',
          description: 'Ready for peer review',
          snapshotRef: snapRef,
          createdAt: '2026-01-01T02:00:00.000Z'
        }
      ]
    }
    fs.writeFileSync(path.join(workspaceDir, 'state.json'), JSON.stringify(state))

    // Snapshot BLOB file
    const snapDir = path.join(workspaceDir, 'data', 'workspace')
    fs.mkdirSync(snapDir, { recursive: true })
    fs.writeFileSync(
      path.join(snapDir, snapRef),
      pack({ snapshotData: 'Milestone snapshot payload' })
    )

    // 4. Setup LangGraph Checkpoints
    const cpDir = path.join(workspaceDir, 'checkpoints', 'threads', 'sess-1', 'checkpoints')
    fs.mkdirSync(cpDir, { recursive: true })
    const cpRecord = {
      thread_id: 'sess-1',
      checkpoint_ns: '',
      checkpoint_id: 'cp-001',
      parent_checkpoint_id: null,
      checkpoint: { values: { summary: 'quantum physics' } },
      metadata: { step: 1 },
      created_at: 1700000003500
    }
    fs.writeFileSync(path.join(cpDir, 'cp-001.json'), JSON.stringify(cpRecord))

    // 5. Setup LangGraph Blobs
    const blobsDir = path.join(workspaceDir, 'checkpoints', 'blobs')
    fs.mkdirSync(blobsDir, { recursive: true })
    const blobKey = 'sess-1::channel_state:1.0'
    const encodedBlobName = Buffer.from(blobKey).toString('base64url')
    const blobRecord = {
      thread_id: 'sess-1',
      checkpoint_ns: '',
      channel: 'channel_state',
      version: '1.0',
      type: 'json',
      blob: { score: 98 },
      serialized: false
    }
    fs.writeFileSync(path.join(blobsDir, `${encodedBlobName}.json`), JSON.stringify(blobRecord))

    // 6. Setup LangGraph Writes
    const writesDir = path.join(workspaceDir, 'checkpoints', 'threads', 'sess-1', 'writes')
    fs.mkdirSync(writesDir, { recursive: true })
    const writeRecord = {
      thread_id: 'sess-1',
      checkpoint_ns: '',
      checkpoint_id: 'cp-001',
      task_id: 'task-100',
      idx: 0,
      channel: 'channel_state',
      type: 'json',
      blob: { result: 'computed' }
    }
    fs.writeFileSync(path.join(writesDir, 'cp-001_task-100_0.json'), JSON.stringify(writeRecord))

    // 7. Setup LangGraph Restore Heads
    const manifestsDir = path.join(workspaceDir, 'checkpoints', 'manifests')
    fs.mkdirSync(manifestsDir, { recursive: true })
    fs.writeFileSync(
      path.join(manifestsDir, 'restore-heads.json'),
      JSON.stringify({ 'sess-1:': 'cp-001' })
    )

    // Execute ingestion
    const stats = engine.ingestStaging(stagingDb, workspaceDir)

    expect(stats.artifactsMigrated).toBeGreaterThanOrEqual(10)
    expect(stats.instanceCount).toBe(2)
    expect(stats.checkpointCount).toBe(1)

    // Assert Projects
    const projects = stagingDb.prepare('SELECT * FROM projects').all() as Array<
      Record<string, unknown>
    >
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('proj-1')
    expect(projects[0].name).toBe('Quantum Analysis')

    // Assert Instances & MessagePack BLOB preservation
    const instances = stagingDb.prepare('SELECT * FROM instances ORDER BY id ASC').all() as Array<
      Record<string, unknown>
    >
    expect(instances).toHaveLength(2)

    const canvasRow = instances.find((i) => i.id === 'canvas-1')
    expect(canvasRow).toBeDefined()
    expect(canvasRow?.type).toBe('canvas')
    expect(unpack(canvasRow?.content_msgpack as Buffer)).toEqual(canvasPayload)

    const docRow = instances.find((i) => i.id === 'doc-1')
    expect(docRow).toBeDefined()
    expect(docRow?.type).toBe('document')
    expect(unpack(docRow?.content_msgpack as Buffer)).toEqual(docPayload)

    // Assert Chat Sessions & Messages
    const sessions = stagingDb.prepare('SELECT * FROM chat_sessions').all() as Array<
      Record<string, unknown>
    >
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-1')
    expect(sessions[0].title).toBe('Research Session')

    const messages = stagingDb
      .prepare('SELECT * FROM chat_messages ORDER BY timestamp ASC')
      .all() as Array<Record<string, unknown>>
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Derive Bell inequality')
    expect(messages[1].role).toBe('assistant')

    // Assert Checkpoints
    const checkpoints = stagingDb.prepare('SELECT * FROM langgraph_checkpoints').all() as Array<
      Record<string, unknown>
    >
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0].thread_id).toBe('sess-1')
    expect(checkpoints[0].checkpoint_id).toBe('cp-001')

    // Assert Blobs
    const blobs = stagingDb.prepare('SELECT * FROM langgraph_blobs').all() as Array<
      Record<string, unknown>
    >
    expect(blobs).toHaveLength(1)
    expect(blobs[0].thread_id).toBe('sess-1')
    expect(blobs[0].channel).toBe('channel_state')
    expect(JSON.parse((blobs[0].data_blob as Buffer).toString('utf8'))).toEqual({ score: 98 })

    // Assert Writes
    const writes = stagingDb.prepare('SELECT * FROM langgraph_writes').all() as Array<
      Record<string, unknown>
    >
    expect(writes).toHaveLength(1)
    expect(writes[0].task_id).toBe('task-100')

    // Assert Restore Heads
    const heads = stagingDb.prepare('SELECT * FROM langgraph_restore_heads').all() as Array<
      Record<string, unknown>
    >
    expect(heads).toHaveLength(1)
    expect(heads[0].checkpoint_id).toBe('cp-001')

    // Assert Snapshots
    const snapshots = stagingDb.prepare('SELECT * FROM workspace_snapshots').all() as Array<
      Record<string, unknown>
    >
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].snapshot_ref).toBe(snapRef)
    expect(unpack(snapshots[0].snapshot_msgpack as Buffer)).toEqual({
      snapshotData: 'Milestone snapshot payload'
    })

    // Assert Command Logs
    const logs = stagingDb.prepare('SELECT * FROM workspace_command_logs').all() as Array<
      Record<string, unknown>
    >
    expect(logs).toHaveLength(1)
    expect(logs[0].command_type).toBe('insert')

    // Assert File Revisions
    const revisions = stagingDb.prepare('SELECT * FROM file_revisions').all() as Array<
      Record<string, unknown>
    >
    expect(revisions).toHaveLength(1)
    expect(revisions[0].name).toBe('Milestone 1')

    // Assert user_version PRAGMA
    expect(stagingDb.getUserVersion()).toBe(4)
  })
})
