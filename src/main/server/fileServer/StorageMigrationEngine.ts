/**
 * StorageMigrationEngine: Automated Non-Destructive ETL Migration Pipeline
 * Conforms to docs/sqlite-storage-architecture/spec.md (HR-FR-04, HR-INV-05),
 * migration-plan.md, and .agents/rules/coding-rules.md (Zero any, no hardcoded constants, cause preservation).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pack, unpack } from 'msgpackr'
import yauzl from 'yauzl'
import {
  SQLITE_ENGINE_CONFIG,
  STORAGE_MIGRATION_CONFIG,
  SQLITE_MAGIC_HEADER,
  ZIP_MAGIC_HEADER,
  type SqliteEngineConfig,
  type StorageMigrationConfig
} from './config/sqliteConfig'
import { SqliteDatabase } from './db/SqliteDatabase'
import { StorageError, StorageErrorCode } from './errors/StorageErrors'
import { ImportCagentArchive } from './ImportCagentArchive'

export type StorageFormatVersion = 'v4_sqlite' | 'legacy_zip' | 'unknown'

export type MigrationStage =
  | 'sniffing'
  | 'backup'
  | 'extracting'
  | 'ingesting'
  | 'verifying'
  | 'cutover'
  | 'completed'
  | 'failed'

export interface MigrationProgress {
  readonly stage: MigrationStage
  readonly percent: number
  readonly message?: string
}

export type MigrationProgressCallback = (progress: MigrationProgress) => void

export interface MigrationReport {
  readonly success: boolean
  readonly fromVersion: number
  readonly toVersion: number
  readonly artifactsMigrated: number
  readonly durationMs: number
  readonly backupPath: string
  readonly warnings?: readonly string[]
  readonly errors?: readonly string[]
}

export interface IngestStats {
  readonly artifactsMigrated: number
  readonly instanceCount: number
  readonly checkpointCount: number
}

interface CountRow {
  readonly count: number
}

interface BlobSampleRow {
  readonly id: string
  readonly content_msgpack: Buffer | Uint8Array | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCountRow(val: unknown): val is CountRow {
  if (val === null || typeof val !== 'object') return false
  return typeof (val as Record<string, unknown>).count === 'number'
}

function isBlobSampleRow(val: unknown): val is BlobSampleRow {
  if (val === null || typeof val !== 'object') return false
  const r = val as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    (r.content_msgpack === null ||
      Buffer.isBuffer(r.content_msgpack) ||
      r.content_msgpack instanceof Uint8Array)
  )
}

/**
 * Inspects initial magic bytes synchronously to identify the project container format.
 * - Matches "SQLite format 3\0" -> 'v4_sqlite'
 * - Matches "PK\x03\x04" -> 'legacy_zip'
 * - Otherwise -> 'unknown'
 */
export function detectStorageFormat(filePath: string): StorageFormatVersion {
  if (!fs.existsSync(filePath)) {
    return 'unknown'
  }

  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(STORAGE_MIGRATION_CONFIG.headerMagicBytesLength)
    const bytesRead = fs.readSync(fd, buffer, 0, STORAGE_MIGRATION_CONFIG.headerMagicBytesLength, 0)

    if (bytesRead < 4) {
      return 'unknown'
    }

    if (
      bytesRead >= STORAGE_MIGRATION_CONFIG.headerMagicBytesLength &&
      buffer.equals(SQLITE_MAGIC_HEADER)
    ) {
      return 'v4_sqlite'
    }

    if (
      buffer[0] === ZIP_MAGIC_HEADER[0] &&
      buffer[1] === ZIP_MAGIC_HEADER[1] &&
      buffer[2] === ZIP_MAGIC_HEADER[2] &&
      buffer[3] === ZIP_MAGIC_HEADER[3]
    ) {
      return 'legacy_zip'
    }

    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        // Suppress close errors
      }
    }
  }
}

/**
 * Generates an immutable safety backup (.v3.bak or .v3.<epoch>.bak) before any transformation.
 * Uses fs.constants.COPYFILE_EXCL to prevent race conditions or silent overwrites.
 */
export async function createSafetyBackup(sourcePath: string): Promise<string> {
  if (!fs.existsSync(sourcePath)) {
    throw new StorageError(
      StorageErrorCode.STORAGE_MIGRATION_FAILED,
      `Source project archive does not exist at '${sourcePath}'`,
      { sourcePath }
    )
  }

  let backupPath = `${sourcePath}.v3.bak`
  if (fs.existsSync(backupPath)) {
    backupPath = `${sourcePath}.v3.${Date.now()}.bak`
    while (fs.existsSync(backupPath)) {
      backupPath = `${sourcePath}.v3.${Date.now()}_${Math.random().toString(36).slice(2, 8)}.bak`
    }
  }

  try {
    await fs.promises.copyFile(sourcePath, backupPath, fs.constants.COPYFILE_EXCL)
    return backupPath
  } catch (err: unknown) {
    throw new StorageError(
      StorageErrorCode.STORAGE_MIGRATION_FAILED,
      `Failed to create safety backup at '${backupPath}'`,
      { sourcePath, backupPath },
      err instanceof Error ? err : undefined
    )
  }
}

/**
 * Extracts a ZIP archive safely into a destination directory using yauzl.
 * Prevents Zip Slip vulnerabilities by sanitizing directory paths.
 */
