/**
 * process.ts: UtilityProcess Entry Point for CollarAgent V4 Embedded Storage Architecture
 * Conforms to docs/sqlite-storage-architecture/spec.md (Section 6.1, Task 5.2)
 * and .agents/rules/coding-rules.md (Zero any, no hardcoded constants, cause preservation).
 */

import fs from 'node:fs'
import { startFilesystemApi, type FilesystemApiHandle } from './filesystemAPI'
import { StorageMigrationEngine } from './StorageMigrationEngine'

export interface ProcessMessage {
  type: string
  payload?: Record<string, unknown>
}

export interface ProcessContext {
  postMessage: (msg: unknown) => void
  exit?: (code?: number) => void
}

export class UtilityProcessController {
  private handle: FilesystemApiHandle | null = null
  private openFilePath: string | null = null
  private readonly migrationEngine: StorageMigrationEngine

  constructor(migrationEngine?: StorageMigrationEngine) {
    this.migrationEngine = migrationEngine ?? new StorageMigrationEngine()
  }

  public get apiHandle(): FilesystemApiHandle | null {
    return this.handle
  }

  public get currentFilePath(): string | null {
    return this.openFilePath
  }

  public async handleMessage(message: ProcessMessage, context: ProcessContext): Promise<void> {
    const { type, payload } = message

    if (type === 'start') {
      const filePath = typeof payload?.filePath === 'string' ? payload.filePath : null
      if (!filePath) {
        context.postMessage({
          type: 'error',
          payload: { message: 'Missing filePath in start payload' }
        })
        return
      }

      try {
        this.openFilePath = filePath

        // Perform automated V2/V3 to V4 migration if existing archive is detected
        if (fs.existsSync(filePath)) {
          const format = this.migrationEngine.detectFormat(filePath)
          if (format === 'legacy_zip') {
            console.log(`[process] Legacy archive format detected. Executing V4 migration...`)
            const migrationResult = await this.migrationEngine.executeMigration(filePath)
            if (!migrationResult.success) {
              const errorDetails = migrationResult.errors?.join('; ') || 'Unknown migration error'
              throw new Error(`Storage migration failed: ${errorDetails}`)
            }
            console.log(
              `[process] V4 migration completed successfully in ${migrationResult.durationMs}ms`
            )
          }
        }

        // Initialize V4 storage and loopback Express server
        this.handle = await startFilesystemApi({
          filePath,
          port: 0
        })

        context.postMessage({
          type: 'ready',
          payload: { port: this.handle.port }
        })

        // Forward storage rename events to parent process
        if (typeof this.handle.storage.on === 'function') {
          this.handle.storage.on('renamed', (event: unknown) => {
            context.postMessage({ type: 'renamed', payload: event })
          })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[process] Failed to start filesystem API:', message)
        context.postMessage({ type: 'error', payload: { message } })
      }
    } else if (type === 'get-close-state') {
      if (!this.handle) {
        context.postMessage({
          type: 'close-state-ready',
          payload: {
            sourceArchivePath: this.openFilePath,
            isUpdated: false,
            lastExportedAt: null,
            liveWorkspacePath: null,
            isArchiveBacked: true
          }
        })
        return
      }

      context.postMessage({
        type: 'close-state-ready',
        payload: this.handle.storage.getCloseState()
      })
    } else if (type === 'prepare-close') {
      try {
        if (this.handle) {
          // V4 <10ms teardown budget: WAL checkpoint truncate and lock release
          await this.handle.storage.prepareClose()
          await this.handle.close()
          this.handle = null
        }

        context.postMessage({ type: 'close-prepared', payload: { success: true } })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[process] Failed to prepare close:', message)
        context.postMessage({
          type: 'close-prepared',
          payload: { success: false, error: message }
        })
      }
    } else if (type === 'set-ws-port') {
      const wsPort = typeof payload?.port === 'number' ? payload.port : 0
      if (this.handle && wsPort > 0) {
        this.handle.setWsPort(wsPort)
      }
    } else if (type === 'export') {
      const targetPath = typeof payload?.targetPath === 'string' ? payload.targetPath : null
      try {
        if (!this.handle) {
          throw new Error('No active filesystem handle to export')
        }
        if (!targetPath) {
          throw new Error('Missing targetPath for export')
        }

        await this.handle.storage.flushPendingSaves()

        if (
          this.openFilePath &&
          targetPath !== this.openFilePath &&
          fs.existsSync(this.openFilePath)
        ) {
          await fs.promises.copyFile(this.openFilePath, targetPath)
        }

        await this.handle.storage.markArchiveExported(targetPath)
        context.postMessage({ type: 'export-ready', payload: { success: true } })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[process] Export failed:', message)
        context.postMessage({
          type: 'export-ready',
          payload: { success: false, error: message }
        })
      }
    } else if (type === 'close') {
      if (this.handle) {
        await this.handle.close()
        this.handle = null
      }
      this.openFilePath = null
      if (context.exit) {
        context.exit(0)
      }
    }
  }
}

// Global Controller Instance
export const globalProcessController = new UtilityProcessController()

// Wire to Electron UtilityProcess parentPort if available
declare const process: NodeJS.Process & {
  parentPort?: {
    on(event: 'message', listener: (e: { data: ProcessMessage }) => void): void
    postMessage(message: unknown): void
  }
}

if (typeof process.parentPort !== 'undefined' && process.parentPort !== null) {
  const parentPort = process.parentPort
  parentPort.on('message', async (e: { data: ProcessMessage }) => {
    await globalProcessController.handleMessage(e.data, {
      postMessage: (msg: unknown) => parentPort.postMessage(msg),
      exit: (code?: number) => process.exit(code)
    })
  })
}
