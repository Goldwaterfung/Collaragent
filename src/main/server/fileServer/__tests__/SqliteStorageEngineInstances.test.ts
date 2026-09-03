import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unpack } from 'msgpackr'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

describe('SqliteStorageEngine - Projects, Instances & Snapshots', () => {
  let db: SqliteDatabase
  let engine: SqliteStorageEngine
  let testDir: string
  let dbFilePath: string

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-engine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'test-storage.cagent')

    db = new SqliteDatabase(dbFilePath)
    engine = new SqliteStorageEngine(db)
  })

  afterEach(async () => {
    await engine.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  describe('Projects Management', () => {
    it('creates and lists projects with metadata', () => {
      const initial = engine.getProjects()
      expect(initial).toEqual([])

      const created = engine.createProject('Test Project', { author: 'Alice', version: 1 })
      expect(created.name).toBe('Test Project')
      expect(created.metadata).toEqual({ author: 'Alice', version: 1 })
      expect(typeof created.id).toBe('string')
      expect(typeof created.createdAt).toBe('number')
      expect(typeof created.updatedAt).toBe('number')

      const all = engine.getProjects()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe(created.id)
      expect(all[0].name).toBe('Test Project')
      expect(all[0].metadata).toEqual({ author: 'Alice', version: 1 })

      const byId = engine.getProjectById(created.id)
      expect(byId).not.toBeNull()
      expect(byId?.id).toBe(created.id)

      expect(engine.getProjectById('non-existent-id')).toBeNull()
    })
  })

  describe('Lazy Instance Metadata & Content Streaming', () => {
    it('creates canvas and document instances and queries metadata without loading BLOBs', () => {
      const project = engine.createProject('Main Project')

      const canvasData = { nodes: [{ id: 'n1', x: 10, y: 20 }], edges: [] }
      const docData = { root: { children: [{ type: 'paragraph', text: 'Hello Lexical' }] } }

      const canvasSummary = engine.createInstance('canvas', {
        projectId: project.id,
        name: 'Concept Canvas',
        payload: canvasData,
        metadata: { zoom: 1.0 }
      })

      const docSummary = engine.createInstance('document', {
        projectId: project.id,
        name: 'Research Paper',
        payload: docData,
        metadata: { wordCount: 42 }
      })

      expect(canvasSummary.name).toBe('Concept Canvas')
      expect(canvasSummary.type).toBe('canvas')
      expect(canvasSummary.metadata).toEqual({ zoom: 1.0 })

      expect(docSummary.name).toBe('Research Paper')
      expect(docSummary.type).toBe('document')
      expect(docSummary.metadata).toEqual({ wordCount: 42 })

      // Listing metadata: ensures metadata is returned but content_msgpack is not in InstanceSummary
      const instances = engine.getInstancesMeta(project.id)
      expect(instances).toHaveLength(2)
      expect(instances.map((i) => i.name)).toEqual(['Concept Canvas', 'Research Paper'])

      // Ensure that getInstancesMeta does NOT attach payload
      for (const inst of instances) {
        expect('payload' in inst).toBe(false)
        expect('content_msgpack' in inst).toBe(false)
      }

      // Stream content on demand
      const canvasBuffer = engine.getInstanceContent(canvasSummary.id)
      expect(canvasBuffer).not.toBeNull()
      expect(Buffer.isBuffer(canvasBuffer)).toBe(true)
      const unpackedCanvas = unpack(canvasBuffer as Buffer)
      expect(unpackedCanvas).toEqual(canvasData)

      const docBuffer = engine.getInstanceContent(docSummary.id)
      expect(docBuffer).not.toBeNull()
      expect(Buffer.isBuffer(docBuffer)).toBe(true)
      const unpackedDoc = unpack(docBuffer as Buffer)
      expect(unpackedDoc).toEqual(docData)

      // Non-existent instance returns null
      expect(engine.getInstanceContent('missing-id')).toBeNull()
    })

    it('updates instance name, payload, and metadata', () => {
      const project = engine.createProject('Project')
      const inst = engine.createInstance('document', {
        projectId: project.id,
        name: 'Initial Doc',
        payload: { text: 'Draft 1' }
      })

      // Update name and payload
      engine.updateInstance(inst.id, {
        name: 'Revised Doc',
        payload: { text: 'Draft 2' },
        metadata: { revised: true }
      })

      const updatedMeta = engine.getInstancesMeta(project.id).find((i) => i.id === inst.id)
      expect(updatedMeta?.name).toBe('Revised Doc')
      expect(updatedMeta?.metadata).toEqual({ revised: true })

      const updatedContent = engine.getInstanceContent(inst.id)
      expect(updatedContent).not.toBeNull()
      expect(unpack(updatedContent as Buffer)).toEqual({ text: 'Draft 2' })
    })

    it('throws STORAGE_INSTANCE_NOT_FOUND when updating non-existent instance', () => {
      expect(() => {
        engine.updateInstance('non-existent-instance', { name: 'New Name' })
      }).toThrowError(StorageError)

      try {
        engine.updateInstance('non-existent-instance', { name: 'New Name' })
      } catch (err: unknown) {
        const storageErr = err as StorageError
        expect(storageErr.code).toBe(StorageErrorCode.STORAGE_INSTANCE_NOT_FOUND)
      }
    })

    it('deletes instance and cascades to snapshots and command logs', () => {
      const project = engine.createProject('Project')
      const inst = engine.createInstance('document', {
        projectId: project.id,
        name: 'Doc To Delete',
        payload: { text: 'Temporary' }
      })

      // Add snapshot and command log
      engine.createSnapshot({
        instanceId: inst.id,
        projectId: project.id,
        instanceType: 'document',
        snapshotRef: 'snap-123.msgpack',
        snapshotHash: 'hash-123',
        snapshotPayload: { text: 'Snapshot version' }
      })

      engine.appendCommandLog(inst.id, {
        commandId: 'cmd-1',
        commandType: 'insert_text',
        payload: { char: 'A' }
      })

      expect(engine.getSnapshot('snap-123.msgpack')).not.toBeNull()
      expect(engine.getCommandLogs(inst.id)).toHaveLength(1)

      // Delete instance
      engine.deleteInstance(inst.id)

      expect(engine.getInstancesMeta(project.id)).toHaveLength(0)
      expect(engine.getInstanceContent(inst.id)).toBeNull()

      // Foreign key cascade: snapshots and logs must be deleted
      expect(engine.getSnapshot('snap-123.msgpack')).toBeNull()
      expect(engine.getCommandLogs(inst.id)).toHaveLength(0)
    })
  })

  describe('Snapshots and Command Logs', () => {
    it('creates and retrieves workspace snapshots', () => {
      const project = engine.createProject('Project')
      const inst = engine.createInstance('canvas', {
        projectId: project.id,
        name: 'Canvas 1'
      })

      const snapshotPayload = { nodes: [{ id: '1' }], edges: [] }
      const snapshot = engine.createSnapshot({
        instanceId: inst.id,
        projectId: project.id,
        instanceType: 'graph-canvas',
        snapshotRef: 'canvas-sha256.msgpack',
        snapshotHash: 'sha256-hash',
        snapshotCursor: { seq: 10, at: '2026-09-03T12:00:00.000Z' },
        snapshotPayload
      })

      expect(snapshot.snapshotRef).toBe('canvas-sha256.msgpack')
      expect(snapshot.instanceType).toBe('graph-canvas')
      expect(snapshot.snapshotCursor.seq).toBe(10)

      const retrievedBlob = engine.getSnapshot('canvas-sha256.msgpack')
      expect(retrievedBlob).not.toBeNull()
      expect(unpack(retrievedBlob as Buffer)).toEqual(snapshotPayload)

      expect(engine.getSnapshot('unknown.msgpack')).toBeNull()
    })

    it('appends and retrieves command logs with ordering and limit', () => {
      const project = engine.createProject('Project')
      const inst = engine.createInstance('document', {
        projectId: project.id,
        name: 'Document 1'
      })

      for (let i = 1; i <= 5; i++) {
        engine.appendCommandLog(inst.id, {
          commandId: `cmd-${i}`,
          commandType: 'edit',
          payload: { delta: i },
          timestamp: 1000 + i
        })
      }

      const allLogs = engine.getCommandLogs(inst.id)
      expect(allLogs).toHaveLength(5)
      expect(allLogs.map((l) => l.command)).toEqual([
        { delta: 1 },
        { delta: 2 },
        { delta: 3 },
        { delta: 4 },
        { delta: 5 }
      ])

      // Test limit
      const limitedLogs = engine.getCommandLogs(inst.id, 2)
      expect(limitedLogs).toHaveLength(2)
      expect(limitedLogs.map((l) => l.command)).toEqual([{ delta: 1 }, { delta: 2 }])
    })
  })
})
