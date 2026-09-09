import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { ProjectLockManager } from '../locks/ProjectLockManager'

describe('True DAG Chat Timeline Suite (Option A: Non-Destructive Branching)', () => {
  let tempDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let engine: SqliteStorageEngine

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `collar-dag-chat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(tempDir, { recursive: true })
    dbFilePath = path.join(tempDir, 'dag-chat.cagent')

    db = new SqliteDatabase(dbFilePath)
    engine = new SqliteStorageEngine(db, {
      cagentPath: dbFilePath,
      lockManager: new ProjectLockManager()
    })
  })

  afterEach(async () => {
    await engine.close()
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('builds linear DAG parent pointers and updates session active_message_id on append', () => {
    const project = engine.createProject('Linear DAG Project')
    const session = engine.createChatSession(project.id, 'Linear Session')

    const m1Id = 'msg-1'
    const m2Id = 'msg-2'

    engine.appendChatMessage(session.id, {
      id: m1Id,
      role: 'user',
      content: 'Hello turn 1',
      timestamp: 1000
    })

    engine.appendChatMessage(session.id, {
      id: m2Id,
      role: 'assistant',
      content: 'Reply turn 1',
      timestamp: 2000,
      checkpointId: 'cp-turn-1'
    })

    const detail = engine.getChatSession(session.id)
    expect(detail).not.toBeNull()
    expect(detail?.activeMessageId).toBe(m2Id)
    expect(detail?.activeCheckpointId).toBe('cp-turn-1')

    const messages = detail?.messages ?? []
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe(m1Id)
    expect(messages[0].parentMessageId).toBeNull()
    expect(messages[1].id).toBe(m2Id)
    expect(messages[1].parentMessageId).toBe(m1Id)
    expect(messages[1].checkpointId).toBe('cp-turn-1')
  })

  it('supports non-destructive branching, CTE traversal, and seamless multi-branch switching', () => {
    const project = engine.createProject('Branching DAG Project')
    const session = engine.createChatSession(project.id, 'Branching Session')

    // Turn 1
    const m1 = 'm1-user'
    const m2 = 'm2-asst'
    engine.appendChatMessage(session.id, { id: m1, role: 'user', content: 'Q1', timestamp: 1000 })
    engine.appendChatMessage(session.id, {
      id: m2,
      role: 'assistant',
      content: 'A1',
      timestamp: 2000,
      checkpointId: 'cp-1'
    })

    // Turn 2 Branch A
    const m3a = 'm3a-user'
    const m4a = 'm4a-asst'
    engine.appendChatMessage(session.id, {
      id: m3a,
      role: 'user',
      content: 'Q2 (Branch A)',
      timestamp: 3000
    })
    engine.appendChatMessage(session.id, {
      id: m4a,
      role: 'assistant',
      content: 'A2 (Branch A)',
      timestamp: 4000,
      checkpointId: 'cp-2a'
    })

    // Active branch A contains [m1, m2, m3a, m4a]
    let activeMessages = engine.getChatMessages(session.id)
    expect(activeMessages.map((m) => m.id)).toEqual([m1, m2, m3a, m4a])

    // Time-travel restore back to Turn 1 assistant message (m2)
    const switchOk = engine.setActiveBranch(session.id, m2, 'cp-1')
    expect(switchOk).toBe(true)

    // Verify active branch now only reflects [m1, m2]
    activeMessages = engine.getChatMessages(session.id)
    expect(activeMessages.map((m) => m.id)).toEqual([m1, m2])

    // Now branch off from m2 to create Branch B
    const m3b = 'm3b-user'
    const m4b = 'm4b-asst'
    engine.appendChatMessage(session.id, {
      id: m3b,
      role: 'user',
      content: 'Q2 (Branch B)',
      timestamp: 5000
    })
    engine.appendChatMessage(session.id, {
      id: m4b,
      role: 'assistant',
      content: 'A2 (Branch B)',
      timestamp: 6000,
      checkpointId: 'cp-2b'
    })

    // Active branch B contains [m1, m2, m3b, m4b]
    activeMessages = engine.getChatMessages(session.id)
    expect(activeMessages.map((m) => m.id)).toEqual([m1, m2, m3b, m4b])
    expect(activeMessages[2].parentMessageId).toBe(m2)
    expect(activeMessages[3].parentMessageId).toBe(m3b)

    // Critical assertion: Branch A messages STILL EXIST in database! Zero data loss!
    const allRows = db
      .prepare('SELECT id FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC')
      .all(session.id) as Array<{ id: string }>
    expect(allRows.map((r) => r.id)).toEqual([m1, m2, m3a, m4a, m3b, m4b])

    // Discover child branches branching off from m2
    const childrenOfM2 = engine.getMessageChildren(session.id, m2)
    expect(childrenOfM2.map((c) => c.id)).toEqual([m3a, m3b])

    // Switch active branch back to Branch A (m4a)
    engine.setActiveBranch(session.id, m4a, 'cp-2a')
    activeMessages = engine.getChatMessages(session.id)
    expect(activeMessages.map((m) => m.id)).toEqual([m1, m2, m3a, m4a])

    // Switch active branch back to Branch B (m4b)
    engine.setActiveBranch(session.id, m4b, 'cp-2b')
    activeMessages = engine.getChatMessages(session.id)
    expect(activeMessages.map((m) => m.id)).toEqual([m1, m2, m3b, m4b])
  })

  it('truncateChatSession acts non-destructively by setting active branch pointer', () => {
    const project = engine.createProject('Truncate Project')
    const session = engine.createChatSession(project.id, 'Truncate Session')

    engine.appendChatMessage(session.id, {
      id: 'msg-1',
      role: 'user',
      content: 'Turn 1',
      timestamp: 1000
    })
    engine.appendChatMessage(session.id, {
      id: 'msg-2',
      role: 'assistant',
      content: 'Reply 1',
      timestamp: 2000
    })
    engine.appendChatMessage(session.id, {
      id: 'msg-3',
      role: 'user',
      content: 'Turn 2',
      timestamp: 3000
    })
    engine.appendChatMessage(session.id, {
      id: 'msg-4',
      role: 'assistant',
      content: 'Reply 2',
      timestamp: 4000
    })

    expect(engine.getChatMessages(session.id)).toHaveLength(4)

    // Truncate to msg-2
    const ok = engine.truncateChatSession(session.id, 'msg-2')
    expect(ok).toBe(true)

    // Active messages are truncated to msg-1, msg-2
    const active = engine.getChatMessages(session.id)
    expect(active.map((m) => m.id)).toEqual(['msg-1', 'msg-2'])

    // Physical rows on disk are NOT deleted
    const count = db
      .prepare('SELECT count(*) as count FROM chat_messages WHERE session_id = ?')
      .get(session.id) as { count: number }
    expect(count.count).toBe(4)
  })

  it('clearChatSession resets active pointers and deletes messages without foreign key error', () => {
    const project = engine.createProject('Clear Project')
    const session = engine.createChatSession(project.id, 'Clear Session')

    engine.appendChatMessage(session.id, { id: 'msg-1', role: 'user', content: 'Turn 1' })
    engine.appendChatMessage(session.id, { id: 'msg-2', role: 'assistant', content: 'Reply 1' })

    expect(engine.getChatMessages(session.id)).toHaveLength(2)

    engine.clearChatSession(session.id)

    const detail = engine.getChatSession(session.id)
    expect(detail?.activeMessageId).toBeNull()
    expect(detail?.messages).toHaveLength(0)
    expect(db.foreignKeyCheck()).toBe(true)
  })

  it('backfills legacy historical messages into valid DAG lineage on migration', () => {
    const legacyPath = path.join(tempDir, 'legacy-dag-test.cagent')
    const rawDb = new SqliteDatabase(legacyPath)

    // Manually insert unlinked messages (simulating legacy database before migration 004)
    const projId = 'legacy-proj'
    const sessId = 'legacy-sess'
    rawDb.immediateTransaction(() => {
      rawDb
        .prepare(
          'INSERT INTO projects (id, name, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(projId, 'Legacy Proj', '{}', 1000, 1000)

      rawDb
        .prepare(
          'INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at, active_message_id, active_checkpoint_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(sessId, projId, 'Legacy Chat', 1000, 1000, null, null)

      // Set parent_message_id to null explicitly
      const insertMsg = rawDb.prepare(`
        INSERT INTO chat_messages
        (id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp, parent_message_id)
        VALUES (?, ?, ?, ?, '[]', '[]', '[]', null, '{}', ?, null)
      `)

      insertMsg.run('m1', sessId, 'user', 'First question', 1000)
      insertMsg.run('m2', sessId, 'assistant', 'First answer', 2000)
      insertMsg.run('m3', sessId, 'user', 'Second question', 3000)
      insertMsg.run('m4', sessId, 'assistant', 'Second answer', 4000)
    })

    // Run backfill
    rawDb.backfillChatDagLineage()

    // Inspect session active_message_id
    const sessionRow = rawDb
      .prepare('SELECT active_message_id FROM chat_sessions WHERE id = ?')
      .get(sessId) as { active_message_id: string }
    expect(sessionRow.active_message_id).toBe('m4')

    // Inspect parent pointers
    const rows = rawDb
      .prepare(
        'SELECT id, parent_message_id FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC'
      )
      .all(sessId) as Array<{ id: string; parent_message_id: string | null }>

    expect(rows[0]).toEqual({ id: 'm1', parent_message_id: null })
    expect(rows[1]).toEqual({ id: 'm2', parent_message_id: 'm1' })
    expect(rows[2]).toEqual({ id: 'm3', parent_message_id: 'm2' })
    expect(rows[3]).toEqual({ id: 'm4', parent_message_id: 'm3' })

    const legacyEngine = new SqliteStorageEngine(rawDb, {
      cagentPath: legacyPath,
      lockManager: new ProjectLockManager()
    })

    const messages = legacyEngine.getChatMessages(sessId)
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])

    rawDb.close()
  })
})