export async function extractZipArchive(zipPath: string, destDir: string): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true })

  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr) {
        return reject(
          new StorageError(
            StorageErrorCode.STORAGE_MIGRATION_FAILED,
            `Failed to open zip archive at ${zipPath}: ${openErr.message}`,
            { zipPath },
            openErr
          )
        )
      }
      if (!zipfile) {
        return reject(
          new StorageError(
            StorageErrorCode.STORAGE_MIGRATION_FAILED,
            `Failed to read zip archive at ${zipPath}`,
            { zipPath }
          )
        )
      }

      zipfile.readEntry()

      zipfile.on('entry', (entry) => {
        const rawFileName = entry.fileName
        const sanitized = path.normalize(rawFileName).replace(/^(\.\.[\/\\])+/, '')
        const destPath = path.join(destDir, sanitized)

        if (/\/$/.test(rawFileName)) {
          fs.mkdirSync(destPath, { recursive: true })
          zipfile.readEntry()
        } else {
          fs.mkdirSync(path.dirname(destPath), { recursive: true })
          zipfile.openReadStream(entry, async (streamErr, readStream) => {
            if (streamErr) {
              zipfile.close()
              return reject(
                new StorageError(
                  StorageErrorCode.STORAGE_MIGRATION_FAILED,
                  `Failed to open read stream for entry ${rawFileName}: ${streamErr.message}`,
                  { zipPath, rawFileName },
                  streamErr
                )
              )
            }
            if (!readStream) {
              zipfile.close()
              return reject(
                new StorageError(
                  StorageErrorCode.STORAGE_MIGRATION_FAILED,
                  `Null read stream for entry ${rawFileName}`,
                  { zipPath, rawFileName }
                )
              )
            }

            const writeStream = fs.createWriteStream(destPath)
            try {
              await pipeline(readStream, writeStream)
              zipfile.readEntry()
            } catch (pipeErr) {
              zipfile.close()
              reject(
                new StorageError(
                  StorageErrorCode.STORAGE_MIGRATION_FAILED,
                  `Pipeline stream error for entry ${rawFileName}: ${pipeErr instanceof Error ? pipeErr.message : String(pipeErr)}`,
                  { zipPath, rawFileName },
                  pipeErr instanceof Error ? pipeErr : undefined
                )
              )
            }
          })
        }
      })

      zipfile.on('end', () => resolve())
      zipfile.on('error', (zipErr) =>
        reject(
          new StorageError(
            StorageErrorCode.STORAGE_MIGRATION_FAILED,
            `Zip archive error: ${zipErr.message}`,
            { zipPath },
            zipErr
          )
        )
      )
    })
  })
}

/**
 * Checks for a live dirty adjacent .collar directory to preserve unsaved edits.
 */
export function findDirtyAdjacentDirectory(sourcePath: string): string | null {
  const baseName = path.basename(sourcePath, '.cagent')
  const dirName = path.dirname(sourcePath)
  const candidates = [
    path.join(dirName, `${baseName}.collar`),
    path.join(dirName, '.collar'),
    `${sourcePath}.collar`
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const hasWorkspaceFiles =
        fs.existsSync(path.join(candidate, 'manifest.json')) ||
        fs.existsSync(path.join(candidate, 'cagent.json')) ||
        fs.existsSync(path.join(candidate, 'state.json'))
      if (hasWorkspaceFiles) {
        return candidate
      }
    }
  }

  return null
}

export interface StorageMigrationOptions {
  readonly onProgress?: MigrationProgressCallback
  readonly config?: SqliteEngineConfig
  readonly migrationConfig?: StorageMigrationConfig
}

export class StorageMigrationEngine {
  private readonly onProgress?: MigrationProgressCallback
  protected readonly config: SqliteEngineConfig
  protected readonly migrationConfig: StorageMigrationConfig

  constructor(options?: StorageMigrationOptions) {
    this.onProgress = options?.onProgress
    this.config = options?.config ?? SQLITE_ENGINE_CONFIG
    this.migrationConfig = options?.migrationConfig ?? STORAGE_MIGRATION_CONFIG
  }

  public detectFormat(filePath: string): StorageFormatVersion {
    this.reportProgress('sniffing', 0, `Inspecting file header of ${path.basename(filePath)}`)
    const format = detectStorageFormat(filePath)
    this.reportProgress('sniffing', 10, `Detected storage format: ${format}`)
    return format
  }

  public async backup(sourcePath: string): Promise<string> {
    this.reportProgress('backup', 10, `Creating safety backup for ${path.basename(sourcePath)}`)
    const backupPath = await createSafetyBackup(sourcePath)
    this.reportProgress('backup', 20, `Safety backup created at ${path.basename(backupPath)}`)
    return backupPath
  }

  public async extractSource(
    sourcePath: string,
    tempExtractionDir: string
  ): Promise<{ isDirtyAdjacent: boolean; dirtyDir: string | null }> {
    this.reportProgress('extracting', 20, 'Checking for active dirty workspace directory')
    const dirtyDir = findDirtyAdjacentDirectory(sourcePath)

    if (dirtyDir) {
      this.reportProgress(
        'extracting',
        25,
        `Copying live edits from dirty directory: ${path.basename(dirtyDir)}`
      )
      await fs.promises.cp(dirtyDir, tempExtractionDir, { recursive: true })
      return { isDirtyAdjacent: true, dirtyDir }
    }

    this.reportProgress('extracting', 25, `Extracting ZIP archive ${path.basename(sourcePath)}`)
    await extractZipArchive(sourcePath, tempExtractionDir)
    return { isDirtyAdjacent: false, dirtyDir: null }
  }

  public async normalizeLegacyV2IfPresent(tempDir: string): Promise<boolean> {
    const cagentJsonPath = path.join(tempDir, 'cagent.json')
    const manifestPath = path.join(tempDir, 'manifest.json')

    if (!fs.existsSync(manifestPath) && fs.existsSync(cagentJsonPath)) {
      this.reportProgress(
        'extracting',
        35,
        'Legacy V2 monolithic cagent.json detected. Normalizing...'
      )
      const migrator = new ImportCagentArchive()
      const report = await migrator.migrate(tempDir)
      if (!report.success) {
        throw new StorageError(
          StorageErrorCode.STORAGE_MIGRATION_FAILED,
          `Legacy V2 archive normalization failed: ${report.errors.join(', ')}`,
          { errors: report.errors }
        )
      }
      return true
    }
    return false
  }

