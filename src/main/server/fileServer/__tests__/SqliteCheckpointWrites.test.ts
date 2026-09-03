import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteCheckpointStore } from '../SqliteCheckpointStore'
import { SQLITE_ENGINE_CONFIG } from '../config/sqliteConfig'
import type { CheckpointRecord, CheckpointWriteRecord } from '../interfaces/ICheckpointStore'

describe('SqliteCheckpointWrites Unit Suite (Writes, 3-Turn Pruning & ADR-006 Large Tool Output)', () => {
  let tempDir: string
  let dbPath: string
  let db: SqliteDatabase | null = null
  let store: SqliteCheckpointStore | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-writes-test-'))
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

  describe('Task Writes Management', () => {
    it('stores and retrieves task writes ordered by idx ASC', async () => {
      const writes: CheckpointWriteRecord[] = [
        {
          thread_id: 't-writes',
          checkpoint_ns: '',
          checkpoint_id: 'cp-1',
          task_id: 'task-1',
          idx: 2,
          channel: 'messages',
          type: 'json',
          blob: { step: 'third' }
        },
        {
          thread_id: 't-writes',
          checkpoint_ns: '',
          checkpoint_id: 'cp-1',
          task_id: 'task-1',
          idx: 0,
          channel: 'messages',
          type: 'json',
          blob: { step: 'first' }
        },
        {
          thread_id: 't-writes',
          checkpoint_ns: '',
          checkpoint_id: 'cp-1',
          task_id: 'task-1',
          idx: 1,
          channel: 'messages',
          type: 'json',
          blob: { step: 'second' }
        }
      ]

      await store!.putWrites(writes)

      const retrieved = await store!.getWrites('t-writes', 'cp-1')
      expect(retrieved).toHaveLength(3)
      expect(retrieved[0]?.idx).toBe(0)
      expect(retrieved[0]?.blob).toEqual({ step: 'first' })

      expect(retrieved[1]?.idx).toBe(1)
      expect(retrieved[1]?.blob).toEqual({ step: 'second' })

      expect(retrieved[2]?.idx).toBe(2)
      expect(retrieved[2]?.blob).toEqual({ step: 'third' })
    })

    it('supports legacy putWrites(threadId, writes) overload', async () => {
      const writes: CheckpointWriteRecord[] = [
        {
          thread_id: 't-legacy',
          checkpoint_ns: '',
          checkpoint_id: 'cp-leg',
          task_id: 'task-2',
          idx: 0,
          channel: 'todos',
          type: 'json',
          blob: ['item1', 'item2']
        }
      ]

      await store!.putWrites('t-legacy', writes)

      const retrieved = await store!.getWrites('t-legacy', 'cp-leg')
      expect(retrieved).toHaveLength(1)
      expect(retrieved[0]?.blob).toEqual(['item1', 'item2'])
    })
  })

  describe('3-Turn Retention Pruning', () => {
    it('prunes task writes older than the last 3 completed turns in a thread', async () => {
      const threadId = 't-prune'

      // Seed 5 checkpoints with increasing timestamps (turns 1 to 5)
      for (let turn = 1; turn <= 5; turn++) {
        const cp: CheckpointRecord = {
          thread_id: threadId,
          checkpoint_ns: '',
          checkpoint_id: `cp-turn-${turn}`,
          checkpoint: { turn },
          metadata: { turn },
          created_at: 1000 + turn * 100
        }
        await store!.putCheckpoint(cp)

        // Attach 2 writes to each checkpoint (total 10 writes)
        const writes: CheckpointWriteRecord[] = [
          {
            thread_id: threadId,
            checkpoint_ns: '',
            checkpoint_id: `cp-turn-${turn}`,
            task_id: `task-${turn}`,
            idx: 0,
            channel: 'messages',
            type: 'json',
            blob: `write-${turn}-0`
          },
          {
            thread_id: threadId,
            checkpoint_ns: '',
            checkpoint_id: `cp-turn-${turn}`,
            task_id: `task-${turn}`,
            idx: 1,
            channel: 'messages',
            type: 'json',
            blob: `write-${turn}-1`
          }
        ]
        await store!.putWrites(writes)
      }

      // Verify all 10 writes initially exist
      for (let turn = 1; turn <= 5; turn++) {
        const writes = await store!.getWrites(threadId, `cp-turn-${turn}`)
        expect(writes).toHaveLength(2)
      }

      // Execute pruning retaining default turns (SQLITE_ENGINE_CONFIG.maxWriteRetentionTurns = 3)
      const deletedCount = await store!.pruneWrites(
        threadId,
        SQLITE_ENGINE_CONFIG.maxWriteRetentionTurns
      )

      // Writes belonging to turn 1 and turn 2 (4 writes total) must be deleted
      expect(deletedCount).toBe(4)

      // Verify turn 1 and turn 2 writes are gone
      expect(await store!.getWrites(threadId, 'cp-turn-1')).toHaveLength(0)
      expect(await store!.getWrites(threadId, 'cp-turn-2')).toHaveLength(0)

      // Verify turn 3, 4, 5 writes are retained
      expect(await store!.getWrites(threadId, 'cp-turn-3')).toHaveLength(2)
      expect(await store!.getWrites(threadId, 'cp-turn-4')).toHaveLength(2)
      expect(await store!.getWrites(threadId, 'cp-turn-5')).toHaveLength(2)

      // Verify all 5 checkpoints themselves still exist (only writes are pruned)
      const allCheckpoints = await store!.getCheckpoints(threadId)
      expect(allCheckpoints).toHaveLength(5)
    })

    it('does nothing and returns 0 when total checkpoints is <= keepTurns', async () => {
      const threadId = 't-few'
      for (let turn = 1; turn <= 2; turn++) {
        await store!.putCheckpoint({
          thread_id: threadId,
          checkpoint_ns: '',
          checkpoint_id: `cp-${turn}`,
          checkpoint: { turn },
          metadata: {},
          created_at: 1000 + turn
        })

        await store!.putWrites([
          {
            thread_id: threadId,
            checkpoint_ns: '',
            checkpoint_id: `cp-${turn}`,
            task_id: 'task',
            idx: 0,
            channel: 'test',
            type: 'json',
            blob: 'ok'
          }
        ])
      }

      const deleted = await store!.pruneWrites(threadId, 3)
      expect(deleted).toBe(0)

      expect(await store!.getWrites(threadId, 'cp-1')).toHaveLength(1)
      expect(await store!.getWrites(threadId, 'cp-2')).toHaveLength(1)
    })
  })

  describe('ADR-006 Large Tool Output Storage', () => {
    it('stores and retrieves large tool output buffer without external files', async () => {
      // 100KB buffer (>80KB ADR-006 threshold)
      const largeBuffer = Buffer.alloc(102400, 0xaa)

      await store!.putLargeToolOutput('tool-out-1', '', largeBuffer)

      const retrieved = await store!.getLargeToolOutput('tool-out-1')
      expect(retrieved).toBeDefined()
      expect(Buffer.isBuffer(retrieved)).toBe(true)
      expect(retrieved!.length).toBe(102400)
      expect(retrieved!.equals(largeBuffer)).toBe(true)
    })

    it('returns undefined for non-existent large tool output', async () => {
      const result = await store!.getLargeToolOutput('non-existent-tool')
      expect(result).toBeUndefined()
    })

    it('cascades deletion when associated chat session is deleted', async () => {
      // Create project and chat session in SQLite
      const now = Date.now()
      db!
        .prepare(
          `
        INSERT INTO projects (id, name, created_at, updated_at)
        VALUES ('proj-cascade', 'Cascade Project', ?, ?)
      `
        )
        .run(now, now)

      db!
        .prepare(
          `
        INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
        VALUES ('session-cascade', 'proj-cascade', 'Cascade Session', ?, ?)
      `
        )
        .run(now, now)

      const buffer = Buffer.from('large output for session')
      await store!.putLargeToolOutput('tool-session-1', 'session-cascade', buffer)

      // Verify tool output exists
      expect(await store!.getLargeToolOutput('tool-session-1')).toBeDefined()

      // Delete the chat session
      db!.prepare(`DELETE FROM chat_sessions WHERE id = 'session-cascade'`).run()

      // Tool output must cascade and be deleted automatically!
      const afterCascade = await store!.getLargeToolOutput('tool-session-1')
      expect(afterCascade).toBeUndefined()
    })
  })
})
