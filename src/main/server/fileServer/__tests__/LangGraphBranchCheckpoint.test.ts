import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Checkpoint } from '@langchain/langgraph-checkpoint'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteCheckpointStore } from '../SqliteCheckpointStore'
import { FileSystemSaver } from '../FileSystemSaver'

describe('LangGraph Branch Checkpoint & Time Travel Suite (Fix for Divergent State Bug)', () => {
  let tempDir: string
  let dbPath: string
  let db: SqliteDatabase | null = null
  let store: SqliteCheckpointStore | null = null
  let saver: FileSystemSaver | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-branch-test-'))
    dbPath = path.join(tempDir, 'test-branch.cagent')
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

  it('prevents cross-branch state poisoning when version numbers repeat across branches', async () => {
    const threadId = 'thread-branch-collision'

    // Turn 1, Turn 2, Turn 3 (Shared base trajectory)
    const turn1Checkpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-1',
      ts: new Date('2026-09-01T10:00:00Z').toISOString(),
      channel_versions: { messages: '1' },
      versions_seen: { agent: { messages: '1' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId } },
      turn1Checkpoint,
      { source: 'input', step: 1, parents: {} },
      { messages: '1' }
    )

    const turn2Checkpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-2',
      ts: new Date('2026-09-01T10:01:00Z').toISOString(),
      channel_versions: { messages: '2' },
      versions_seen: { agent: { messages: '2' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-1' } },
      turn2Checkpoint,
      { source: 'loop', step: 2, parents: {} },
      { messages: '2' }
    )

    const turn3Checkpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-3',
      ts: new Date('2026-09-01T10:02:00Z').toISOString(),
      channel_versions: { messages: '3' },
      versions_seen: { agent: { messages: '3' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' },
          { role: 'user', content: 'Turn 3: Explain your architecture' },
          { role: 'assistant', content: 'Turn 3: Local-first with SQLite' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-2' } },
      turn3Checkpoint,
      { source: 'loop', step: 3, parents: {} },
      { messages: '3' }
    )

    // Branch A: Turns 4A and 5A (e.g. Grounded and Comment questions)
    const turn4ACheckpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-4a',
      ts: new Date('2026-09-01T10:03:00Z').toISOString(),
      channel_versions: { messages: '4' },
      versions_seen: { agent: { messages: '4' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' },
          { role: 'user', content: 'Turn 3: Explain your architecture' },
          { role: 'assistant', content: 'Turn 3: Local-first with SQLite' },
          { role: 'user', content: 'Turn 4A: What is grounded execution?' },
          { role: 'assistant', content: 'Turn 4A: It grounds statements in evidence' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-3' } },
      turn4ACheckpoint,
      { source: 'loop', step: 4, parents: {} },
      { messages: '4' }
    )

    const turn5ACheckpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-5a',
      ts: new Date('2026-09-01T10:04:00Z').toISOString(),
      channel_versions: { messages: '5' },
      versions_seen: { agent: { messages: '5' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' },
          { role: 'user', content: 'Turn 3: Explain your architecture' },
          { role: 'assistant', content: 'Turn 3: Local-first with SQLite' },
          { role: 'user', content: 'Turn 4A: What is grounded execution?' },
          { role: 'assistant', content: 'Turn 4A: It grounds statements in evidence' },
          { role: 'user', content: 'Turn 5A: Add a comment' },
          { role: 'assistant', content: 'Turn 5A: Comment recorded' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-4a' } },
      turn5ACheckpoint,
      { source: 'loop', step: 5, parents: {} },
      { messages: '5' }
    )

    // User restores back to Turn 3
    await saver!.setRestoreHead(threadId, 'cp-turn-3')

    // Branch B: Turns 4B and 5B
    // LangGraph steps advance from parent (step 3 -> step 4 -> step 5), reusing channel versions '4' and '5'!
    const turn4BCheckpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-4b',
      ts: new Date('2026-09-01T10:10:00Z').toISOString(),
      channel_versions: { messages: '4' }, // Same version '4' as Branch A!
      versions_seen: { agent: { messages: '4' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' },
          { role: 'user', content: 'Turn 3: Explain your architecture' },
          { role: 'assistant', content: 'Turn 3: Local-first with SQLite' },
          { role: 'user', content: 'Turn 4B: Explain Noise by Kahneman' },
          { role: 'assistant', content: 'Turn 4B: Noise is unwanted variability in judgments' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-3' } },
      turn4BCheckpoint,
      { source: 'loop', step: 4, parents: {} },
      { messages: '4' }
    )

    const turn5BCheckpoint: Checkpoint = {
      v: 1,
      id: 'cp-turn-5b',
      ts: new Date('2026-09-01T10:11:00Z').toISOString(),
      channel_versions: { messages: '5' }, // Same version '5' as Branch A!
      versions_seen: { agent: { messages: '5' } },
      channel_values: {
        messages: [
          { role: 'user', content: 'Turn 1: Introduce yourself' },
          { role: 'assistant', content: 'Turn 1: I am CollarAgent' },
          { role: 'user', content: 'Turn 2: What is your purpose?' },
          { role: 'assistant', content: 'Turn 2: Assisting your research' },
          { role: 'user', content: 'Turn 3: Explain your architecture' },
          { role: 'assistant', content: 'Turn 3: Local-first with SQLite' },
          { role: 'user', content: 'Turn 4B: Explain Noise by Kahneman' },
          { role: 'assistant', content: 'Turn 4B: Noise is unwanted variability in judgments' },
          { role: 'user', content: 'Turn 5B: Produce a table of biases' },
          { role: 'assistant', content: 'Turn 5B: Here is the noise audit table' }
        ]
      }
    }
    await saver!.put(
      { configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-4b' } },
      turn5BCheckpoint,
      { source: 'loop', step: 5, parents: {} },
      { messages: '5' }
    )

    // Verification 1: Reading Turn 4B must return Turn 4B messages and NOT 4A
    const tuple4B = await saver!.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-4b' }
    })
    expect(tuple4B).toBeDefined()
    const msgs4B = tuple4B?.checkpoint.channel_values.messages as Array<{
      role: string
      content: string
    }>
    expect(msgs4B).toHaveLength(8)
    expect(msgs4B[6]?.content).toBe('Turn 4B: Explain Noise by Kahneman')
    expect(msgs4B[7]?.content).toBe('Turn 4B: Noise is unwanted variability in judgments')

    // Ensure NO trace of Branch A in Turn 4B
    const hasBranchAIn4B = msgs4B.some((m) => m.content.includes('4A'))
    expect(hasBranchAIn4B).toBe(false)

    // Verification 2: Reading Turn 5B must return Turn 4B & 5B messages and NOT 4A or 5A
    const tuple5B = await saver!.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-5b' }
    })
    expect(tuple5B).toBeDefined()
    const msgs5B = tuple5B?.checkpoint.channel_values.messages as Array<{
      role: string
      content: string
    }>
    expect(msgs5B).toHaveLength(10)
    expect(msgs5B[6]?.content).toBe('Turn 4B: Explain Noise by Kahneman')
    expect(msgs5B[8]?.content).toBe('Turn 5B: Produce a table of biases')

    const hasBranchAIn5B = msgs5B.some((m) => m.content.includes('4A') || m.content.includes('5A'))
    expect(hasBranchAIn5B).toBe(false)

    // Verification 3: Reading latest without checkpoint_id must return Turn 5B (active branch head)
    const latestTuple = await saver!.getTuple({
      configurable: { thread_id: threadId }
    })
    expect(latestTuple).toBeDefined()
    expect(latestTuple?.checkpoint.id).toBe('cp-turn-5b')

    // Verification 4: Non-destructive time travel - Branch A is still fully intact!
    const tuple5A = await saver!.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: 'cp-turn-5a' }
    })
    expect(tuple5A).toBeDefined()
    const msgs5A = tuple5A?.checkpoint.channel_values.messages as Array<{
      role: string
      content: string
    }>
    expect(msgs5A).toHaveLength(10)
    expect(msgs5A[6]?.content).toBe('Turn 4A: What is grounded execution?')
    expect(msgs5A[8]?.content).toBe('Turn 5A: Add a comment')

    const hasBranchBIn5A = msgs5A.some((m) => m.content.includes('4B') || m.content.includes('5B'))
    expect(hasBranchBIn5A).toBe(false)
  })

  it('correctly backfills legacy unmigrated databases with missing channel_values in checkpoint_json', () => {
    // Seed a legacy database simulating V5 state: checkpoints without channel_values, blobs in langgraph_blobs
    const legacyDbPath = path.join(tempDir, 'legacy-v5.cagent')
    const rawDb = new SqliteDatabase(legacyDbPath)

    const threadId = 'thread-legacy-backfill'
    const cpId = 'cp-legacy-1'

    rawDb.immediateTransaction(() => {
      // Insert checkpoint without channel_values
      rawDb
        .prepare(
          `INSERT INTO langgraph_checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at)
           VALUES (?, '', ?, NULL, ?, '{}', ?)`
        )
        .run(
          threadId,
          cpId,
          JSON.stringify({
            v: 1,
            id: cpId,
            ts: '2026-09-01T00:00:00Z',
            channel_versions: { messages: '1' },
            versions_seen: {}
          }),
          1700000000000
        )

      // Insert blob into langgraph_blobs
      rawDb
        .prepare(
          `INSERT INTO langgraph_blobs
           (thread_id, checkpoint_ns, channel, version, type, data_blob, serialized)
           VALUES (?, '', 'messages', '1', 'json', ?, 0)`
        )
        .run(
          threadId,
          Buffer.from(
            JSON.stringify([{ role: 'user', content: 'Legacy question from unmigrated db' }]),
            'utf8'
          )
        )
    })

    // Reset user_version to 5 to trigger migration 003 on next open
    rawDb.pragma('user_version = 5')
    rawDb.close()

    // Re-open with autoMigrate to trigger backfill
    const migratedDb = new SqliteDatabase(legacyDbPath)
    expect(migratedDb.getUserVersion()).toBe(7)

    // Inspect checkpoint_json in database: it should now have channel_values embedded
    const row = migratedDb
      .prepare('SELECT checkpoint_json FROM langgraph_checkpoints WHERE checkpoint_id = ?')
      .get(cpId) as { checkpoint_json: string }

    const parsed = JSON.parse(row.checkpoint_json) as Record<string, unknown>
    expect(parsed.channel_values).toBeDefined()
    const cv = parsed.channel_values as Record<string, unknown>
    expect(cv.messages).toBeDefined()

    migratedDb.close()
  })

  it('safely migrates and inspects real interview database if present on disk', async () => {
    const realDbPath = '/Users/goldenfung/Documents/interview/oursky.cagent'
    if (!fs.existsSync(realDbPath)) {
      return
    }

    const testCopyPath = path.join(tempDir, 'oursky-test-copy.cagent')
    fs.copyFileSync(realDbPath, testCopyPath)

    const realDb = new SqliteDatabase(testCopyPath)
    expect(realDb.getUserVersion()).toBe(7)

    const realStore = new SqliteCheckpointStore(realDb)
    const realSaver = new FileSystemSaver(realStore)

    const threadRow = realDb
      .prepare('SELECT thread_id FROM langgraph_checkpoints LIMIT 1')
      .get() as { thread_id?: string } | undefined
    if (!threadRow?.thread_id) {
      realDb.close()
      return
    }
    const threadId = threadRow.thread_id
    const checkpoints = await realStore.getCheckpoints(threadId)
    expect(checkpoints.length).toBeGreaterThan(0)

    // Test getTuple on the latest checkpoint
    const latestTuple = await realSaver.getTuple({
      configurable: { thread_id: threadId }
    })
    expect(latestTuple).toBeDefined()
    expect(latestTuple?.checkpoint.channel_values).toBeDefined()

    realDb.close()
  })
})
