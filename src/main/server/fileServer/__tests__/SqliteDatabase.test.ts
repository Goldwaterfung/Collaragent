import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

describe('SqliteDatabase Integration & Migration Suite', () => {
  let tempDir: string
  let dbPath: string
  let db: SqliteDatabase | null = null

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-sqlite-test-'))
    dbPath = path.join(tempDir, 'test-project.cagent')
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

  it('initializes a fresh database and executes V4 migration setting user_version = 4', () => {
    db = new SqliteDatabase(dbPath)

    expect(db.isOpen).toBe(true)
    expect(db.getUserVersion()).toBe(4)
    expect(db.integrityCheck()).toBe(true)
    expect(db.foreignKeyCheck()).toBe(true)

    // Verify all tables were created
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>

    const tableNames = tables.map((t) => t.name).sort()
    const expectedTables = [
      'chat_messages',
      'chat_sessions',
      'file_revisions',
      'instances',
      'langgraph_blobs',
      'langgraph_checkpoints',
      'langgraph_restore_heads',
      'langgraph_writes',
      'large_tool_outputs',
      'projects',
      'workspace_command_logs',
      'workspace_snapshots'
    ].sort()

    expect(tableNames).toEqual(expectedTables)
  })

  it('enforces runtime PRAGMA configurations', () => {
    db = new SqliteDatabase(dbPath)

    // Note: WAL mode on disk files
    const journalMode = db.pragma('journal_mode', { simple: true })
    expect(journalMode).toBe('wal')

    const foreignKeys = db.pragma('foreign_keys', { simple: true })
    expect(foreignKeys).toBe(1)

    // auto_vacuum = 2 corresponds to INCREMENTAL in SQLite
    const autoVacuum = db.pragma('auto_vacuum', { simple: true })
    expect(autoVacuum).toBe(2)

    // synchronous = 1 corresponds to NORMAL
    const synchronous = db.pragma('synchronous', { simple: true })
    expect(synchronous).toBe(1)
  })

  it('enforces foreign key constraints on insert', () => {
    db = new SqliteDatabase(dbPath)

    // Attempting to insert an instance with non-existent project_id must fail
    expect(() => {
      db!
        .prepare(
          `
        INSERT INTO instances (id, project_id, type, name, created_at, updated_at)
        VALUES ('inst-1', 'non-existent-project', 'document', 'Doc 1', '2026-09-03', '2026-09-03')
      `
        )
        .run()
    }).toThrow(StorageError)

    try {
      db.prepare(
        `
        INSERT INTO instances (id, project_id, type, name, created_at, updated_at)
        VALUES ('inst-1', 'non-existent-project', 'document', 'Doc 1', '2026-09-03', '2026-09-03')
      `
      ).run()
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StorageError)
      const storageErr = err as StorageError
      expect(storageErr.code).toBe(StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION)
    }
  })

  it('cascades deletion from project to child instances, sessions, and messages', () => {
    db = new SqliteDatabase(dbPath)

    const now = Date.now()
    // Insert project
    db.prepare(
      `
      INSERT INTO projects (id, name, created_at, updated_at)
      VALUES ('proj-1', 'Test Project', ?, ?)
    `
    ).run(now, now)

    // Insert instance
    db.prepare(
      `
      INSERT INTO instances (id, project_id, type, name, created_at, updated_at)
      VALUES ('inst-1', 'proj-1', 'canvas', 'Main Canvas', '2026-09-03', '2026-09-03')
    `
    ).run()

    // Insert chat session
    db.prepare(
      `
      INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
      VALUES ('session-1', 'proj-1', 'Session 1', ?, ?)
    `
    ).run(now, now)

    // Insert chat message
    db.prepare(
      `
      INSERT INTO chat_messages (id, session_id, role, content, timestamp)
      VALUES ('msg-1', 'session-1', 'user', 'Hello Agent', ?)
    `
    ).run(now)

    // Verify insertion
    const instanceBefore = db.prepare('SELECT id FROM instances WHERE id = ?').get('inst-1')
    const sessionBefore = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get('session-1')
    const msgBefore = db.prepare('SELECT id FROM chat_messages WHERE id = ?').get('msg-1')
    expect(instanceBefore).toBeDefined()
    expect(sessionBefore).toBeDefined()
    expect(msgBefore).toBeDefined()

    // Delete project
    db.prepare('DELETE FROM projects WHERE id = ?').run('proj-1')

    // Verify cascaded deletion
    const instanceAfter = db.prepare('SELECT id FROM instances WHERE id = ?').get('inst-1')
    const sessionAfter = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get('session-1')
    const msgAfter = db.prepare('SELECT id FROM chat_messages WHERE id = ?').get('msg-1')
    expect(instanceAfter).toBeUndefined()
    expect(sessionAfter).toBeUndefined()
    expect(msgAfter).toBeUndefined()
  })

  it('commits changes on successful transaction and rolls back on failure', () => {
    db = new SqliteDatabase(dbPath)

    const now = Date.now()
    // Successful transaction
    db.immediateTransaction(() => {
      db!
        .prepare(
          `
        INSERT INTO projects (id, name, created_at, updated_at)
        VALUES ('proj-atomic', 'Atomic Project', ?, ?)
      `
        )
        .run(now, now)
    })

    const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get('proj-atomic')
    expect(project).toEqual({ id: 'proj-atomic', name: 'Atomic Project' })

    // Failing transaction
    expect(() => {
      db!.immediateTransaction(() => {
        db!
          .prepare(
            `
          INSERT INTO projects (id, name, created_at, updated_at)
          VALUES ('proj-should-rollback', 'Rollback Project', ?, ?)
        `
          )
          .run(now, now)
        throw new Error('Intentional crash inside transaction')
      })
    }).toThrow(StorageError)

    const rolledBack = db
      .prepare('SELECT id FROM projects WHERE id = ?')
      .get('proj-should-rollback')
    expect(rolledBack).toBeUndefined()
  })

  it('runs walCheckpoint and incrementalVacuum without error', () => {
    db = new SqliteDatabase(dbPath)

    expect(() => {
      db!.walCheckpoint('PASSIVE')
      db!.walCheckpoint('TRUNCATE')
      db!.incrementalVacuum(100)
    }).not.toThrow()
  })

  it('closes cleanly and updates isOpen property', () => {
    db = new SqliteDatabase(dbPath)
    expect(db.isOpen).toBe(true)
    db.close()
    expect(db.isOpen).toBe(false)
  })
})
