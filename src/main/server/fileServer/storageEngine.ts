import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'events'
import { pack, unpack } from 'msgpackr'
import { v4 as uuidv4 } from 'uuid'
import type {
  CheckpointBundle,
  FileRevision,
  WorkspaceCommandLog,
  WorkspaceSnapshot
} from '@shared/checkpoints/types'
import {
  CheckpointBundleSchema,
  FileRevisionSchema,
  WorkspaceCommandLogSchema,
  WorkspaceSnapshotSchema
} from '@shared/checkpoints/validators'

export interface CagentInstance {
  id: string
  type: 'document' | 'canvas' | string
  name: string
  projectId?: string
  content: any
  metadata: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface CagentProject {
  id: string
  name: string
  metadata: Record<string, any>
  createdAt: number
  updatedAt?: number
}

export interface CagentFileStructure {
  header: {
    magic: 'CAGENT'
    version: number
  }
  projects: Record<string, CagentProject>
  instances: Record<string, CagentInstance>
  updatedAt: number
  // Chat sessions stored per-project file (local-first)
  chat?: {
    sessions: Record<string, ChatSession>
  }
  persistence?: {
    checkpoints: Record<string, CheckpointRecord[]>
    blobs: Record<string, CheckpointBlobRecord>
    writes: Record<string, CheckpointWriteRecord[]>
    restoreHeads: Record<string, string>
  }
  checkpointBundles?: CheckpointBundle[]
  fileRevisions?: FileRevision[]
  workspaceSnapshots?: WorkspaceSnapshot[]
  workspaceLogs?: WorkspaceCommandLog
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: any[]
  blocks?: any[]
  actions?: any[]
  timestamp: number // epoch ms
  usage?: any
  metadata?: Record<string, any>
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface CheckpointRecord {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  parent_checkpoint_id?: string
  checkpoint: any
  metadata: any
}

export interface CheckpointBlobRecord {
  thread_id: string
  checkpoint_ns: string
  channel: string
  version: string
  type: string // 'json' | 'bytes' | 'empty' | 'langchain_msg_...'
  blob: any // The actual data
  serialized?: boolean // Whether the blob is serialized with serde
}

export interface CheckpointWriteRecord {
  thread_id: string
  checkpoint_ns: string
  checkpoint_id: string
  task_id: string
  idx: number
  channel: string
  type: string
  blob: any
}

export interface ArchiveSyncState {
  sourceArchivePath: string | null
  isUpdated: boolean
  lastExportedAt: number | null
}

import { ArchiveManager } from './ArchiveManager'
import { FolderInstanceContentStore } from './FolderInstanceContentStore'

function parseStructuredMetadataFile(buffer: Buffer): any {
  const text = buffer.toString('utf8').trim()

  if (text.length > 0) {
    try {
      return JSON.parse(text)
    } catch {}
  }

  return unpack(buffer)
}

async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`
  const json = `${JSON.stringify(data, null, 2)}\n`

  await fs.promises.writeFile(tempPath, json, 'utf8')
  await fs.promises.rename(tempPath, filePath)
}

export class CagentStorage extends EventEmitter {
  private originalFilePath: string // The user's zip file
  private tempWorkingPath: string // The exploded directory
  private internalFilePath: string // The cagent.json inside temp dir
  private instanceStore: FolderInstanceContentStore

  public data: CagentFileStructure
  private debounceTimer: NodeJS.Timeout | null = null
  private maxWaitTimer: NodeJS.Timeout | null = null
  private changeCount: number = 0
  private savePromise: Promise<void> = Promise.resolve()
  private lastWriteTime: number = 0
  private watcher: fs.FSWatcher | null = null
  private archiveManager: ArchiveManager
  private archiveSyncState: ArchiveSyncState

  constructor(originalFilePath: string, tempWorkingPath: string) {
    super()
    this.originalFilePath = originalFilePath
    this.tempWorkingPath = tempWorkingPath
    this.internalFilePath = path.join(tempWorkingPath, 'cagent.json')
    this.archiveManager = new ArchiveManager()
    this.instanceStore = new FolderInstanceContentStore(path.join(tempWorkingPath, 'instances'))
    this.archiveSyncState = this.buildDefaultArchiveSyncState()

    this.data = this._getEmptyState()
  }

  private buildDefaultArchiveSyncState(): ArchiveSyncState {
    return {
      sourceArchivePath: this.originalFilePath.toLowerCase().endsWith('.cagent')
        ? this.originalFilePath
        : null,
      isUpdated: false,
      lastExportedAt: null
    }
  }

  private normalizeArchiveSyncState(raw: any): ArchiveSyncState {
    const defaults = this.buildDefaultArchiveSyncState()

    return {
      sourceArchivePath:
        typeof raw?.sourceArchivePath === 'string'
          ? raw.sourceArchivePath
          : defaults.sourceArchivePath,
      isUpdated: raw?.isUpdated === true,
      lastExportedAt:
        typeof raw?.lastExportedAt === 'number' ? raw.lastExportedAt : defaults.lastExportedAt
    }
  }

  private markArchiveDirty(): void {
    if (!this.archiveSyncState.sourceArchivePath || this.archiveSyncState.isUpdated) {
      return
    }

    this.archiveSyncState = {
      ...this.archiveSyncState,
      isUpdated: true
    }
    this.emit('archive-state-changed', this.getArchiveSyncState())
  }

  public getArchiveSyncState(): ArchiveSyncState {
    return { ...this.archiveSyncState }
  }

  public getCloseState(): ArchiveSyncState & {
    liveWorkspacePath: string
    isArchiveBacked: boolean
  } {
    return {
      ...this.getArchiveSyncState(),
      liveWorkspacePath: this.tempWorkingPath,
      isArchiveBacked: Boolean(this.archiveSyncState.sourceArchivePath)
    }
  }

  public async markArchiveExported(exportedPath: string): Promise<void> {
    const sourceArchivePath = this.archiveSyncState.sourceArchivePath
    if (!sourceArchivePath) {
      return
    }

    const normalizedSource = path.resolve(sourceArchivePath)
    const normalizedTarget = path.resolve(exportedPath)
    if (normalizedSource !== normalizedTarget) {
      return
    }

    this.archiveSyncState = {
      ...this.archiveSyncState,
      isUpdated: false,
      lastExportedAt: Date.now()
    }
    this.emit('archive-state-changed', this.getArchiveSyncState())
    await this.save()
  }

  public async flushPendingSaves(): Promise<void> {
    await this.save()
  }

  public renameFile(newName: string): { oldPath: string; newPath: string } {
    const oldPath = this.originalFilePath
    // sanitize name and ensure extension
    let base = path.basename(newName)
    if (!base.toLowerCase().endsWith('.cagent')) base = `${base}.cagent`
    const dir = path.dirname(this.originalFilePath)
    const newPath = path.join(dir, base)

    // perform rename of the ZIP file
    fs.renameSync(oldPath, newPath)

    // update internal path and emit event
    this.originalFilePath = newPath
    if (this.archiveSyncState.sourceArchivePath) {
      this.archiveSyncState = {
        ...this.archiveSyncState,
        sourceArchivePath: newPath
      }
    }
    this.emit('renamed', { oldPath, newPath })
    return { oldPath, newPath }
  }

  private _getEmptyState(): CagentFileStructure {
    return {
      header: {
        magic: 'CAGENT',
        version: 2
      },
      projects: {},

      instances: {}, // Key is UUID, Value is Instance object
      updatedAt: Date.now(),
      chat: {
        sessions: {}
      },
      persistence: {
        checkpoints: {},
        blobs: {},
        writes: {},
        restoreHeads: {}
      },
      checkpointBundles: [],
      fileRevisions: [],
      workspaceSnapshots: [],
      workspaceLogs: { byInstanceId: {} }
    }
  }

  private ensureDefaults(): void {
    if (!this.data.chat) this.data.chat = { sessions: {} }
    if (!this.data.persistence)
      this.data.persistence = { checkpoints: {}, blobs: {}, writes: {}, restoreHeads: {} }
    if (!this.data.persistence.restoreHeads) this.data.persistence.restoreHeads = {}
    if (!this.data.checkpointBundles) this.data.checkpointBundles = []
    if (!this.data.fileRevisions) this.data.fileRevisions = []
    if (!this.data.workspaceSnapshots) this.data.workspaceSnapshots = []
    if (!this.data.workspaceLogs) this.data.workspaceLogs = { byInstanceId: {} }
    this.normalizeCheckpointData()
  }

  public async load(isManualReload: boolean = false): Promise<void> {
    // If original zip doesn't exist, we rely on the in-memory default state (initialized in constructor)
    // but we should still save it to disk immediately to create the file.
    if (!fs.existsSync(this.originalFilePath)) {
      console.log('File does not exist, initializing new state.')
      this.data = this._getEmptyState()
      this.archiveSyncState = this.buildDefaultArchiveSyncState()
      this.save() // Save the initial state immediately
      return
    }

    try {
      // ArchiveManager (via process bootstrap) already extracted files to tempWorkingPath.
      // But if this is a RELOAD triggered by file watcher, we might need to re-extract?
      // Actually, if the ZIP changed, we DO need to re-extract.
      // AND we need to be careful not to overwrite our own pending writes (handled by debounce/locks hopefully).

      if (isManualReload) {
        // Re-mount the zip to temp if this is a reload
        await this.archiveManager.mount(this.originalFilePath)
        // Note: mount() returns a new temp path usually, but here we assume we want to refresh the CURRENT temp path?
        // Actually ArchiveManager.mount implementation generates a formatted ID.
        // For a reload, we should update our temp working path or re-use the existing one?
        // The current ArchiveManager implementation generates a NEW uuid each time.
        // This is safer for concurrency but means we need to update this.tempWorkingPath.
        // However, we can't easily update `this.tempWorkingPath` if other things depend on it (like sidecars).
        // Given the complexity, let's assume for now that RELOAD re-reads from the SAME temp path
        // BUT we need to unzip again.

        // So:
        const newTemp = await this.archiveManager.mount(this.originalFilePath)
        // Cleanup old temp? Ideally yes, but let's stick to updating pointers for now.
        this.tempWorkingPath = newTemp
        this.internalFilePath = path.join(newTemp, 'cagent.json')
      }

      const stats = fs.statSync(this.originalFilePath)
      this.lastWriteTime = stats.mtimeMs

      const manifestPath = path.join(this.tempWorkingPath, 'manifest.json')
      const statePath = path.join(this.tempWorkingPath, 'state.json')

      if (fs.existsSync(manifestPath)) {
        // V3 Load
        const manifestBuffer = fs.readFileSync(manifestPath)
        const manifest = parseStructuredMetadataFile(manifestBuffer) as any
        const stateBuffer = fs.existsSync(statePath) ? fs.readFileSync(statePath) : null
        const state = stateBuffer ? parseStructuredMetadataFile(stateBuffer) : {}
        this.archiveSyncState = this.normalizeArchiveSyncState(state.archiveSync)

        this.data = {
          header: manifest.header,
          projects: manifest.projects || {},
          instances: manifest.instances || {},
          updatedAt: manifest.updatedAt,
          chat: state.chat || { sessions: {} },
          persistence: state.persistence || {
            checkpoints: {},
            blobs: {},
            writes: {},
            restoreHeads: {}
          },
          checkpointBundles: state.checkpointBundles || [],
          fileRevisions: state.fileRevisions || [],
          workspaceSnapshots: state.workspaceSnapshots || [],
          workspaceLogs: state.workspaceLogs || { byInstanceId: {} }
        }

        this.ensureDefaults()

        for (const instance of Object.values(this.data.instances)) {
          const content = await this.instanceStore.readContent(instance.id)
          instance.content = content || {}
        }
      } else {
        console.warn('[CagentStorage] manifest.json not found in archive. initializing empty.')
        this.data = this._getEmptyState()
        this.archiveSyncState = this.buildDefaultArchiveSyncState()
      }

      console.log(
        `[CagentStorage] ${isManualReload ? 'Reloaded' : 'Loaded'} file with ${Object.keys(this.data.projects).length} projects and ${Object.keys(this.data.instances).length} instances.`
      )

      if (!isManualReload) {
        this.startWatcher()
      }
    } catch (err) {
      console.error('Failed to load .cagent file:', err)
      throw err
    }
  }

  // ... normalizeCheckpointData ...
  private normalizeCheckpointData(): void {
    if (this.data.checkpointBundles) {
      const parsed = CheckpointBundleSchema.array().safeParse(this.data.checkpointBundles)
      if (!parsed.success) {
        console.warn('[CagentStorage] Invalid checkpointBundles, resetting to empty list.')
        this.data.checkpointBundles = []
      }
    }

    if (this.data.fileRevisions) {
      const parsed = FileRevisionSchema.array().safeParse(this.data.fileRevisions)
      if (!parsed.success) {
        console.warn('[CagentStorage] Invalid fileRevisions, resetting to empty list.')
        this.data.fileRevisions = []
      }
    }

    if (this.data.workspaceSnapshots) {
      const parsed = WorkspaceSnapshotSchema.array().safeParse(this.data.workspaceSnapshots)
      if (!parsed.success) {
        console.warn('[CagentStorage] Invalid workspaceSnapshots, resetting to empty list.')
        this.data.workspaceSnapshots = []
      }
    }

    if (this.data.workspaceLogs) {
      const parsed = WorkspaceCommandLogSchema.safeParse(this.data.workspaceLogs)
      if (!parsed.success) {
        console.warn('[CagentStorage] Invalid workspaceLogs, resetting to empty map.')
        this.data.workspaceLogs = { byInstanceId: {} }
      }
    }
  }

  private cloneData(): CagentFileStructure {
    if (typeof structuredClone === 'function') {
      return structuredClone(this.data)
    }
    return JSON.parse(JSON.stringify(this.data)) as CagentFileStructure
  }

  private getSidecarDir(): string {
    // Return path.join(this.tempWorkingPath, 'data')
    return path.join(this.tempWorkingPath, 'data')
  }

  private getRevisionDir(): string {
    return path.join(this.getSidecarDir(), 'revisions')
  }

  private getWorkspaceDir(): string {
    return path.join(this.getSidecarDir(), 'workspace')
  }

  // ... ensure dirs ...
  private ensureRevisionDir(): string {
    const revisionDir = this.getRevisionDir()
    if (!fs.existsSync(revisionDir)) {
      fs.mkdirSync(revisionDir, { recursive: true })
    }
    return revisionDir
  }

  private ensureWorkspaceDir(): string {
    const workspaceDir = this.getWorkspaceDir()
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true })
    }
    return workspaceDir
  }

  // ... buildRevisionSnapshotData ...
  private buildRevisionSnapshotData(): CagentFileStructure {
    const snapshot = this.cloneData()
    snapshot.chat = { sessions: {} }
    snapshot.persistence = { checkpoints: {}, blobs: {}, writes: {}, restoreHeads: {} }
    snapshot.checkpointBundles = []
    snapshot.fileRevisions = []
    snapshot.workspaceSnapshots = []
    snapshot.workspaceLogs = { byInstanceId: {} }
    snapshot.instances = Object.fromEntries(
      Object.entries(snapshot.instances).map(([id, instance]) => [id, { ...instance, content: {} }])
    )
    return snapshot
  }

  // ... revision methods ...

  public getFileRevisions(): FileRevision[] {
    return [...(this.data.fileRevisions || [])]
  }

  public getFileRevision(id: string): FileRevision | undefined {
    return this.data.fileRevisions?.find((revision) => revision.id === id)
  }

  public async createFileRevision(reason: FileRevision['reason']): Promise<FileRevision> {
    const id = uuidv4()
    const createdAt = new Date().toISOString()
    const snapshotRef = `${id}.msgpack`
    const revision: FileRevision = { id, createdAt, reason, snapshotRef }

    if (!this.data.fileRevisions) this.data.fileRevisions = []
    this.data.fileRevisions.push(revision)

    const snapshotData = this.buildRevisionSnapshotData()
    const revisionDir = this.ensureRevisionDir()
    const snapshotPath = path.join(revisionDir, snapshotRef)
    const buffer = pack(snapshotData)
    await fs.promises.writeFile(snapshotPath, buffer)

    this.triggerSave()
    return revision
  }

  public async restoreFileRevision(id: string): Promise<FileRevision | null> {
    const revision = this.getFileRevision(id)
    if (!revision || !revision.snapshotRef) return null

    const revisionDir = this.ensureRevisionDir()
    const snapshotPath = path.join(revisionDir, revision.snapshotRef)
    const buffer = await fs.promises.readFile(snapshotPath)
    const decoded = unpack(buffer) as CagentFileStructure
    const preserved = {
      chat: this.data.chat,
      persistence: this.data.persistence,
      checkpointBundles: this.data.checkpointBundles,
      fileRevisions: this.data.fileRevisions,
      workspaceSnapshots: this.data.workspaceSnapshots,
      workspaceLogs: this.data.workspaceLogs
    }

    this.data = {
      ...decoded,
      ...preserved
    }
    this.ensureDefaults()
    await this.save()
    return revision
  }

  public getWorkspaceSnapshot(id: string): WorkspaceSnapshot | undefined {
    return this.data.workspaceSnapshots?.find((snapshot) => snapshot.id === id)
  }

  public async createWorkspaceSnapshot(payload: {
    instanceId: string
    instanceType: WorkspaceSnapshot['instanceType']
    projectId: string
    snapshot: unknown
    snapshotCursor: WorkspaceSnapshot['snapshotCursor']
  }): Promise<WorkspaceSnapshot> {
    const id = uuidv4()
    const createdAt = new Date().toISOString()
    const buffer = pack(payload.snapshot)
    const snapshotHash = createHash('sha256').update(buffer).digest('hex')
    const snapshotRef = `${snapshotHash}.msgpack`
    const snapshotRecord: WorkspaceSnapshot = {
      id,
      createdAt,
      instanceId: payload.instanceId,
      instanceType: payload.instanceType,
      projectId: payload.projectId,
      snapshotRef,
      snapshotHash,
      snapshotCursor: payload.snapshotCursor
    }

    if (!this.data.workspaceSnapshots) this.data.workspaceSnapshots = []
    this.data.workspaceSnapshots.push(snapshotRecord)

    const workspaceDir = this.ensureWorkspaceDir()
    const snapshotPath = path.join(workspaceDir, snapshotRef)
    if (!fs.existsSync(snapshotPath)) {
      await fs.promises.writeFile(snapshotPath, buffer)
    }

    this.triggerSave()
    return snapshotRecord
  }

  public async loadWorkspaceSnapshot(snapshotId: string): Promise<unknown | null> {
    const snapshot = this.getWorkspaceSnapshot(snapshotId)
    if (!snapshot) return null

    const workspaceDir = this.ensureWorkspaceDir()
    const snapshotPath = path.join(workspaceDir, snapshot.snapshotRef)
    const buffer = await fs.promises.readFile(snapshotPath)
    return unpack(buffer)
  }

  public appendWorkspaceLogEntry(entry: WorkspaceCommandLog['byInstanceId'][string][number]): void {
    if (!this.data.workspaceLogs) this.data.workspaceLogs = { byInstanceId: {} }
    const existing = this.data.workspaceLogs.byInstanceId[entry.instanceId] || []
    existing.push(entry)
    this.data.workspaceLogs.byInstanceId[entry.instanceId] = existing
    this.triggerSave()
  }

  public getWorkspaceLogEntries(instanceId: string): WorkspaceCommandLog['byInstanceId'][string] {
    if (!this.data.workspaceLogs) return []
    return this.data.workspaceLogs.byInstanceId[instanceId] || []
  }

  // checkpoint getters...
  public createCheckpointBundle(bundle: CheckpointBundle): CheckpointBundle {
    if (!this.data.checkpointBundles) this.data.checkpointBundles = []
    this.data.checkpointBundles.push(bundle)
    this.triggerSave()
    return bundle
  }

  public getCheckpointBundle(id: string): CheckpointBundle | undefined {
    return this.data.checkpointBundles?.find((bundle) => bundle.id === id)
  }

  public listCheckpointBundles(filters?: {
    sessionId?: string
    threadId?: string
  }): CheckpointBundle[] {
    let bundles = [...(this.data.checkpointBundles || [])]
    if (filters?.threadId) {
      bundles = bundles.filter((bundle) => bundle.threadId === filters.threadId)
    } else if (filters?.sessionId) {
      bundles = bundles.filter((bundle) => bundle.sessionId === filters.sessionId)
    }
    return bundles
  }

  private startWatcher(): void {
    if (this.watcher) return

    this.watcher = fs.watch(this.originalFilePath, async (event) => {
      if (event === 'change') {
        try {
          const stats = fs.statSync(this.originalFilePath)
          // If the modification time is more than 100ms after our last save,
          // it's likely an external change.
          if (stats.mtimeMs > this.lastWriteTime + 100) {
            console.log(`[CagentStorage] External change detected on ${this.originalFilePath}.`)
            // We must reload the data before notifying listeners
            await this.load(true)
            this.emit('reload')
          }
        } catch (err) {
          // File might be briefly locked or missing
        }
      }
    })

    this.watcher.on('error', (err) => {
      console.error('[CagentStorage] Watcher error:', err)
    })
  }

  public stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  // Persist to disk with adaptive debounce
  public triggerSave(): void {
    this.markArchiveDirty()
    this.changeCount++

    let delay = 500
    if (this.changeCount > 10) delay = 2000
    else if (this.changeCount > 5) delay = 1000

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
      this.save()
    }, delay)

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(
        () => {
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = null
          this.maxWaitTimer = null
          this.save()
        },
        Math.max(delay * 2, 4000)
      )
    }
  }

  public async flush(): Promise<void> {
    return this.save()
  }

  public async save(): Promise<void> {
    // Clear any pending debounce timers since we are doing it now
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
    }

    this.changeCount = 0 // reset adaptive counter
    // Chain saves to prevent overlapping writes
    this.savePromise = this.savePromise.then(async () => {
      try {
        this.emit('saving')
        this.data.updatedAt = Date.now()

        const state = {
          chat: this.data.chat,
          persistence: this.data.persistence,
          checkpointBundles: this.data.checkpointBundles,
          fileRevisions: this.data.fileRevisions,
          workspaceSnapshots: this.data.workspaceSnapshots,
          workspaceLogs: this.data.workspaceLogs,
          archiveSync: this.archiveSyncState
        }

        const instancesMeta: Record<string, any> = {}
        for (const [id, inst] of Object.entries(this.data.instances)) {
          const { content, ...meta } = inst
          instancesMeta[id] = meta

          if (content) {
            await this.instanceStore.writeContent(id, content)
          }
        }

        const manifest = {
          header: { magic: 'CAGENT', version: 3 },
          projects: this.data.projects,
          instances: instancesMeta,
          updatedAt: this.data.updatedAt
        }

        const manifestPath = path.join(this.tempWorkingPath, 'manifest.json')
        const statePath = path.join(this.tempWorkingPath, 'state.json')

        await writeJsonFileAtomic(manifestPath, manifest)
        await writeJsonFileAtomic(statePath, state)

        // Delete legacy cagent.json to ensure we don't load stale data on reload
        if (fs.existsSync(this.internalFilePath)) {
          await fs.promises.rm(this.internalFilePath, { force: true })
        }

        const stats = await fs.promises
          .stat(this.originalFilePath)
          .catch(() => ({ mtimeMs: Date.now() }))
        this.lastWriteTime = stats.mtimeMs

        console.log('Saved to disk (sharded).')
        this.emit('saved')
      } catch (err) {
        console.error('Failed to save to disk:', err)
        this.emit('saved') // ensure we clear the state even on error
      }
    })
    return this.savePromise
  }

  // --- CRUD Operations ---

  public getAllInstances(): CagentInstance[] {
    return Object.values(this.data.instances)
  }

  public getInstance(id: string): CagentInstance | undefined {
    return this.data.instances[id]
  }

  public createInstance(type: string, data: Partial<CagentInstance>): CagentInstance {
    // Basic unique name check similar to DB
    const nameExists = Object.values(this.data.instances).some(
      (inst) => inst.projectId === data.projectId && inst.name === data.name
    )

    if (nameExists) {
      const error = new Error('An instance with this name already exists in this project') as any
      error.code = '23505' // Postgres code for unique violation
      throw error
    }

    // Check if ID is provided (some migration scenarios?) usually null
    const id = data.id || uuidv4()

    // We need to match the DB schema roughly.
    // DB has: id, type, name, projectId, content, metadata, createdAt, updatedAt
    const instance: CagentInstance = {
      id,
      type,
      name: data.name || 'Untitled',
      projectId: data.projectId,
      content: data.content || {},
      metadata: data.metadata || {},
      createdAt: new Date().toISOString(), // DB likely uses ISO string or timestamp
      updatedAt: new Date().toISOString()
    }

    if (instance.type === 'document' && !instance.content.blocks) {
      // Default content for document
      instance.content = { blocks: [{ id: uuidv4(), type: 'paragraph', content: '' }] }
    }
    if (instance.type === 'canvas' && !instance.content.graph) {
      instance.content = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: { nodes: {}, relationships: {} },
        layout: { layoutByNodeId: {} }
      }
    }

    this.data.instances[id] = instance
    this.triggerSave()
    return instance
  }

  public updateInstance(id: string, partialData: Partial<CagentInstance>): CagentInstance | null {
    const instance = this.data.instances[id]
    if (!instance) {
      // Return null or throw? API expects existing object or 404
      return null
    }

    // Check unique name if name is changing
    if (partialData.name && partialData.name !== instance.name) {
      const nameExists = Object.values(this.data.instances).some(
        (inst) =>
          inst.projectId === (partialData.projectId || instance.projectId) &&
          inst.name === partialData.name &&
          inst.id !== id
      )
      if (nameExists) {
        const error = new Error('An instance with this name already exists in this project') as any
        error.code = '23505'
        throw error
      }
    }

    // Apply updates
    if (partialData.name !== undefined) instance.name = partialData.name
    if (partialData.content !== undefined) instance.content = partialData.content
    if (partialData.metadata !== undefined)
      instance.metadata = { ...instance.metadata, ...partialData.metadata }
    if (partialData.projectId !== undefined) instance.projectId = partialData.projectId

    instance.updatedAt = new Date().toISOString()

    this.data.instances[id] = instance
    this.triggerSave()
    return instance
  }

  public deleteInstance(id: string): { deleted: boolean } {
    if (this.data.instances[id]) {
      delete this.data.instances[id]
      this.instanceStore
        .deleteContent(id)
        .catch((err) => console.error('Failed to delete instance content files', err))
      this.triggerSave()
      return { deleted: true }
    }
    return { deleted: false }
  }

  public getProject(id: string | null): CagentProject | null {
    if (!id) return null // Must provide ID now
    return this.data.projects[id] || null
  }

  public getAllProjects(): CagentProject[] {
    return Object.values(this.data.projects)
  }

  public createProject(name: string): CagentProject {
    const id = uuidv4()
    const project: CagentProject = {
      id,
      name: name || 'Untitled Project',
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.data.projects[id] = project
    this.triggerSave()
    return project
  }

  public updateProject(id: string, payload: Partial<CagentProject>): CagentProject | null {
    const project = this.data.projects[id]
    if (!project) return null

    this.data.projects[id] = {
      ...project,
      ...payload,
      updatedAt: Date.now()
    }
    this.triggerSave()
    return this.data.projects[id]
  }

  public deleteProject(id: string): { deleted: true } | null {
    if (!this.data.projects[id]) return null

    // Delete the project
    delete this.data.projects[id]

    // Cascade delete: remove all instances belonging to this project
    for (const instanceId in this.data.instances) {
      if (this.data.instances[instanceId].projectId === id) {
        delete this.data.instances[instanceId]
      }
    }

    this.triggerSave()
    return { deleted: true }
  }

  // --- Chat API (filesystem-backed) ---
  public getChatSessions(): Array<{
    id: string
    title: string
    updatedAt: number
    messageCount: number
  }> {
    const sessions = Object.values(this.data.chat?.sessions || {})
    return sessions
      .map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public getChatMessages(sessionId: string): ChatMessage[] {
    const session = this.data.chat?.sessions[sessionId]
    if (!session) return []
    return session.messages || []
  }

  public saveChatMessage(sessionId: string, message: ChatMessage): ChatSession {
    if (!this.data.chat) this.data.chat = { sessions: {} }
    let session = this.data.chat.sessions[sessionId]
    const now = Date.now()
    if (!session) {
      session = {
        id: sessionId,
        title: `Chat ${sessionId.substring(0, 8)}`,
        createdAt: now,
        updatedAt: now,
        messages: []
      }
      this.data.chat.sessions[sessionId] = session
    }

    // Ensure message timestamp and id
    const msg: ChatMessage = {
      id: message.id || uuidv4(),
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls || [],
      blocks: message.blocks || [],
      actions: message.actions || [],
      timestamp: message.timestamp || now,
      usage: message.usage,
      metadata: message.metadata || {}
    }

    session.messages.push(msg)
    session.updatedAt = Date.now()
    this.triggerSave()
    return session
  }

  public truncateChatSession(sessionId: string, messageId: string, blockIndex?: number): boolean {
    const session = this.data.chat?.sessions[sessionId]
    if (!session) return false

    const idx = session.messages.findIndex((msg) => msg.id === messageId)
    if (idx === -1) return false

    const target = { ...session.messages[idx] }
    if (typeof blockIndex === 'number' && blockIndex >= 0) {
      const blocks = Array.isArray(target.blocks) ? target.blocks : []
      const nextBlocks = blocks.slice(0, blockIndex + 1)
      if (nextBlocks.length > 0) {
        const textContent = nextBlocks
          .filter((block) => block && block.type === 'text')
          .map((block: any) => block.content || '')
          .join('')
        target.content = textContent
        target.blocks = nextBlocks
      }
    }

    session.messages = [...session.messages.slice(0, idx), target]
    session.updatedAt = Date.now()
    this.triggerSave()
    return true
  }

  public clearChatSession(sessionId: string): void {
    if (!this.data.chat) this.data.chat = { sessions: {} }

    let session = this.data.chat.sessions[sessionId]
    const now = Date.now()
    if (!session) {
      session = {
        id: sessionId,
        title: `Chat ${sessionId.substring(0, 8)}`,
        createdAt: now,
        updatedAt: now,
        messages: []
      }
      this.data.chat.sessions[sessionId] = session
    } else {
      session.messages = []
      session.updatedAt = now
    }

    this.triggerSave()
  }

  public deleteChatSession(sessionId: string): boolean {
    if (!this.data.chat || !this.data.chat.sessions[sessionId]) return false
    delete this.data.chat.sessions[sessionId]
    this.triggerSave()
    return true
  }
}
