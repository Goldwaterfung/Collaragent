import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteCheckpointStore } from '../SqliteCheckpointStore'
import type {
  CheckpointRecord,
  CheckpointBlobRecord,
  CheckpointWriteRecord
} from '../interfaces/ICheckpointStore'

describe('SqliteCheckpointStore Unit Suite (Core Queries, Blobs & Restore Heads)', () => {
  let tempDir: string
  let dbPath: string
  let db: SqliteDatabase | null = null
  let store: SqliteCheckpointStore | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-store-test-'))
    dbPath = path.join(tempDir, 'test-project.cagent')
    db = new SqliteDatabase(dbPath)
    store = new SqliteCheckpointStore(db)
  })

  afterEach(() => {
    if (db && db.isOpen) {
      db.close()
      db = null
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('Checkpoints', () => {
    it('returns empty array when no checkpoints exist for thread', async () => {
      const records = await store!.getCheckpoints('empty-thread')
      expect(records).toEqual([])
    })

    it('inserts and retrieves checkpoints in chronological order (created_at ASC)', async () => {
      const now = Date.now()
      const cp1: CheckpointRecord = {
        thread_id: 'thread-1',
        checkpoint_ns: '',
        checkpoint_id: 'cp-001',
        checkpoint: { v: 1, channel_versions: { messages: '1' } },
        metadata: { source: 'input', step: 1 },
        created_at: now
      }

      const cp2: CheckpointRecord = {
        thread_id: 'thread-1',
        checkpoint_ns: '',
        checkpoint_id: 'cp-002',
        parent_checkpoint_id: 'cp-001',
        checkpoint: { v: 1, channel_versions: { messages: '2' } },
        metadata: { source: 'loop', step: 2 },
        created_at: now + 100
      }

      await store!.putCheckpoint(cp1)
      await store!.putCheckpoint(cp2)

      const retrieved = await store!.getCheckpoints('thread-1')
      expect(retrieved).toHaveLength(2)
      expect(retrieved[0]?.checkpoint_id).toBe('cp-001')
      expect(retrieved[0]?.parent_checkpoint_id).toBeUndefined()
      expect(retrieved[0]?.checkpoint).toEqual({ v: 1, channel_versions: { messages: '1' } })
      expect(retrieved[0]?.metadata).toEqual({ source: 'input', step: 1 })

      expect(retrieved[1]?.checkpoint_id).toBe('cp-002')
      expect(retrieved[1]?.parent_checkpoint_id).toBe('cp-001')
      expect(retrieved[1]?.metadata).toEqual({ source: 'loop', step: 2 })
    })

    it('filters checkpoints by checkpoint_ns when specified', async () => {
      const now = Date.now()
      const rootCp: CheckpointRecord = {
        thread_id: 'thread-ns',
        checkpoint_ns: '',
        checkpoint_id: 'root-1',
        checkpoint: { step: 0 },
        metadata: {},
        created_at: now
      }

      const subagentCp: CheckpointRecord = {
        thread_id: 'thread-ns',
        checkpoint_ns: 'subagent-1',
        checkpoint_id: 'sub-1',
        checkpoint: { step: 1 },
        metadata: {},
        created_at: now + 50
      }

      await store!.putCheckpoint(rootCp)
      await store!.putCheckpoint(subagentCp)

      const all = await store!.getCheckpoints('thread-ns')
      expect(all).toHaveLength(2)

      const rootOnly = await store!.getCheckpoints('thread-ns', '')
      expect(rootOnly).toHaveLength(1)
      expect(rootOnly[0]?.checkpoint_id).toBe('root-1')

      const subagentOnly = await store!.getCheckpoints('thread-ns', 'subagent-1')
      expect(subagentOnly).toHaveLength(1)
      expect(subagentOnly[0]?.checkpoint_id).toBe('sub-1')
    })

    it('retrieves the latest checkpoint via B-Tree point query', async () => {
      const now = Date.now()
      await store!.putCheckpoint({
        thread_id: 'thread-latest',
        checkpoint_ns: '',
        checkpoint_id: 'cp-first',
        checkpoint: { step: 1 },
        metadata: {},
        created_at: now
      })

      await store!.putCheckpoint({
        thread_id: 'thread-latest',
        checkpoint_ns: '',
        checkpoint_id: 'cp-middle',
        checkpoint: { step: 2 },
        metadata: {},
        created_at: now + 50
      })

      await store!.putCheckpoint({
        thread_id: 'thread-latest',
        checkpoint_ns: '',
        checkpoint_id: 'cp-latest',
        checkpoint: { step: 3 },
        metadata: {},
        created_at: now + 100
      })

      const latest = await store!.getLatestCheckpoint('thread-latest', '')
      expect(latest).toBeDefined()
      expect(latest?.checkpoint_id).toBe('cp-latest')
      expect(latest?.checkpoint).toEqual({ step: 3 })

      const nonExistent = await store!.getLatestCheckpoint('non-existent')
      expect(nonExistent).toBeUndefined()
    })

    it('retrieves specific checkpoint by thread_id, checkpoint_ns, and checkpoint_id', async () => {
      await store!.putCheckpoint({
        thread_id: 'thread-point',
        checkpoint_ns: 'ns-a',
        checkpoint_id: 'target-cp',
        checkpoint: { target: true },
        metadata: { info: 'point query' },
        created_at: Date.now()
      })

      const found = await store!.getCheckpoint('thread-point', 'ns-a', 'target-cp')
      expect(found).toBeDefined()
      expect(found?.checkpoint_id).toBe('target-cp')
      expect(found?.checkpoint).toEqual({ target: true })

      const missing = await store!.getCheckpoint('thread-point', 'ns-a', 'missing-cp')
      expect(missing).toBeUndefined()
    })

    it('upserts existing checkpoint without duplicate primary key error', async () => {
      const initial: CheckpointRecord = {
        thread_id: 'thread-upsert',
        checkpoint_ns: '',
        checkpoint_id: 'cp-1',
        checkpoint: { counter: 1 },
        metadata: { v: 1 },
        created_at: 1000
      }
      await store!.putCheckpoint(initial)

      const updated: CheckpointRecord = {
        thread_id: 'thread-upsert',
        checkpoint_ns: '',
        checkpoint_id: 'cp-1',
        checkpoint: { counter: 2 },
        metadata: { v: 2 },
        created_at: 2000
      }
      await store!.putCheckpoint(updated)

      const records = await store!.getCheckpoints('thread-upsert')
      expect(records).toHaveLength(1)
      expect(records[0]?.checkpoint).toEqual({ counter: 2 })
      expect(records[0]?.metadata).toEqual({ v: 2 })
    })
  })

  describe('Channel Version Blobs', () => {
    it('stores and retrieves binary buffer blobs', async () => {
      const buffer = Buffer.from([0xde, 0xad, 0xbe, 0xef])
      const blobRecord: CheckpointBlobRecord = {
        thread_id: 't-blob',
        checkpoint_ns: '',
        channel: 'binary-channel',
        version: 'v1',
        type: 'bytes',
        blob: buffer,
        serialized: false
      }

      await store!.putBlob(blobRecord)

      const retrieved = await store!.getBlob('t-blob', '', 'binary-channel', 'v1')
      expect(retrieved).toBeDefined()
      expect(retrieved?.type).toBe('bytes')
      expect(Buffer.isBuffer(retrieved?.blob)).toBe(true)
      expect(retrieved?.blob).toEqual(buffer)
      expect(retrieved?.serialized).toBe(false)
    })

    it('stores and retrieves serialized string blobs using key overload', async () => {
      const serializedJson = JSON.stringify({ role: 'assistant', text: 'Hello, World!' })
      const blobRecord: CheckpointBlobRecord = {
        thread_id: 't-blob',
        checkpoint_ns: '',
        channel: 'messages',
        version: '1.0',
        type: 'constructor_Message',
        blob: serializedJson,
        serialized: true
      }

      const key = 't-blob:messages:1.0'
      await store!.putBlob(key, blobRecord)

      const retrievedByKey = await store!.getBlob(key)
      expect(retrievedByKey).toBeDefined()
      expect(retrievedByKey?.type).toBe('constructor_Message')
      expect(retrievedByKey?.blob).toBe(serializedJson)
      expect(retrievedByKey?.serialized).toBe(true)

      const retrievedByParts = await store!.getBlob('t-blob', '', 'messages', '1.0')
      expect(retrievedByParts).toEqual(retrievedByKey)
    })

    it('stores and retrieves JSON object blobs', async () => {
      const jsonPayload = { count: 42, tags: ['ai', 'agent'] }
      const blobRecord: CheckpointBlobRecord = {
        thread_id: 't-blob',
        checkpoint_ns: 'ns1',
        channel: 'state',
        version: '10',
        type: 'json',
        blob: jsonPayload,
        serialized: false
      }

      await store!.putBlob(blobRecord)

      const retrieved = await store!.getBlob('t-blob', 'ns1', 'state', '10')
      expect(retrieved).toBeDefined()
      expect(retrieved?.blob).toEqual(jsonPayload)
      expect(retrieved?.serialized).toBe(false)
    })

    it('retrieves blobs by prefix (both thread:ns and key prefix)', async () => {
      await store!.putBlob({
        thread_id: 't-pref',
        checkpoint_ns: 'ns-a',
        channel: 'ch1',
        version: '1',
        type: 'json',
        blob: 'data1',
        serialized: false
      })

      await store!.putBlob({
        thread_id: 't-pref',
        checkpoint_ns: 'ns-a',
        channel: 'ch2',
        version: '1',
        type: 'json',
        blob: 'data2',
        serialized: false
      })

      await store!.putBlob({
        thread_id: 't-pref',
        checkpoint_ns: 'ns-b',
        channel: 'ch1',
        version: '1',
        type: 'json',
        blob: 'data3',
        serialized: false
      })

      // Query by threadId + checkpointNs
      const nsABlobs = await store!.getBlobsByPrefix('t-pref', 'ns-a')
      expect(nsABlobs).toHaveLength(2)

      // Query by prefix string "t-pref:"
      const allThreadBlobs = await store!.getBlobsByPrefix('t-pref:')
      expect(allThreadBlobs).toHaveLength(3)
    })

    it('deletes blobs in batch in an immediate transaction', async () => {
      await store!.putBlob({
        thread_id: 't-del',
        checkpoint_ns: '',
        channel: 'ch1',
        version: '1',
        type: 'json',
        blob: 'val1'
      })
      await store!.putBlob({
        thread_id: 't-del',
        checkpoint_ns: '',
        channel: 'ch2',
        version: '1',
        type: 'json',
        blob: 'val2'
      })
      await store!.putBlob({
        thread_id: 't-del',
        checkpoint_ns: '',
        channel: 'ch3',
        version: '1',
        type: 'json',
        blob: 'val3'
      })

      await store!.deleteBlobs(['t-del:ch1:1', 't-del:ch2:1'])

      const b1 = await store!.getBlob('t-del:ch1:1')
      const b2 = await store!.getBlob('t-del:ch2:1')
      const b3 = await store!.getBlob('t-del:ch3:1')

      expect(b1).toBeUndefined()
      expect(b2).toBeUndefined()
      expect(b3).toBeDefined()
    })
  })

  describe('Restore Heads', () => {
    it('manages restore heads (get, put, set, clear)', async () => {
      const initial = await store!.getRestoreHead('t-restore')
      expect(initial).toBeUndefined()

      await store!.putRestoreHead('t-restore', '', 'cp-head-1')
      const head1 = await store!.getRestoreHead('t-restore')
      expect(head1).toBe('cp-head-1')

      await store!.setRestoreHead('t-restore', 'cp-head-2', '')
      const head2 = await store!.getRestoreHead('t-restore')
      expect(head2).toBe('cp-head-2')

      // Test namespace isolation
      await store!.putRestoreHead('t-restore', 'subagent-head', 'cp-sub-head')
      const subHead = await store!.getRestoreHead('t-restore', 'subagent-head')
      expect(subHead).toBe('cp-sub-head')
      expect(await store!.getRestoreHead('t-restore', '')).toBe('cp-head-2')

      // Clear restore head
      await store!.clearRestoreHead('t-restore', '')
      expect(await store!.getRestoreHead('t-restore', '')).toBeUndefined()
      expect(await store!.getRestoreHead('t-restore', 'subagent-head')).toBe('cp-sub-head')
    })
  })

  describe('Thread Deletion', () => {
    it('deletes all checkpoints, blobs, writes, and restore heads for a thread atomically', async () => {
      // Setup thread-to-delete
      await store!.putCheckpoint({
        thread_id: 't-remove',
        checkpoint_ns: '',
        checkpoint_id: 'cp-1',
        checkpoint: { step: 1 },
        metadata: {},
        created_at: 100
      })

      await store!.putBlob({
        thread_id: 't-remove',
        checkpoint_ns: '',
        channel: 'ch',
        version: '1',
        type: 'json',
        blob: 'content'
      })

      const writeRecord: CheckpointWriteRecord = {
        thread_id: 't-remove',
        checkpoint_ns: '',
        checkpoint_id: 'cp-1',
        task_id: 'task-1',
        idx: 0,
        channel: 'ch',
        type: 'json',
        blob: 'write data'
      }
      await store!.putWrites([writeRecord])

      await store!.putRestoreHead('t-remove', '', 'cp-1')

      // Setup other-thread (must NOT be touched)
      await store!.putCheckpoint({
        thread_id: 't-keep',
        checkpoint_ns: '',
        checkpoint_id: 'cp-keep',
        checkpoint: { step: 1 },
        metadata: {},
        created_at: 100
      })

      await store!.putBlob({
        thread_id: 't-keep',
        checkpoint_ns: '',
        channel: 'ch',
        version: '1',
        type: 'json',
        blob: 'keep content'
      })

      // Execute thread deletion
      await store!.deleteThread('t-remove')

      // Verify thread-to-delete is completely empty
      expect(await store!.getCheckpoints('t-remove')).toEqual([])
      expect(await store!.getBlob('t-remove:ch:1')).toBeUndefined()
      expect(await store!.getWrites('t-remove', 'cp-1')).toEqual([])
      expect(await store!.getRestoreHead('t-remove')).toBeUndefined()

      // Verify other-thread remains intact
      expect(await store!.getCheckpoints('t-keep')).toHaveLength(1)
      expect(await store!.getBlob('t-keep:ch:1')).toBeDefined()
    })
  })
})
