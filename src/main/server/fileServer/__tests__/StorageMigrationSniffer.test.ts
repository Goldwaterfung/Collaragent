import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  detectStorageFormat,
  createSafetyBackup,
  StorageMigrationEngine,
  type MigrationProgress
} from '../StorageMigrationEngine'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'
import { SQLITE_MAGIC_HEADER, ZIP_MAGIC_HEADER } from '../config/sqliteConfig'

describe('StorageMigrationEngine - Sniffer & Safety Backup (Task 4.1)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-migrate-sniffer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore teardown errors
    }
  })

  describe('detectStorageFormat', () => {
    it('detects a genuine SQLite database file as v4_sqlite', () => {
      const dbPath = path.join(testDir, 'test.cagent')
      const db = new SqliteDatabase(dbPath)
      db.close()

      const format = detectStorageFormat(dbPath)
      expect(format).toBe('v4_sqlite')
    })

    it('detects a file with SQLite header bytes as v4_sqlite', () => {
      const filePath = path.join(testDir, 'sqlite-header.cagent')
      const payload = Buffer.concat([SQLITE_MAGIC_HEADER, Buffer.alloc(100)])
      fs.writeFileSync(filePath, payload)

      const format = detectStorageFormat(filePath)
      expect(format).toBe('v4_sqlite')
    })

    it('detects a file starting with PK\\x03\\x04 as legacy_zip', () => {
      const zipPath = path.join(testDir, 'legacy.cagent')
      const zipPayload = Buffer.concat([ZIP_MAGIC_HEADER, Buffer.from('dummy zip file payload')])
      fs.writeFileSync(zipPath, zipPayload)

      const format = detectStorageFormat(zipPath)
      expect(format).toBe('legacy_zip')
    })

    it('returns unknown for non-existent file path', () => {
      const nonExistent = path.join(testDir, 'does-not-exist.cagent')
      const format = detectStorageFormat(nonExistent)
      expect(format).toBe('unknown')
    })

    it('returns unknown for empty file', () => {
      const emptyPath = path.join(testDir, 'empty.cagent')
      fs.writeFileSync(emptyPath, Buffer.alloc(0))

      const format = detectStorageFormat(emptyPath)
      expect(format).toBe('unknown')
    })

    it('returns unknown for files smaller than 4 bytes', () => {
      const shortPath = path.join(testDir, 'short.cagent')
      fs.writeFileSync(shortPath, Buffer.from([0x50, 0x4b]))

      const format = detectStorageFormat(shortPath)
      expect(format).toBe('unknown')
    })

    it('returns unknown for arbitrary text or JSON files', () => {
      const jsonPath = path.join(testDir, 'random.json')
      fs.writeFileSync(jsonPath, JSON.stringify({ hello: 'world' }))

      const format = detectStorageFormat(jsonPath)
      expect(format).toBe('unknown')
    })
  })

  describe('createSafetyBackup', () => {
    it('creates a .v3.bak copy of the source archive', async () => {
      const sourceFile = path.join(testDir, 'my-project.cagent')
      fs.writeFileSync(sourceFile, Buffer.from('important archive data'))

      const backupPath = await createSafetyBackup(sourceFile)
      expect(backupPath).toBe(`${sourceFile}.v3.bak`)
      expect(fs.existsSync(backupPath)).toBe(true)

      const backupContent = fs.readFileSync(backupPath, 'utf8')
      expect(backupContent).toBe('important archive data')
    })

    it('throws StorageError when source file does not exist', async () => {
      const missingFile = path.join(testDir, 'missing.cagent')

      await expect(createSafetyBackup(missingFile)).rejects.toThrowError(StorageError)
      await expect(createSafetyBackup(missingFile)).rejects.toMatchObject({
        code: StorageErrorCode.STORAGE_MIGRATION_FAILED
      })
    })

    it('appends timestamp when .v3.bak already exists without overwriting original backup', async () => {
      const sourceFile = path.join(testDir, 'project.cagent')
      fs.writeFileSync(sourceFile, Buffer.from('v3 original archive'))

      // Create primary backup
      const firstBackup = await createSafetyBackup(sourceFile)
      expect(firstBackup).toBe(`${sourceFile}.v3.bak`)
      fs.writeFileSync(firstBackup, Buffer.from('preserved first backup'))

      // Change source file slightly
      fs.writeFileSync(sourceFile, Buffer.from('modified archive'))

      // Create second backup: should not overwrite primary
      const secondBackup = await createSafetyBackup(sourceFile)
      expect(secondBackup).not.toBe(firstBackup)
      expect(secondBackup).toMatch(/\.v3\.\d+.*\.bak$/)

      // Verify first backup is preserved and untouched
      expect(fs.readFileSync(firstBackup, 'utf8')).toBe('preserved first backup')
      // Verify second backup contains the current source
      expect(fs.readFileSync(secondBackup, 'utf8')).toBe('modified archive')
    })
  })

  describe('StorageMigrationEngine Integration', () => {
    it('streams progress callbacks during format detection and backup', async () => {
      const events: MigrationProgress[] = []
      const engine = new StorageMigrationEngine({
        onProgress: (progress) => events.push(progress)
      })

      const sourceFile = path.join(testDir, 'agent.cagent')
      fs.writeFileSync(sourceFile, Buffer.concat([ZIP_MAGIC_HEADER, Buffer.from('zip contents')]))

      const format = engine.detectFormat(sourceFile)
      expect(format).toBe('legacy_zip')

      const backupPath = await engine.backup(sourceFile)
      expect(fs.existsSync(backupPath)).toBe(true)

      expect(events.length).toBeGreaterThanOrEqual(4)
      expect(events[0].stage).toBe('sniffing')
      expect(events[1].stage).toBe('sniffing')
      expect(events[2].stage).toBe('backup')
      expect(events[3].stage).toBe('backup')
    })
  })
})
