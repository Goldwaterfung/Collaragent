import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { pack, unpack } from 'msgpackr'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  StorageMigrationEngine,
  detectStorageFormat,
  type MigrationProgress
} from '../StorageMigrationEngine'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { SqliteCheckpointStore } from '../SqliteCheckpointStore'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

async function createZipArchive(
  destPath: string,
  entries: Record<string, string | Buffer>
): Promise<void> {
  const output = fs.createWriteStream(destPath)
  const archive = new ZipArchive({ zlib: { level: 5 } })

  return new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))
    archive.pipe(output)

    for (const [entryPath, content] of Object.entries(entries)) {
      archive.append(content, { name: entryPath })
    }

    archive.finalize()
  })
}

describe('StorageMigrationEngine - End-to-End Migration Pipeline (Task 4.3)', () => {
  let testDir: string
  let engine: StorageMigrationEngine

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-migrate-e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    engine = new StorageMigrationEngine()
  })

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore teardown errors
    }
  })

  describe('End-to-End V3 ZIP Migration', () => {
    it('migrates a valid V3 archive to V4 SQLite with 100% data parity and .v3.bak preservation', async () => {
      const sourceZip = path.join(testDir, 'sample-v3.cagent')

      const manifest = {
        header: { magic: 'CAGENT', version: 3 },
        projects: {
          'proj-main': {
            id: 'proj-main',
            name: 'Deep Research Lab',
            metadata: { department: 'AI' },
            createdAt: 1700000000000,
            updatedAt: 1700000001000
          }
        },
        instances: {
          'doc-intro': {
            id: 'doc-intro',
            projectId: 'proj-main',
            type: 'document',
            name: 'Introduction',
            metadata: { wordCount: 500 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          'canvas-flow': {
            id: 'canvas-flow',
            projectId: 'proj-main',
            type: 'canvas',
            name: 'Agent Workflow',
            metadata: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      }

      const docPayload = { root: { children: [{ text: 'Deep learning introduction' }] } }
      const canvasPayload = { nodes: [{ id: 'n1', x: 50, y: 150 }], edges: [] }

      const state = {
        chat: {
          sessions: {
            'sess-alpha': {
              id: 'sess-alpha',
              projectId: 'proj-main',
              title: 'Exploration',
              createdAt: 1700000002000,
              updatedAt: 1700000004000,
              messages: [
                {
                  id: 'm-1',
                  role: 'user',
                  content: 'What is attention?',
                  timestamp: 1700000003000
                },
                {
                  id: 'm-2',
                  role: 'assistant',
                  content: 'Attention is all you need...',
                  timestamp: 1700000004000
                }
              ]
            }
          }
        }
      }

      const cpRecord = {
        thread_id: 'sess-alpha',
        checkpoint_ns: '',
        checkpoint_id: 'cp-step-1',
        parent_checkpoint_id: null,
        checkpoint: { values: { token: 'xyz' } },
        metadata: { source: 'input' },
        created_at: 1700000003500
      }

      const blobKey = 'sess-alpha::mem:v1'
      const encodedBlob = Buffer.from(blobKey).toString('base64url')
      const blobRecord = {
        thread_id: 'sess-alpha',
        checkpoint_ns: '',
        channel: 'mem',
        version: 'v1',
        type: 'json',
        blob: { memory: 'initialized' },
        serialized: false
      }

      const writeRecord = {
        thread_id: 'sess-alpha',
        checkpoint_ns: '',
        checkpoint_id: 'cp-step-1',
        task_id: 'task-1',
        idx: 0,
        channel: 'mem',
        type: 'json',
        blob: { update: 1 }
      }

      await createZipArchive(sourceZip, {
        'manifest.json': JSON.stringify(manifest),
        'state.json': JSON.stringify(state),
        'instances/doc-intro/content.msgpack': pack(docPayload),
        'instances/canvas-flow/content.msgpack': pack(canvasPayload),
        'checkpoints/threads/sess-alpha/checkpoints/cp-step-1.json': JSON.stringify(cpRecord),
        [`checkpoints/blobs/${encodedBlob}.json`]: JSON.stringify(blobRecord),
        'checkpoints/threads/sess-alpha/writes/cp-step-1_task-1_0.json':
          JSON.stringify(writeRecord),
        'checkpoints/manifests/restore-heads.json': JSON.stringify({ 'sess-alpha:': 'cp-step-1' })
      })

      expect(detectStorageFormat(sourceZip)).toBe('legacy_zip')

      const progressEvents: MigrationProgress[] = []
      const engineWithProgress = new StorageMigrationEngine({
        onProgress: (p) => progressEvents.push(p)
      })

      const report = await engineWithProgress.executeMigration(sourceZip)

      expect(report.success).toBe(true)
      expect(report.fromVersion).toBe(3)
      expect(report.toVersion).toBe(4)
      expect(report.artifactsMigrated).toBeGreaterThanOrEqual(8)
      expect(report.backupPath).toBe(`${sourceZip}.v3.bak`)
      expect(fs.existsSync(report.backupPath)).toBe(true)

      // Verify file is now SQLite V4
      expect(detectStorageFormat(sourceZip)).toBe('v4_sqlite')

      // Verify progress events
      const stages = progressEvents.map((e) => e.stage)
      expect(stages).toContain('sniffing')
      expect(stages).toContain('backup')
      expect(stages).toContain('extracting')
      expect(stages).toContain('ingesting')
      expect(stages).toContain('verifying')
      expect(stages).toContain('cutover')
      expect(stages).toContain('completed')

      // Query database via SqliteStorageEngine and SqliteCheckpointStore
      const db = new SqliteDatabase(sourceZip)
      const storageEngine = new SqliteStorageEngine(db)
      const checkpointStore = new SqliteCheckpointStore(db)

      const projects = storageEngine.getProjects()
      expect(projects).toHaveLength(1)
      expect(projects[0].id).toBe('proj-main')

      const instances = storageEngine.getInstancesMeta()
      expect(instances).toHaveLength(2)

      const introContent = storageEngine.getInstanceContent('doc-intro')
      expect(introContent).not.toBeNull()
      expect(unpack(introContent as Buffer)).toEqual(docPayload)

      const canvasContent = storageEngine.getInstanceContent('canvas-flow')
      expect(canvasContent).not.toBeNull()
      expect(unpack(canvasContent as Buffer)).toEqual(canvasPayload)

      const chatSession = storageEngine.getChatSession('sess-alpha')
      expect(chatSession).not.toBeNull()
      expect(chatSession?.messages).toHaveLength(2)
      expect(chatSession?.messages[0].content).toBe('What is attention?')

      const latestCp = await checkpointStore.getLatestCheckpoint('sess-alpha')
      expect(latestCp).toBeDefined()
      expect(latestCp?.checkpoint_id).toBe('cp-step-1')

      const restoreHead = await checkpointStore.getRestoreHead('sess-alpha')
      expect(restoreHead).toBe('cp-step-1')

      const writes = await checkpointStore.getWrites('sess-alpha', 'cp-step-1')
      expect(writes).toHaveLength(1)
      expect(writes[0].task_id).toBe('task-1')

      await storageEngine.close()
    })
  })

  describe('Legacy V2 Monolithic Archive Migration', () => {
    it('normalizes legacy V2 cagent.json structure and migrates to V4 SQLite', async () => {
      const sourceZip = path.join(testDir, 'legacy-v2.cagent')

      const v2Monolithic = {
        header: { magic: 'CAGENT', version: 2 },
        projects: {
          'p-v2': {
            id: 'p-v2',
            name: 'V2 Legacy Project',
            createdAt: 1690000000000,
            updatedAt: 1690000001000
          }
        },
        instances: {
          'doc-v2': {
            id: 'doc-v2',
            projectId: 'p-v2',
            type: 'document',
            name: 'Legacy Card',
            content: { text: 'Migrated from V2' }
          }
        },
        chat: {
          sessions: {
            'sess-v2': {
              id: 'sess-v2',
              projectId: 'p-v2',
              title: 'V2 Chat',
              messages: [
                { id: 'm-v2', role: 'user', content: 'V2 prompt', timestamp: 1690000002000 }
              ]
            }
          }
        },
        persistence: {
          checkpoints: {
            'sess-v2': [
              {
                thread_id: 'sess-v2',
                checkpoint_ns: '',
                checkpoint_id: 'cp-v2-1',
                checkpoint: { data: 'legacy' },
                created_at: 1690000002500
              }
            ]
          },
          blobs: {},
          writes: {},
          restoreHeads: {
            'sess-v2:': 'cp-v2-1'
          }
        }
      }

      await createZipArchive(sourceZip, {
        'cagent.json': pack(v2Monolithic)
      })

      const report = await engine.executeMigration(sourceZip)
      expect(report.success).toBe(true)
      expect(detectStorageFormat(sourceZip)).toBe('v4_sqlite')

      const db = new SqliteDatabase(sourceZip)
      const storageEngine = new SqliteStorageEngine(db)

      const instances = storageEngine.getInstancesMeta()
      expect(instances).toHaveLength(1)
      expect(instances[0].name).toBe('Legacy Card')

      const content = storageEngine.getInstanceContent('doc-v2')
      expect(unpack(content as Buffer)).toEqual({ text: 'Migrated from V2' })

      await storageEngine.close()
    })
  })

  describe('Verification Integrity Gates', () => {
    it('fails Gate 1 when foreign key check detects orphaned records', () => {
      const dbPath = path.join(testDir, 'gate1-test.cagent.tmp')
      const db = new SqliteDatabase(dbPath, { autoMigrate: true })

      // Disable foreign keys temporarily to force insert an orphaned chat message
      db.pragma('foreign_keys = OFF')
      db.prepare(
        `
        INSERT INTO chat_messages (id, session_id, role, content, timestamp)
        VALUES ('orphan-m', 'non-existent-session', 'user', 'hello', 1000)
      `
      ).run()
      db.pragma('foreign_keys = ON')

      expect(() => {
        engine.verifyIntegrityGates(db, 0, 0)
      }).toThrowError(StorageError)

      try {
        engine.verifyIntegrityGates(db, 0, 0)
      } catch (err) {
        expect(err).toMatchObject({
          code: StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION
        })
      }

      db.close()
    })

    it('fails Gate 3 when instance count parity does not match', () => {
      const dbPath = path.join(testDir, 'gate3-test.cagent.tmp')
      const db = new SqliteDatabase(dbPath, { autoMigrate: true })

      expect(() => {
        // Expected 2 instances, but DB has 0
        engine.verifyIntegrityGates(db, 2, 0)
      }).toThrowError(StorageError)

      try {
        engine.verifyIntegrityGates(db, 2, 0)
      } catch (err) {
        expect(err).toMatchObject({
          code: StorageErrorCode.STORAGE_MIGRATION_FAILED
        })
      }

      db.close()
    })

    it('fails Gate 4 when checkpoint count parity does not match', () => {
      const dbPath = path.join(testDir, 'gate4-test.cagent.tmp')
      const db = new SqliteDatabase(dbPath, { autoMigrate: true })

      expect(() => {
        // Expected 5 checkpoints, but DB has 0
        engine.verifyIntegrityGates(db, 0, 5)
      }).toThrowError(StorageError)

      try {
        engine.verifyIntegrityGates(db, 0, 5)
      } catch (err) {
        expect(err).toMatchObject({
          code: StorageErrorCode.STORAGE_MIGRATION_FAILED
        })
      }

      db.close()
    })

    it('fails Gate 5 when MessagePack BLOB unpack throws', () => {
      const dbPath = path.join(testDir, 'gate5-test.cagent.tmp')
      const db = new SqliteDatabase(dbPath, { autoMigrate: true })

      const now = Date.now()
      db.prepare(
        `
        INSERT INTO projects (id, name, created_at, updated_at)
        VALUES ('p1', 'P1', ${now}, ${now})
      `
      ).run()

      // Insert instance with corrupted MessagePack payload
      db.prepare(
        `
        INSERT INTO instances (id, project_id, type, name, content_msgpack, created_at, updated_at)
        VALUES ('corrupt-inst', 'p1', 'document', 'Corrupt', ?, '2026-01-01', '2026-01-01')
      `
      ).run(Buffer.from([0xc1, 0xff, 0xee])) // 0xc1 is never used in msgpack

      expect(() => {
        engine.verifyIntegrityGates(db, 1, 0)
      }).toThrowError(StorageError)

      try {
        engine.verifyIntegrityGates(db, 1, 0)
      } catch (err) {
        expect(err).toMatchObject({
          code: StorageErrorCode.STORAGE_CORRUPT_DATABASE
        })
      }

      db.close()
    })
  })

  describe('Fail-Closed Rollback on Corrupt Archive', () => {
    it('aborts migration, cleans up staging database, and leaves original archive untouched', async () => {
      const sourceZip = path.join(testDir, 'corrupted.cagent')

      // Create a ZIP with invalid JSON in manifest.json to trigger failure
      await createZipArchive(sourceZip, {
        'manifest.json': '{ corrupt json ['
      })

      const originalBuffer = fs.readFileSync(sourceZip)

      await expect(engine.executeMigration(sourceZip)).rejects.toThrowError(StorageError)

      // Staging .tmp file must be cleaned up
      expect(fs.existsSync(`${sourceZip}.tmp`)).toBe(false)

      // Original archive must be untouched
      expect(fs.existsSync(sourceZip)).toBe(true)
      expect(fs.readFileSync(sourceZip)).toEqual(originalBuffer)

      // Safety backup must exist
      expect(fs.existsSync(`${sourceZip}.v3.bak`)).toBe(true)
    })
  })

  describe('Decommissioning of Dirty Adjacent .collar Directory', () => {
    it('uses live dirty adjacent directory as source, migrates live edits, and removes .collar directory', async () => {
      const sourceZip = path.join(testDir, 'dirty-project.cagent')
      const collarDir = path.join(testDir, 'dirty-project.collar')
      const lockFile = `${collarDir}.lock`

      // Base ZIP
      await createZipArchive(sourceZip, {
        'manifest.json': JSON.stringify({
          header: { magic: 'CAGENT', version: 3 },
          projects: { 'p-base': { id: 'p-base', name: 'Base Name' } },
          instances: {}
        })
      })

      // Adjacent dirty folder with unsaved live changes
      fs.mkdirSync(path.join(collarDir, 'instances', 'live-card'), { recursive: true })
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, time: Date.now() }))

      const liveManifest = {
        header: { magic: 'CAGENT', version: 3 },
        projects: { 'p-live': { id: 'p-live', name: 'Live Edits Project' } },
        instances: {
          'live-card': {
            id: 'live-card',
            projectId: 'p-live',
            type: 'canvas',
            name: 'Live Canvas'
          }
        }
      }

      fs.writeFileSync(path.join(collarDir, 'manifest.json'), JSON.stringify(liveManifest))
      fs.writeFileSync(
        path.join(collarDir, 'instances', 'live-card', 'content.msgpack'),
        pack({ liveNode: 'live' })
      )

      const report = await engine.executeMigration(sourceZip)

      expect(report.success).toBe(true)
      expect(detectStorageFormat(sourceZip)).toBe('v4_sqlite')

      // Verify dirty folder and lock are decommissioned
      expect(fs.existsSync(collarDir)).toBe(false)
      expect(fs.existsSync(lockFile)).toBe(false)

      // Verify that live edits were migrated
      const db = new SqliteDatabase(sourceZip)
      const storageEngine = new SqliteStorageEngine(db)

      const projects = storageEngine.getProjects()
      expect(projects[0].name).toBe('Live Edits Project')

      const instances = storageEngine.getInstancesMeta()
      expect(instances).toHaveLength(1)
      expect(instances[0].id).toBe('live-card')

      await storageEngine.close()
    })
  })

  describe('Idempotent Already V4 Handling', () => {
    it('returns immediately without modifying an existing V4 SQLite database', async () => {
      const dbPath = path.join(testDir, 'already-v4.cagent')
      const db = new SqliteDatabase(dbPath, { autoMigrate: true })
      db.close()

      const report = await engine.executeMigration(dbPath)
      expect(report.success).toBe(true)
      expect(report.fromVersion).toBe(4)
      expect(report.toVersion).toBe(4)
      expect(report.artifactsMigrated).toBe(0)
      expect(report.backupPath).toBe('')
    })
  })
})