  public ingestStaging(stagingDb: SqliteDatabase, sourceDir: string): IngestStats {
    this.reportProgress(
      'ingesting',
      40,
      'Beginning atomic transaction for staging database ingestion'
    )

    let artifactsMigrated = 0
    let expectedInstanceCount = 0
    let expectedCheckpointCount = 0

    // Load manifest.json
    let manifestProjects: Record<string, unknown> = {}
    let manifestInstances: Record<string, unknown> = {}
    const manifestPath = path.join(sourceDir, 'manifest.json')

    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (isRecord(parsed)) {
          if (isRecord(parsed.projects)) manifestProjects = parsed.projects
          if (isRecord(parsed.instances)) manifestInstances = parsed.instances
        }
      } catch (err: unknown) {
        throw new StorageError(
          StorageErrorCode.STORAGE_MIGRATION_FAILED,
          'Failed to parse manifest.json during migration',
          { manifestPath },
          err instanceof Error ? err : undefined
        )
      }
    }

    // Load state.json
    let stateChatSessions: Record<string, unknown> = {}
    let stateSnapshots: unknown[] = []
    let stateLogs: Record<string, unknown[]> = {}
    let stateRevisions: unknown[] = []
    let statePersistence: Record<string, unknown> = {}

    const statePath = path.join(sourceDir, 'state.json')
    if (fs.existsSync(statePath)) {
      try {
        const raw = fs.readFileSync(statePath, 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (isRecord(parsed)) {
          if (isRecord(parsed.chat) && isRecord(parsed.chat.sessions)) {
            stateChatSessions = parsed.chat.sessions as Record<string, unknown>
          }
          if (Array.isArray(parsed.workspaceSnapshots)) {
            stateSnapshots = parsed.workspaceSnapshots
          }
          if (isRecord(parsed.workspaceLogs) && isRecord(parsed.workspaceLogs.byInstanceId)) {
            stateLogs = parsed.workspaceLogs.byInstanceId as Record<string, unknown[]>
          }
          if (Array.isArray(parsed.fileRevisions)) {
            stateRevisions = parsed.fileRevisions
          }
          if (isRecord(parsed.persistence)) {
            statePersistence = parsed.persistence as Record<string, unknown>
          }
        }
      } catch (err: unknown) {
        throw new StorageError(
          StorageErrorCode.STORAGE_MIGRATION_FAILED,
          'Failed to parse state.json during migration',
          { statePath },
          err instanceof Error ? err : undefined
        )
      }
    }

    stagingDb.immediateTransaction(() => {
      // 1. Projects
      const stmtInsertProject = stagingDb.prepare(`
        INSERT OR REPLACE INTO projects (id, name, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      let defaultProjectId = ''
      const projectKeys = Object.keys(manifestProjects)

      if (projectKeys.length > 0) {
        defaultProjectId = projectKeys[0]
        for (const [projId, projVal] of Object.entries(manifestProjects)) {
          const projObj = isRecord(projVal) ? projVal : {}
          const name = typeof projObj.name === 'string' ? projObj.name : 'Untitled Project'
          const meta = isRecord(projObj.metadata) ? projObj.metadata : {}
          const createdAt = typeof projObj.createdAt === 'number' ? projObj.createdAt : Date.now()
          const updatedAt = typeof projObj.updatedAt === 'number' ? projObj.updatedAt : Date.now()

          stmtInsertProject.run(projId, name, JSON.stringify(meta), createdAt, updatedAt)
          artifactsMigrated++
        }
      } else {
        defaultProjectId = crypto.randomUUID()
        const now = Date.now()
        stmtInsertProject.run(defaultProjectId, 'Default Project', '{}', now, now)
        artifactsMigrated++
      }

      // 2. Instances
      const stmtInsertInstance = stagingDb.prepare(`
        INSERT OR REPLACE INTO instances (id, project_id, type, name, content_msgpack, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const knownInstanceIds = new Set<string>()

      for (const [instId, instVal] of Object.entries(manifestInstances)) {
        const instObj = isRecord(instVal) ? instVal : {}
        const projectId =
          typeof instObj.projectId === 'string' && manifestProjects[instObj.projectId]
            ? instObj.projectId
            : defaultProjectId

        const rawType = typeof instObj.type === 'string' ? instObj.type : 'document'
        const type = rawType === 'canvas' || rawType === 'graph-canvas' ? 'canvas' : 'document'
        const name = typeof instObj.name === 'string' ? instObj.name : 'Untitled'
        const meta = isRecord(instObj.metadata) ? instObj.metadata : {}
        const nowIso = new Date().toISOString()
        const createdAt = typeof instObj.createdAt === 'string' ? instObj.createdAt : nowIso
        const updatedAt = typeof instObj.updatedAt === 'string' ? instObj.updatedAt : nowIso

        // Resolve binary payload: instances/<id>/content.msgpack, instances/<id>.msgpack, or instObj.content
        let contentBuffer: Buffer | null = null
        const nestedContentPath = path.join(sourceDir, 'instances', instId, 'content.msgpack')
        const flatContentPath = path.join(sourceDir, 'instances', `${instId}.msgpack`)
        const jsonContentPath = path.join(sourceDir, 'instances', `${instId}.json`)

        if (fs.existsSync(nestedContentPath)) {
          contentBuffer = fs.readFileSync(nestedContentPath)
        } else if (fs.existsSync(flatContentPath)) {
          contentBuffer = fs.readFileSync(flatContentPath)
        } else if (fs.existsSync(jsonContentPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(jsonContentPath, 'utf8')) as unknown
            const packed = pack(parsed)
            contentBuffer = Buffer.isBuffer(packed) ? packed : Buffer.from(packed)
          } catch {
            contentBuffer = null
          }
        } else if (instObj.content !== undefined && instObj.content !== null) {
          const packed = pack(instObj.content)
          contentBuffer = Buffer.isBuffer(packed) ? packed : Buffer.from(packed)
        }

        stmtInsertInstance.run(
          instId,
          projectId,
          type,
          name,
          contentBuffer,
          JSON.stringify(meta),
          createdAt,
          updatedAt
        )

        knownInstanceIds.add(instId)
        expectedInstanceCount++
        artifactsMigrated++
      }

      // 3. Chat Sessions & Messages
      const stmtInsertChatSession = stagingDb.prepare(`
        INSERT OR REPLACE INTO chat_sessions (id, project_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const stmtInsertChatMessage = stagingDb.prepare(`
        INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, tool_calls_json, blocks_json, actions_json, usage_json, metadata_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const [sessId, sessVal] of Object.entries(stateChatSessions)) {
        const sessObj = isRecord(sessVal) ? sessVal : {}
        const projectId =
          typeof sessObj.projectId === 'string' && manifestProjects[sessObj.projectId]
            ? sessObj.projectId
            : defaultProjectId

        const title =
          typeof sessObj.title === 'string' ? sessObj.title : `Chat ${sessId.slice(0, 8)}`
        const now = Date.now()
        const createdAt = typeof sessObj.createdAt === 'number' ? sessObj.createdAt : now
        const updatedAt = typeof sessObj.updatedAt === 'number' ? sessObj.updatedAt : now

        stmtInsertChatSession.run(sessId, projectId, title, createdAt, updatedAt)
        artifactsMigrated++

        const messages = Array.isArray(sessObj.messages) ? sessObj.messages : []
        for (const msgVal of messages) {
          const msgObj = isRecord(msgVal) ? msgVal : {}
          const msgId = typeof msgObj.id === 'string' ? msgObj.id : crypto.randomUUID()
          const rawRole = typeof msgObj.role === 'string' ? msgObj.role : 'user'
          const role = rawRole === 'assistant' || rawRole === 'system' ? rawRole : 'user'
          const content =
            typeof msgObj.content === 'string'
              ? msgObj.content
              : JSON.stringify(msgObj.content ?? '')

          const toolCalls = Array.isArray(msgObj.toolCalls) ? msgObj.toolCalls : []
          const blocks = Array.isArray(msgObj.blocks) ? msgObj.blocks : []
          const actions = Array.isArray(msgObj.actions) ? msgObj.actions : []
          const usage = isRecord(msgObj.usage) ? JSON.stringify(msgObj.usage) : null
          const meta = isRecord(msgObj.metadata) ? msgObj.metadata : {}
          const timestamp = typeof msgObj.timestamp === 'number' ? msgObj.timestamp : now

          stmtInsertChatMessage.run(
            msgId,
            sessId,
            role,
            content,
            JSON.stringify(toolCalls),
            JSON.stringify(blocks),
            JSON.stringify(actions),
            usage,
            JSON.stringify(meta),
            timestamp
          )
          artifactsMigrated++
        }
      }

      // 4. LangGraph Checkpoints (from filesystem & state.persistence)
      const stmtInsertCheckpoint = stagingDb.prepare(`
        INSERT OR REPLACE INTO langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint_json, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      const ingestedCheckpointKeys = new Set<string>()

      // Filesystem checkpoints: checkpoints/threads/<threadId>/checkpoints/*.json
      const checkpointsThreadsDir = path.join(sourceDir, 'checkpoints', 'threads')
      if (fs.existsSync(checkpointsThreadsDir)) {
        const threadDirs = fs.readdirSync(checkpointsThreadsDir)
        for (const threadId of threadDirs) {
          const threadCpDir = path.join(checkpointsThreadsDir, threadId, 'checkpoints')
          if (fs.existsSync(threadCpDir)) {
            const cpFiles = fs.readdirSync(threadCpDir)
            for (const file of cpFiles) {
              if (file.endsWith('.json')) {
                try {
                  const raw = fs.readFileSync(path.join(threadCpDir, file), 'utf8')
                  const cpObj = JSON.parse(raw) as unknown
                  if (isRecord(cpObj)) {
                    const cThreadId =
                      typeof cpObj.thread_id === 'string' ? cpObj.thread_id : threadId
                    const cNs = typeof cpObj.checkpoint_ns === 'string' ? cpObj.checkpoint_ns : ''
                    const cId =
                      typeof cpObj.checkpoint_id === 'string'
                        ? cpObj.checkpoint_id
                        : file.replace('.json', '')
                    const parentId =
                      typeof cpObj.parent_checkpoint_id === 'string'
                        ? cpObj.parent_checkpoint_id
                        : null
                    const cpJson =
                      typeof cpObj.checkpoint === 'string'
                        ? cpObj.checkpoint
                        : JSON.stringify(cpObj.checkpoint ?? {})
                    const metaJson =
                      typeof cpObj.metadata === 'string'
                        ? cpObj.metadata
                        : JSON.stringify(cpObj.metadata ?? {})
                    const createdAt =
                      typeof cpObj.created_at === 'number' ? cpObj.created_at : Date.now()

                    const key = `${cThreadId}:${cNs}:${cId}`
                    if (!ingestedCheckpointKeys.has(key)) {
                      stmtInsertCheckpoint.run(
                        cThreadId,
                        cNs,
                        cId,
                        parentId,
                        cpJson,
                        metaJson,
                        createdAt
                      )
                      ingestedCheckpointKeys.add(key)
                      expectedCheckpointCount++
                      artifactsMigrated++
                    }
                  }
                } catch {
                  // Skip unreadable file
                }
              }
            }
          }
        }
      }

      // Memory checkpoints from state.persistence.checkpoints
      if (isRecord(statePersistence.checkpoints)) {
        for (const [threadId, records] of Object.entries(statePersistence.checkpoints)) {
          if (Array.isArray(records)) {
            for (const rec of records) {
              if (isRecord(rec)) {
                const cThreadId = typeof rec.thread_id === 'string' ? rec.thread_id : threadId
                const cNs = typeof rec.checkpoint_ns === 'string' ? rec.checkpoint_ns : ''
                const cId =
                  typeof rec.checkpoint_id === 'string' ? rec.checkpoint_id : crypto.randomUUID()
                const parentId =
                  typeof rec.parent_checkpoint_id === 'string' ? rec.parent_checkpoint_id : null
                const cpJson =
                  typeof rec.checkpoint === 'string'
                    ? rec.checkpoint
                    : JSON.stringify(rec.checkpoint ?? {})
                const metaJson =
                  typeof rec.metadata === 'string'
                    ? rec.metadata
                    : JSON.stringify(rec.metadata ?? {})
                const createdAt = typeof rec.created_at === 'number' ? rec.created_at : Date.now()

                const key = `${cThreadId}:${cNs}:${cId}`
                if (!ingestedCheckpointKeys.has(key)) {
                  stmtInsertCheckpoint.run(
                    cThreadId,
                    cNs,
                    cId,
                    parentId,
                    cpJson,
                    metaJson,
                    createdAt
                  )
                  ingestedCheckpointKeys.add(key)
                  expectedCheckpointCount++
                  artifactsMigrated++
                }
              }
            }
          }
        }
      }

      // 5. LangGraph Blobs (from filesystem checkpoints/blobs & state.persistence.blobs)
      const stmtInsertBlob = stagingDb.prepare(`
        INSERT OR REPLACE INTO langgraph_blobs (thread_id, checkpoint_ns, channel, version, type, data_blob, serialized)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      const blobsDir = path.join(sourceDir, 'checkpoints', 'blobs')
      if (fs.existsSync(blobsDir)) {
        const blobFiles = fs.readdirSync(blobsDir)
        for (const file of blobFiles) {
          if (file.endsWith('.json')) {
            try {
              const encodedKey = file.replace('.json', '')
              const decodedKey = Buffer.from(encodedKey, 'base64url').toString('utf8')
              const parts = decodedKey.split(':')

              const raw = fs.readFileSync(path.join(blobsDir, file), 'utf8')
              const blobObj = JSON.parse(raw) as unknown
              if (isRecord(blobObj)) {
                let threadId = typeof blobObj.thread_id === 'string' ? blobObj.thread_id : ''
                let checkpointNs =
                  typeof blobObj.checkpoint_ns === 'string' ? blobObj.checkpoint_ns : ''
                let channel = typeof blobObj.channel === 'string' ? blobObj.channel : ''
                let version = typeof blobObj.version === 'string' ? blobObj.version : ''

                if (!threadId) {
                  if (parts.length === 3) {
                    threadId = parts[0]
                    checkpointNs = ''
                    channel = parts[1]
                    version = parts[2]
                  } else if (parts.length >= 4) {
                    threadId = parts[0]
                    checkpointNs = parts[1]
                    channel = parts[2]
                    version = parts.slice(3).join(':')
                  }
                }

                const type = typeof blobObj.type === 'string' ? blobObj.type : 'json'
                const serialized = blobObj.serialized ? 1 : 0
                let dataBlob: Buffer | null = null

                if (blobObj.blob !== undefined && blobObj.blob !== null) {
                  if (Buffer.isBuffer(blobObj.blob)) {
                    dataBlob = blobObj.blob
                  } else if (typeof blobObj.blob === 'string') {
                    dataBlob = Buffer.from(blobObj.blob, 'utf8')
                  } else {
                    dataBlob = Buffer.from(JSON.stringify(blobObj.blob), 'utf8')
                  }
                }

                if (threadId && channel && version) {
                  stmtInsertBlob.run(
                    threadId,
                    checkpointNs,
                    channel,
                    version,
                    type,
                    dataBlob,
                    serialized
                  )
                  artifactsMigrated++
                }
              }
            } catch {
              // Skip corrupt blob file
            }
          }
        }
      }

      // Memory blobs from state.persistence.blobs
      if (isRecord(statePersistence.blobs)) {
        for (const [blobKey, rec] of Object.entries(statePersistence.blobs)) {
          if (isRecord(rec)) {
            const parts = blobKey.split(':')
            let threadId = typeof rec.thread_id === 'string' ? rec.thread_id : ''
            let checkpointNs = typeof rec.checkpoint_ns === 'string' ? rec.checkpoint_ns : ''
            let channel = typeof rec.channel === 'string' ? rec.channel : ''
            let version = typeof rec.version === 'string' ? rec.version : ''

            if (!threadId) {
              if (parts.length === 3) {
                threadId = parts[0]
                channel = parts[1]
                version = parts[2]
              } else if (parts.length >= 4) {
                threadId = parts[0]
                checkpointNs = parts[1]
                channel = parts[2]
                version = parts.slice(3).join(':')
              }
            }

            const type = typeof rec.type === 'string' ? rec.type : 'json'
            const serialized = rec.serialized ? 1 : 0
            let dataBlob: Buffer | null = null

            if (rec.blob !== undefined && rec.blob !== null) {
              if (Buffer.isBuffer(rec.blob)) {
                dataBlob = rec.blob
              } else if (typeof rec.blob === 'string') {
                dataBlob = Buffer.from(rec.blob, 'utf8')
              } else {
                dataBlob = Buffer.from(JSON.stringify(rec.blob), 'utf8')
              }
            }

            if (threadId && channel && version) {
              stmtInsertBlob.run(
                threadId,
                checkpointNs,
                channel,
                version,
                type,
                dataBlob,
                serialized
              )
              artifactsMigrated++
            }
          }
        }
      }

      // 6. LangGraph Writes (from filesystem & state.persistence.writes)
      const stmtInsertWrite = stagingDb.prepare(`
        INSERT OR REPLACE INTO langgraph_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)

      if (fs.existsSync(checkpointsThreadsDir)) {
        const threadDirs = fs.readdirSync(checkpointsThreadsDir)
        for (const threadId of threadDirs) {
          const writesDir = path.join(checkpointsThreadsDir, threadId, 'writes')
          if (fs.existsSync(writesDir)) {
            const writeFiles = fs.readdirSync(writesDir)
            for (const file of writeFiles) {
              if (file.endsWith('.json')) {
                try {
                  const raw = fs.readFileSync(path.join(writesDir, file), 'utf8')
                  const writeData = JSON.parse(raw) as unknown
                  const writeArray = Array.isArray(writeData) ? writeData : [writeData]

                  for (const writeItem of writeArray) {
                    if (isRecord(writeItem)) {
                      const wThreadId =
                        typeof writeItem.thread_id === 'string' ? writeItem.thread_id : threadId
                      const wNs =
                        typeof writeItem.checkpoint_ns === 'string' ? writeItem.checkpoint_ns : ''
                      const wCpId =
                        typeof writeItem.checkpoint_id === 'string'
                          ? writeItem.checkpoint_id
                          : file.split('_')[0] || ''
                      const wTaskId =
                        typeof writeItem.task_id === 'string' ? writeItem.task_id : 'task'
                      const wIdx = typeof writeItem.idx === 'number' ? writeItem.idx : 0
                      const wChannel =
                        typeof writeItem.channel === 'string' ? writeItem.channel : 'default'
                      const wType = typeof writeItem.type === 'string' ? writeItem.type : 'json'
                      const blobJson =
                        typeof writeItem.blob_json === 'string'
                          ? writeItem.blob_json
                          : JSON.stringify(writeItem.blob ?? null)

                      stmtInsertWrite.run(
                        wThreadId,
                        wNs,
                        wCpId,
                        wTaskId,
                        wIdx,
                        wChannel,
                        wType,
                        blobJson
                      )
                      artifactsMigrated++
                    }
                  }
                } catch {
                  // Skip corrupt write file
                }
              }
            }
          }
        }
      }

      // Memory writes from state.persistence.writes
      if (isRecord(statePersistence.writes)) {
        for (const [threadId, records] of Object.entries(statePersistence.writes)) {
          if (Array.isArray(records)) {
            for (const writeItem of records) {
              if (isRecord(writeItem)) {
                const wThreadId =
                  typeof writeItem.thread_id === 'string' ? writeItem.thread_id : threadId
                const wNs =
                  typeof writeItem.checkpoint_ns === 'string' ? writeItem.checkpoint_ns : ''
                const wCpId =
                  typeof writeItem.checkpoint_id === 'string' ? writeItem.checkpoint_id : ''
                const wTaskId = typeof writeItem.task_id === 'string' ? writeItem.task_id : 'task'
                const wIdx = typeof writeItem.idx === 'number' ? writeItem.idx : 0
                const wChannel =
                  typeof writeItem.channel === 'string' ? writeItem.channel : 'default'
                const wType = typeof writeItem.type === 'string' ? writeItem.type : 'json'
                const blobJson =
                  typeof writeItem.blob_json === 'string'
                    ? writeItem.blob_json
                    : JSON.stringify(writeItem.blob ?? null)

                stmtInsertWrite.run(wThreadId, wNs, wCpId, wTaskId, wIdx, wChannel, wType, blobJson)
                artifactsMigrated++
              }
            }
          }
        }
      }

      // 7. LangGraph Restore Heads
      const stmtInsertRestoreHead = stagingDb.prepare(`
        INSERT OR REPLACE INTO langgraph_restore_heads (thread_id, checkpoint_ns, checkpoint_id, updated_at)
        VALUES (?, ?, ?, ?)
      `)

      const restoreHeadsPath = path.join(
        sourceDir,
        'checkpoints',
        'manifests',
        'restore-heads.json'
      )
      let restoreHeadsMap: Record<string, unknown> = {}

      if (fs.existsSync(restoreHeadsPath)) {
        try {
          const raw = fs.readFileSync(restoreHeadsPath, 'utf8')
          const parsed = JSON.parse(raw) as unknown
          if (isRecord(parsed)) restoreHeadsMap = parsed
        } catch {
          // ignore
        }
      }

      if (isRecord(statePersistence.restoreHeads)) {
        restoreHeadsMap = { ...restoreHeadsMap, ...statePersistence.restoreHeads }
      }

      for (const [compositeKey, cpIdVal] of Object.entries(restoreHeadsMap)) {
        if (typeof cpIdVal === 'string') {
          const headIdx = compositeKey.indexOf(':')
          let threadId = compositeKey
          let checkpointNs = ''
          if (headIdx !== -1) {
            threadId = compositeKey.substring(0, headIdx)
            checkpointNs = compositeKey.substring(headIdx + 1)
          }
          stmtInsertRestoreHead.run(threadId, checkpointNs, cpIdVal, Date.now())
          artifactsMigrated++
        }
      }

      // 8. Snapshots (Preserving instance foreign keys)
      const stmtInsertSnapshot = stagingDb.prepare(`
        INSERT OR REPLACE INTO workspace_snapshots
        (id, instance_id, project_id, instance_type, snapshot_ref, snapshot_hash, snapshot_cursor_json, snapshot_msgpack, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const knownSnapshotRefs = new Set<string>()

      for (const snapVal of stateSnapshots) {
        if (isRecord(snapVal)) {
          const instId = typeof snapVal.instanceId === 'string' ? snapVal.instanceId : ''
          // Foreign key guard: instance must exist
          if (!knownInstanceIds.has(instId)) {
            continue
          }

          const id = typeof snapVal.id === 'string' ? snapVal.id : crypto.randomUUID()
          const projId =
            typeof snapVal.projectId === 'string' && manifestProjects[snapVal.projectId]
              ? snapVal.projectId
              : defaultProjectId
          const instType =
            typeof snapVal.instanceType === 'string' ? snapVal.instanceType : 'document'
          const snapRef =
            typeof snapVal.snapshotRef === 'string' ? snapVal.snapshotRef : `${id}.msgpack`
          const snapHash = typeof snapVal.snapshotHash === 'string' ? snapVal.snapshotHash : id
          const cursorJson = JSON.stringify(snapVal.snapshotCursor ?? {})
          const nowIso = new Date().toISOString()
          const createdAt = typeof snapVal.createdAt === 'string' ? snapVal.createdAt : nowIso

          // Resolve snapshot BLOB
          let snapshotBlob: Buffer = Buffer.alloc(0)
          const snapPaths = [
            path.join(sourceDir, 'data', 'workspace', snapRef),
            path.join(sourceDir, 'workspace', snapRef),
            path.join(sourceDir, 'snapshots', snapRef)
          ]

          for (const sp of snapPaths) {
            if (fs.existsSync(sp)) {
              snapshotBlob = fs.readFileSync(sp)
              break
            }
          }

          if (snapshotBlob.length === 0) {
            const packed = pack(snapVal.snapshot ?? {})
            snapshotBlob = Buffer.isBuffer(packed) ? packed : Buffer.from(packed)
          }

          stmtInsertSnapshot.run(
            id,
            instId,
            projId,
            instType,
            snapRef,
            snapHash,
            cursorJson,
            snapshotBlob,
            createdAt
          )

          knownSnapshotRefs.add(snapRef)
          artifactsMigrated++
        }
      }

      // 9. Command Logs
      const stmtInsertCommandLog = stagingDb.prepare(`
        INSERT INTO workspace_command_logs (instance_id, command_id, command_type, payload_json, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const [instId, logEntries] of Object.entries(stateLogs)) {
        if (!knownInstanceIds.has(instId) || !Array.isArray(logEntries)) {
          continue
        }

        for (const entryVal of logEntries) {
          if (isRecord(entryVal)) {
            const cmdId =
              typeof entryVal.commandId === 'string'
                ? entryVal.commandId
                : typeof entryVal.id === 'string'
                  ? entryVal.id
                  : crypto.randomUUID()
            const cmdType =
              typeof entryVal.commandType === 'string'
                ? entryVal.commandType
                : typeof entryVal.command === 'string'
                  ? entryVal.command
                  : 'unknown'
            const payloadJson = JSON.stringify(entryVal.payload ?? entryVal)
            const timestamp =
              typeof entryVal.timestamp === 'number' ? entryVal.timestamp : Date.now()

            stmtInsertCommandLog.run(instId, cmdId, cmdType, payloadJson, timestamp)
            artifactsMigrated++
          }
        }
      }

      // 10. File Revisions
      const stmtInsertFileRevision = stagingDb.prepare(`
        INSERT OR REPLACE INTO file_revisions (id, name, description, snapshot_ref, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      for (const revVal of stateRevisions) {
        if (isRecord(revVal)) {
          const snapRef = typeof revVal.snapshotRef === 'string' ? revVal.snapshotRef : ''
          // Foreign key guard: snapshot_ref must exist in workspace_snapshots
          if (!knownSnapshotRefs.has(snapRef)) {
            continue
          }

          const revId = typeof revVal.id === 'string' ? revVal.id : crypto.randomUUID()
          const revName = typeof revVal.name === 'string' ? revVal.name : 'Revision'
          const description = typeof revVal.description === 'string' ? revVal.description : null
          const createdAt =
            typeof revVal.createdAt === 'string' ? revVal.createdAt : new Date().toISOString()

          stmtInsertFileRevision.run(revId, revName, description, snapRef, createdAt)
          artifactsMigrated++
        }
      }

      // User version
      stagingDb.pragma('user_version = 4')
    })

    this.reportProgress(
      'ingesting',
      65,
      `Staging ingestion completed. Migrated ${artifactsMigrated} entities.`
    )

    return {
      artifactsMigrated,
      instanceCount: expectedInstanceCount,
      checkpointCount: expectedCheckpointCount
    }
  }

  public verifyIntegrityGates(
    stagingDb: SqliteDatabase,
    expectedInstances: number,
    expectedCheckpoints: number
  ): void {
    this.reportProgress('verifying', 70, 'Running Gate 1: PRAGMA foreign_key_check')
    if (!stagingDb.foreignKeyCheck()) {
      throw new StorageError(
        StorageErrorCode.STORAGE_FOREIGN_KEY_VIOLATION,
        'Gate 1 Failed: Foreign key check revealed orphaned records'
      )
    }

    this.reportProgress('verifying', 75, 'Running Gate 2: PRAGMA integrity_check')
    if (!stagingDb.integrityCheck()) {
      throw new StorageError(
        StorageErrorCode.STORAGE_INTEGRITY_CHECK_FAILED,
        'Gate 2 Failed: Database integrity check failed'
      )
    }

    this.reportProgress('verifying', 80, 'Running Gate 3: Instance count parity')
    const instCountRow = stagingDb
      .prepare('SELECT COUNT(*) as count FROM instances')
      .get() as unknown
    if (!isCountRow(instCountRow) || instCountRow.count !== expectedInstances) {
      const actual = isCountRow(instCountRow) ? instCountRow.count : -1
      throw new StorageError(
        StorageErrorCode.STORAGE_MIGRATION_FAILED,
        `Gate 3 Failed: Instance count parity mismatch. Expected ${expectedInstances}, found ${actual}`,
        { expected: expectedInstances, actual }
      )
    }

    this.reportProgress('verifying', 85, 'Running Gate 4: Checkpoint count parity')
    const cpCountRow = stagingDb
      .prepare('SELECT COUNT(*) as count FROM langgraph_checkpoints')
      .get() as unknown
    if (!isCountRow(cpCountRow) || cpCountRow.count !== expectedCheckpoints) {
      const actual = isCountRow(cpCountRow) ? cpCountRow.count : -1
      throw new StorageError(
        StorageErrorCode.STORAGE_MIGRATION_FAILED,
        `Gate 4 Failed: Checkpoint count parity mismatch. Expected ${expectedCheckpoints}, found ${actual}`,
        { expected: expectedCheckpoints, actual }
      )
    }

    this.reportProgress('verifying', 90, 'Running Gate 5: BLOB MessagePack unpack assertion')
    const sampleRows = stagingDb
      .prepare(
        `SELECT id, content_msgpack FROM instances WHERE content_msgpack IS NOT NULL LIMIT ${this.migrationConfig.maxBlobValidationSampleCount}`
      )
      .all() as unknown[]

    for (const row of sampleRows) {
      if (isBlobSampleRow(row) && row.content_msgpack !== null) {
        try {
          unpack(
            Buffer.isBuffer(row.content_msgpack)
              ? row.content_msgpack
              : Buffer.from(row.content_msgpack)
          )
        } catch (err: unknown) {
          throw new StorageError(
            StorageErrorCode.STORAGE_CORRUPT_DATABASE,
            `Gate 5 Failed: Failed to unpack MessagePack content for instance ${row.id}`,
            { instanceId: row.id },
            err instanceof Error ? err : undefined
          )
        }
      }
    }

    this.reportProgress('verifying', 95, 'All 5 verification integrity gates passed cleanly')
  }

  public async executeMigration(sourcePath: string): Promise<MigrationReport> {
    const startTime = Date.now()
    const tempExtractionDir = path.join(
      os.tmpdir(),
      `collar-migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    const stagingDbPath = `${sourcePath}.tmp`

    let backupPath = ''
    let stagingDb: SqliteDatabase | null = null
    let dirtyDirToDecommission: string | null = null

    try {
      // Step 1: Detect format
      const format = this.detectFormat(sourcePath)
      if (format === 'v4_sqlite') {
        return {
          success: true,
          fromVersion: 4,
          toVersion: 4,
          artifactsMigrated: 0,
          durationMs: Date.now() - startTime,
          backupPath: ''
        }
      }

      if (format === 'unknown') {
        throw new StorageError(
          StorageErrorCode.STORAGE_MIGRATION_FAILED,
          `Cannot migrate file with unknown format: ${sourcePath}`,
          { sourcePath }
        )
      }

      // Step 2: Atomic Safety Backup
      backupPath = await this.backup(sourcePath)

      // Step 3: Extract archive or copy dirty workspace
      const extractResult = await this.extractSource(sourcePath, tempExtractionDir)
      dirtyDirToDecommission = extractResult.dirtyDir

      // Step 4: Check and normalize legacy V2 monolithic structure if needed
      await this.normalizeLegacyV2IfPresent(tempExtractionDir)

      // Step 5: Initialize staging SQLite database
      if (fs.existsSync(stagingDbPath)) {
        await fs.promises.rm(stagingDbPath, { force: true })
      }

      stagingDb = new SqliteDatabase(stagingDbPath, {
        config: this.config,
        autoMigrate: true
      })

      // Step 6: Transactional Staging Ingestion
      const stats = this.ingestStaging(stagingDb, tempExtractionDir)

      // Step 7: 5 Verification Integrity Gates
      this.verifyIntegrityGates(stagingDb, stats.instanceCount, stats.checkpointCount)

      // Step 8: Atomic Cutover
      this.reportProgress('cutover', 96, 'Closing staging database handle for cutover')
      stagingDb.close()
      stagingDb = null

      this.reportProgress(
        'cutover',
        98,
        'Atomically replacing original project with V4 SQLite database'
      )
      await fs.promises.rename(stagingDbPath, sourcePath)

      // Step 9: Clean up extraction directory
      try {
        await fs.promises.rm(tempExtractionDir, { recursive: true, force: true })
      } catch {
        // Non-fatal cleanup
      }

      // Step 10: Decommission dirty adjacent .collar directory if present
      if (dirtyDirToDecommission && fs.existsSync(dirtyDirToDecommission)) {
        try {
          const lockFile = `${dirtyDirToDecommission}.lock`
          if (fs.existsSync(lockFile)) {
            await fs.promises.rm(lockFile, { force: true })
          }
          await fs.promises.rm(dirtyDirToDecommission, { recursive: true, force: true })
        } catch {
          // Suppress directory cleanup warning
        }
      }

      this.reportProgress(
        'completed',
        100,
        `Migration completed successfully in ${Date.now() - startTime}ms`
      )

      return {
        success: true,
        fromVersion: 3,
        toVersion: 4,
        artifactsMigrated: stats.artifactsMigrated,
        durationMs: Date.now() - startTime,
        backupPath
      }
    } catch (err: unknown) {
      this.reportProgress(
        'failed',
        100,
        `Migration failed: ${err instanceof Error ? err.message : String(err)}`
      )

      // Fail-Closed Rollback
      if (stagingDb) {
        try {
          stagingDb.close()
        } catch {
          // ignore
        }
      }

      // Clean up staging database and sidecars
      const sidecars = [stagingDbPath, `${stagingDbPath}-wal`, `${stagingDbPath}-shm`]
      for (const sc of sidecars) {
        if (fs.existsSync(sc)) {
          try {
            fs.rmSync(sc, { force: true })
          } catch {
            // ignore
          }
        }
      }

      // Clean up temp extraction dir
      if (fs.existsSync(tempExtractionDir)) {
        try {
          fs.rmSync(tempExtractionDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }

      // If sourcePath was modified or removed, restore from backup
      if (backupPath && fs.existsSync(backupPath)) {
        if (!fs.existsSync(sourcePath) || detectStorageFormat(sourcePath) !== 'legacy_zip') {
          try {
            fs.copyFileSync(backupPath, sourcePath)
          } catch {
            // ignore
          }
        }
      }

      if (err instanceof StorageError) {
        throw err
      }

      throw new StorageError(
        StorageErrorCode.STORAGE_MIGRATION_FAILED,
        `Storage migration failed: ${err instanceof Error ? err.message : String(err)}`,
        { sourcePath, backupPath },
        err instanceof Error ? err : undefined
      )
    }
  }

  protected reportProgress(stage: MigrationStage, percent: number, message?: string): void {
    if (this.onProgress) {
      try {
        this.onProgress({ stage, percent, message })
      } catch {
        // Progress callbacks should not interrupt critical migration paths
      }
    }
  }
}
