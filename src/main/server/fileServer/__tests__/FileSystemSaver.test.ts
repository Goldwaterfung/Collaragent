import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Checkpoint, CheckpointMetadata } from '@langchain/langgraph-checkpoint'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteCheckpointStore } from '../SqliteCheckpointStore'
import { FileSystemSaver } from '../FileSystemSaver'

describe('FileSystemSaver Integration & Benchmark Suite (SqliteCheckpointStore)', () => {
  let tempDir: string
  let dbPath: string
  let db: SqliteDatabase | null = null
  let store: SqliteCheckpointStore | null = null
  let saver: FileSystemSaver | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-saver-test-'))
    dbPath = path.join(tempDir, 'test-project.cagent')
    db = new SqliteDatabase(dbPath)
    store = new SqliteCheckpointStore(db)
    saver = new FileSystemSaver(store)
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

  describe('LangGraph Checkpoint Lifecycle', () => {
    it('executes put and getTuple with serialized channel values', async () => {
      const threadId = 'thread-lc-1'
      const checkpointId = 'cp-001'

      const checkpoint: Checkpoint = {
        v: 1,
        id: checkpointId,
        ts: new Date().toISOString(),
        channel_versions: {
          messages: '1.0',
          counter: '1.0'
        },
        versions_seen: {
          agent: { messages: '1.0', counter: '1.0' }
        },
        channel_values: {
          messages: [{ role: 'user', content: 'Hello' }],
          counter: 42
        }
      }

      const metadata: CheckpointMetadata = {
        source: 'input',
        step: 1,
        parents: {}
      }

      const newVersions = {
        messages: '1.0',
        counter: '1.0'
      }

      // Put checkpoint with precalculated blobs
      await saver!.put(
        { configurable: { thread_id: threadId } },
        checkpoint,
        metadata,
        newVersions,
        {
          messages: {
            type: 'json',
            blob: [{ role: 'user', content: 'Hello' }],
            serialized: false
          },
          counter: {
            type: 'json',
            blob: 42,
            serialized: false
          }
        }
      )

      // Resolve checkpoint tuple
      const tuple = await saver!.getTuple({
        configurable: { thread_id: threadId, checkpoint_id: checkpointId }
      })

      expect(tuple).toBeDefined()
      expect(tuple?.config.configurable?.thread_id).toBe(threadId)
      expect(tuple?.config.configurable?.checkpoint_id).toBe(checkpointId)
      expect(tuple?.checkpoint.id).toBe(checkpointId)
      expect(tuple?.checkpoint.channel_values.messages).toEqual([
        { role: 'user', content: 'Hello' }
      ])
      expect(tuple?.checkpoint.channel_values.counter).toBe(42)
      expect(tuple?.metadata.step).toBe(1)
    })

    it('manages task writes and restores them as pendingWrites in getTuple', async () => {
      const threadId = 'thread-writes-tuple'
      const checkpointId = 'cp-task-1'

      const checkpoint: Checkpoint = {
        v: 1,
        id: checkpointId,
        ts: new Date().toISOString(),
        channel_versions: {},
        versions_seen: {},
        channel_values: {}
      }

      await saver!.put(
        { configurable: { thread_id: threadId } },
        checkpoint,
        { source: 'loop', step: 1, parents: {} },
        {}
      )

      // Add task writes
      await saver!.putWrites(
        { configurable: { thread_id: threadId, checkpoint_id: checkpointId } },
        [
          ['messages', { role: 'assistant', content: 'Step completed' }],
          ['status', 'in-progress']
        ],
        'task-node-1'
      )

      // Retrieve tuple
      const tuple = await saver!.getTuple({
        configurable: { thread_id: threadId, checkpoint_id: checkpointId }
      })

      expect(tuple).toBeDefined()
      expect(tuple?.pendingWrites).toHaveLength(2)
      expect(tuple?.pendingWrites[0]).toEqual([
        'task-node-1',
        'messages',
        { role: 'assistant', content: 'Step completed' }
      ])
      expect(tuple?.pendingWrites[1]).toEqual(['task-node-1', 'status', 'in-progress'])
    })

    it('lists checkpoints chronologically in reverse with limit and filters', async () => {
      const threadId = 'thread-list'

      for (let i = 1; i <= 5; i++) {
        const cp: Checkpoint = {
          v: 1,
          id: `cp-${i}`,
          ts: new Date().toISOString(),
          channel_versions: {},
          versions_seen: {},
          channel_values: {}
        }
        await saver!.put(
          { configurable: { thread_id: threadId } },
          cp,
          { source: 'loop', step: i, parents: {} },
          {}
        )
      }

      // Collect all
      const allTuples = []
      for await (const t of saver!.list({ configurable: { thread_id: threadId } })) {
        allTuples.push(t)
      }
      expect(allTuples).toHaveLength(5)
      expect(allTuples[0]?.checkpoint.id).toBe('cp-5')
      expect(allTuples[4]?.checkpoint.id).toBe('cp-1')

      // Test limit = 2
      const limited = []
      for await (const t of saver!.list({ configurable: { thread_id: threadId } }, { limit: 2 })) {
        limited.push(t)
      }
      expect(limited).toHaveLength(2)
      expect(limited[0]?.checkpoint.id).toBe('cp-5')
      expect(limited[1]?.checkpoint.id).toBe('cp-4')

      // Test before
      const beforeCp3 = []
      for await (const t of saver!.list(
        { configurable: { thread_id: threadId } },
        { before: { configurable: { checkpoint_id: 'cp-3' } } }
      )) {
        beforeCp3.push(t)
      }
      // Checkpoints before cp-3 in chronological order are cp-1 and cp-2, reversed: cp-2, cp-1
      expect(beforeCp3).toHaveLength(2)
      expect(beforeCp3[0]?.checkpoint.id).toBe('cp-2')
      expect(beforeCp3[1]?.checkpoint.id).toBe('cp-1')
    })

    it('automatically prunes transient task writes older than 3 completed turns during put', async () => {
      const threadId = 'thread-auto-prune'

      // Put 5 checkpoints in sequence, each with a task write
      for (let turn = 1; turn <= 5; turn++) {
        const cp: Checkpoint = {
          v: 1,
          id: `cp-turn-${turn}`,
          ts: new Date().toISOString(),
          channel_versions: {},
          versions_seen: {},
          channel_values: {}
        }

        await saver!.put(
          { configurable: { thread_id: threadId } },
          cp,
          { source: 'loop', step: turn, parents: {} },
          {}
        )

        await saver!.putWrites(
          { configurable: { thread_id: threadId, checkpoint_id: `cp-turn-${turn}` } },
          [['turn', turn]],
          `task-${turn}`
        )

        // Advance simulated time slightly for deterministic timestamps
        await new Promise((r) => setTimeout(r, 2))
      }

      // Trigger one more put to ensure pruning hook has executed
      const cp6: Checkpoint = {
        v: 1,
        id: 'cp-turn-6',
        ts: new Date().toISOString(),
        channel_versions: {},
        versions_seen: {},
        channel_values: {}
      }
      await saver!.put(
        { configurable: { thread_id: threadId } },
        cp6,
        { source: 'loop', step: 6, parents: {} },
        {}
      )

      // With 6 checkpoints, only the last 3 completed turns (turn 4, 5, 6) retain writes.
      // Older turns 1, 2, 3 must have their writes pruned!
      const writesTurn1 = await store!.getWrites(threadId, 'cp-turn-1')
      const writesTurn2 = await store!.getWrites(threadId, 'cp-turn-2')
      const writesTurn3 = await store!.getWrites(threadId, 'cp-turn-3')

      expect(writesTurn1).toHaveLength(0)
      expect(writesTurn2).toHaveLength(0)
      expect(writesTurn3).toHaveLength(0)

      // Latest turns retain writes
      const writesTurn4 = await store!.getWrites(threadId, 'cp-turn-4')
      const writesTurn5 = await store!.getWrites(threadId, 'cp-turn-5')
      expect(writesTurn4.length + writesTurn5.length).toBeGreaterThan(0)
    })
  })

  describe('Performance Benchmark Gate (HR-NFR-03: <1.5ms getTuple across 1,000 checkpoints)', () => {
    it('resolves getTuple in <1.5ms when database contains 1,000 checkpoints', async () => {
      const threadId = 'thread-bench-1000'
      const totalCheckpoints = 1000

      // Seed 1,000 checkpoints using immediate transaction for fast bulk setup
      const baseTime = 1700000000000
      db!.immediateTransaction(() => {
        for (let i = 1; i <= totalCheckpoints; i++) {
          const cpId = `cp-bench-${i.toString().padStart(4, '0')}`
          const parentId = i > 1 ? `cp-bench-${(i - 1).toString().padStart(4, '0')}` : null
          const cpJson = JSON.stringify({
            v: 1,
            id: cpId,
            ts: new Date(baseTime + i * 1000).toISOString(),
            channel_versions: { state: String(i) },
            versions_seen: {}
          })
          const metaJson = JSON.stringify({ source: 'loop', step: i })

          db!
            .prepare(
              `
            INSERT INTO langgraph_checkpoints
            (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at)
            VALUES (?, '', ?, ?, ?, ?, ?)
          `
            )
            .run(threadId, cpId, parentId, cpJson, metaJson, baseTime + i * 1000)

          db!
            .prepare(
              `
            INSERT INTO langgraph_blobs
            (thread_id, checkpoint_ns, channel, version, type, data_blob, serialized)
            VALUES (?, '', 'state', ?, 'json', ?, 0)
          `
            )
            .run(threadId, String(i), Buffer.from(JSON.stringify({ count: i }), 'utf8'))
        }
      })

      // Verify 1,000 checkpoints were inserted
      const countRow = db!
        .prepare(
          `
        SELECT count(*) as total FROM langgraph_checkpoints WHERE thread_id = ?
      `
        )
        .get(threadId) as { total: number }
      expect(countRow.total).toBe(totalCheckpoints)

      // Warm up query cache (1 point read)
      await saver!.getTuple({ configurable: { thread_id: threadId } })

      // Run 50 point queries measuring high-resolution duration
      const iterations = 50
      const durations: number[] = []

      for (let j = 0; j < iterations; j++) {
        // Query target checkpoint (e.g. checkpoint 750)
        const targetId = `cp-bench-${(500 + j * 5).toString().padStart(4, '0')}`
        const start = performance.now()
        const result = await saver!.getTuple({
          configurable: { thread_id: threadId, checkpoint_id: targetId }
        })
        const elapsed = performance.now() - start

        expect(result).toBeDefined()
        expect(result?.checkpoint.id).toBe(targetId)
        durations.push(elapsed)
      }

      // Also benchmark getLatestCheckpoint (no checkpoint_id provided)
      const latestStart = performance.now()
      const latestResult = await saver!.getTuple({
        configurable: { thread_id: threadId }
      })
      const latestElapsed = performance.now() - latestStart

      expect(latestResult).toBeDefined()
      expect(latestResult?.checkpoint.id).toBe(
        `cp-bench-${totalCheckpoints.toString().padStart(4, '0')}`
      )

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
      const maxDuration = Math.max(...durations)

      console.log(`[Benchmark HR-NFR-03] 1,000 Checkpoints Benchmark Results:`)
      console.log(`  - Average point getTuple() latency: ${avgDuration.toFixed(4)} ms`)
      console.log(`  - Max point getTuple() latency:     ${maxDuration.toFixed(4)} ms`)
      console.log(`  - Latest getTuple() resolution:     ${latestElapsed.toFixed(4)} ms`)

      // Hard NFR Budget: < 1.5ms per getTuple point lookup
      expect(avgDuration).toBeLessThan(1.5)
      expect(latestElapsed).toBeLessThan(1.5)
    })
  })
})
