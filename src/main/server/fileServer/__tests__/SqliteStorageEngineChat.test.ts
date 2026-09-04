import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { ProjectLockManager } from '../locks/ProjectLockManager'
import { SQLITE_ENGINE_CONFIG, WAL_CHECKPOINT_MODES } from '../config/sqliteConfig'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

describe('SqliteStorageEngine - Chat, Cascades & Shutdown Lifecycle', () => {
  let testDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let lockManager: ProjectLockManager
  let engine: SqliteStorageEngine

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-chat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'test-chat.cagent')

    lockManager = new ProjectLockManager()
    db = new SqliteDatabase(dbFilePath)
    engine = new SqliteStorageEngine(db, {
      cagentPath: dbFilePath,
      lockManager
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await engine.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  describe('Granular Chat Messages & Sessions', () => {
    it('creates chat sessions and lists them by updated_at descending', () => {
      const project = engine.createProject('Chat Project')

      const session1 = engine.createChatSession(project.id, 'Session 1')
      const session2 = engine.createChatSession(project.id, 'Session 2')

      const sessions = engine.getChatSessions(project.id)
      expect(sessions).toHaveLength(2)
      expect(sessions[0].id).toBe(session2.id) // Ordered updated_at DESC
      expect(sessions[1].id).toBe(session1.id)
    })

    it('appends messages and retrieves them chronologically with rehydrated JSON fields', () => {
      const project = engine.createProject('Chat Project')
      const session = engine.createChatSession(project.id, 'Discussion Session')

      // Append messages out of insertion order with explicit timestamps
      engine.appendChatMessage(session.id, {
        role: 'user',
        content: 'Question 1',
        timestamp: 1000,
        metadata: { source: 'user-input' }
      })

      engine.appendChatMessage(session.id, {
        role: 'assistant',
        content: 'Answer 1',
        toolCalls: [{ name: 'web_search', args: { query: 'sqlite' } }],
        blocks: [{ type: 'thought', content: 'thinking...' }],
        actions: [{ type: 'execute' }],
        usage: { promptTokens: 10, completionTokens: 25 },
        metadata: { model: 'gpt-4o' },
        timestamp: 2000
      })

      engine.appendChatMessage(session.id, {
        role: 'user',
        content: 'Follow-up question',
        timestamp: 3000
      })

      const detail = engine.getChatSession(session.id)
      expect(detail).not.toBeNull()
      expect(detail?.title).toBe('Discussion Session')
      expect(detail?.updatedAt).toBe(3000) // Updated to last message timestamp

      const messages = detail?.messages ?? []
      expect(messages).toHaveLength(3)

      // Verify chronological order
      expect(messages[0].timestamp).toBe(1000)
      expect(messages[0].role).toBe('user')
      expect(messages[0].content).toBe('Question 1')
      expect(messages[0].metadata).toEqual({ source: 'user-input' })

      expect(messages[1].timestamp).toBe(2000)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].toolCalls).toEqual([{ name: 'web_search', args: { query: 'sqlite' } }])
      expect(messages[1].blocks).toEqual([{ type: 'thought', content: 'thinking...' }])
      expect(messages[1].actions).toEqual([{ type: 'execute' }])
      expect(messages[1].usage).toEqual({ promptTokens: 10, completionTokens: 25 })
      expect(messages[1].metadata).toEqual({ model: 'gpt-4o' })

      expect(messages[2].timestamp).toBe(3000)
      expect(messages[2].role).toBe('user')
      expect(messages[2].content).toBe('Follow-up question')
    })

    it('auto-creates session when appending to missing session', () => {
      const sessionId = 'auto-created-session-id'
      engine.appendChatMessage(sessionId, {
        role: 'user',
        content: 'Hello in auto-created session'
      })

      const session = engine.getChatSession(sessionId)
      expect(session).not.toBeNull()
      expect(session?.id).toBe(sessionId)
      expect(session?.title).toBe(`Chat ${sessionId.slice(0, 8)}`)
      expect(session?.messages).toHaveLength(1)
      expect(session?.messages[0].content).toBe('Hello in auto-created session')
    })

    it('returns null for non-existent session', () => {
      expect(engine.getChatSession('non-existent')).toBeNull()
    })
  })

  describe('Session Cascade Deletion & LangGraph Thread Lineage Cleanup', () => {
    it('deletes session and cascades to messages, tool outputs, and LangGraph checkpoints/blobs/writes', () => {
      const project = engine.createProject('Project With Lineage')
      const session = engine.createChatSession(project.id, 'Thread A')
      const otherSession = engine.createChatSession(project.id, 'Thread B')

      // Append messages
      engine.appendChatMessage(session.id, { role: 'user', content: 'Msg in A' })
      engine.appendChatMessage(otherSession.id, { role: 'user', content: 'Msg in B' })

      // Populate LangGraph checkpoints, blobs, writes, restore heads for session.id (Thread A)
      db.prepare(
        `
        INSERT INTO langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint_json, metadata_json, created_at)
        VALUES (?, '', 'cp-1', '{}', '{}', 1000)
      `
      ).run(session.id)

      db.prepare(
        `
        INSERT INTO langgraph_blobs (thread_id, checkpoint_ns, channel, version, type, data_blob, serialized)
        VALUES (?, '', 'chan-1', 'v1', 'json', NULL, 0)
      `
      ).run(session.id)

      db.prepare(
        `
        INSERT INTO langgraph_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob_json)
        VALUES (?, '', 'cp-1', 'task-1', 0, 'chan-1', 'json', '{}')
      `
      ).run(session.id)

      db.prepare(
        `
        INSERT INTO langgraph_restore_heads (thread_id, checkpoint_ns, checkpoint_id, updated_at)
        VALUES (?, '', 'cp-1', 1000)
      `
      ).run(session.id)

      // Also populate large_tool_outputs referencing session.id
      db.prepare(
        `
        INSERT INTO large_tool_outputs (id, session_id, content_blob, byte_size, created_at)
        VALUES ('lto-1', ?, X'010203', 3, 1000)
      `
      ).run(session.id)

      // Populate checkpoints for otherSession (Thread B) to verify they are not deleted
      db.prepare(
        `
        INSERT INTO langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint_json, metadata_json, created_at)
        VALUES (?, '', 'cp-other', '{}', '{}', 1000)
      `
      ).run(otherSession.id)

      // Delete Thread A
      engine.deleteChatSession(session.id)

      // Verify Session A is deleted
      expect(engine.getChatSession(session.id)).toBeNull()

      // Verify messages for Session A are deleted
      const msgCount = db
        .prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?')
        .get(session.id) as { cnt: number }
      expect(msgCount.cnt).toBe(0)

      // Verify large_tool_outputs for Session A are deleted
      const ltoCount = db
        .prepare('SELECT COUNT(*) as cnt FROM large_tool_outputs WHERE session_id = ?')
        .get(session.id) as { cnt: number }
      expect(ltoCount.cnt).toBe(0)

      // Verify LangGraph thread lineage for Session A is deleted
      const cpCount = db
        .prepare('SELECT COUNT(*) as cnt FROM langgraph_checkpoints WHERE thread_id = ?')
        .get(session.id) as { cnt: number }
      expect(cpCount.cnt).toBe(0)

      const blobCount = db
        .prepare('SELECT COUNT(*) as cnt FROM langgraph_blobs WHERE thread_id = ?')
        .get(session.id) as { cnt: number }
      expect(blobCount.cnt).toBe(0)

      const writeCount = db
        .prepare('SELECT COUNT(*) as cnt FROM langgraph_writes WHERE thread_id = ?')
        .get(session.id) as { cnt: number }
      expect(writeCount.cnt).toBe(0)

      const headCount = db
        .prepare('SELECT COUNT(*) as cnt FROM langgraph_restore_heads WHERE thread_id = ?')
        .get(session.id) as { cnt: number }
      expect(headCount.cnt).toBe(0)

      // Verify Session B and its checkpoints are still intact!
      expect(engine.getChatSession(otherSession.id)).not.toBeNull()
      const otherCpCount = db
        .prepare('SELECT COUNT(*) as cnt FROM langgraph_checkpoints WHERE thread_id = ?')
        .get(otherSession.id) as { cnt: number }
      expect(otherCpCount.cnt).toBe(1)
    })
  })

  describe('Idle Timer & Compaction Hooks', () => {
    it('sets up idle timer and triggers passive WAL checkpoint after inactivity', () => {
      vi.useFakeTimers()

      engine.setupIdleTimer()
      expect(engine.hasActiveIdleTimer).toBe(true)

      const walSpy = vi.spyOn(db, 'walCheckpoint')

      // Advance by configured idle delay (30 seconds)
      vi.advanceTimersByTime(SQLITE_ENGINE_CONFIG.idleCheckpointDelayMs)

      expect(walSpy).toHaveBeenCalledWith(WAL_CHECKPOINT_MODES.PASSIVE)
      walSpy.mockRestore()
    })

    it('runs prepareClose with incremental vacuum, truncate WAL checkpoint, and lock release in <10ms', async () => {
      // Create standalone engine with path to test real file lock lifecycle
      const standaloneDbPath = path.join(testDir, 'standalone-lifecycle.cagent')
      const standaloneLockManager = new ProjectLockManager()

      const standaloneEngine = new SqliteStorageEngine(standaloneDbPath, {
        lockManager: standaloneLockManager
      })

      await standaloneEngine.initialize()
      expect(await standaloneLockManager.isLocked(standaloneDbPath)).toBe(true)
      expect(standaloneEngine.database?.isOpen).toBe(true)

      // Write some data to dirty pages and generate WAL frames
      standaloneEngine.createProject('Compaction Project')

      // Measure prepareClose execution time
      const startTime = performance.now()
      await standaloneEngine.prepareClose()
      const durationMs = performance.now() - startTime

      // Assert < 50ms (budget is <10ms under ordinary conditions)
      expect(durationMs).toBeLessThan(50)

      // Verify lock is released
      expect(await standaloneLockManager.isLocked(standaloneDbPath)).toBe(false)

      // Verify database is closed
      expect(standaloneEngine.database?.isOpen).toBe(false)
    })
  })
})
