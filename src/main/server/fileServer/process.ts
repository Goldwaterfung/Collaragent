import { startFilesystemApi, type FilesystemApiHandle } from './filesystemAPI'
import { ArchiveManager } from './ArchiveManager'
import fs from 'node:fs'
import path from 'node:path'
import { ImportCagentArchive } from './ImportCagentArchive'

let handle: FilesystemApiHandle | null = null
const archiveManager = new ArchiveManager()
let workingDirectory: string | null = null
let openFilePath: string | null = null
let sourceArchivePath: string | null = null
let isArchiveBacked = false

process.parentPort.on('message', async (e) => {
  const { type, payload } = e.data

  if (type === 'start') {
    const { filePath } = payload
    try {
      // Calculate adjacent .collar directory
      isArchiveBacked = filePath.endsWith('.cagent')
      sourceArchivePath = isArchiveBacked ? filePath : null
      const targetDir = isArchiveBacked 
          ? path.join(path.dirname(filePath), path.basename(filePath, '.cagent') + '.collar')
        : filePath

      openFilePath = isArchiveBacked ? targetDir : filePath // Future exports can target the cagent, but the active workspace is the folder
      const lockFilePath = `${openFilePath}.lock`
      
      if (fs.existsSync(lockFilePath)) {
        console.warn(`[WARNING] Lock file exists at ${lockFilePath}. Another instance may be modifying this archive.`)
      }
      await fs.promises.writeFile(lockFilePath, JSON.stringify({ pid: process.pid, time: Date.now() })).catch(console.error)

      // Reuse an existing live folder when present so unsaved archive changes survive app restarts.
      if (isArchiveBacked) {
        const hasLiveWorkspace = fs.existsSync(path.join(targetDir, 'manifest.json')) || fs.existsSync(path.join(targetDir, 'state.json'))
        workingDirectory = hasLiveWorkspace ? targetDir : await archiveManager.mount(filePath, targetDir)
      } else {
        workingDirectory = filePath
      }
      
      if (!workingDirectory) throw new Error("working directory resolution failed")
      
      const manifestPath = path.join(workingDirectory, "manifest.json")
      if (!fs.existsSync(manifestPath) && fs.existsSync(path.join(workingDirectory, "cagent.json"))) {
         console.log("[Migration] Legacy cagent.json detected. Running ImportCagentArchive migrator...")
         const migrator = new ImportCagentArchive()
         const report = await migrator.migrate(workingDirectory)
           if (!report.success) {
           console.error("Migration failed:", report.errors)
           } else {
           console.log("Migration successful! Artifacts migrated:", report.artifactsMigrated)
           }
      }
      
      handle = await startFilesystemApi({ 
          filePath, 
          workingDirectory,
          port: 0
      })
      
      process.parentPort.postMessage({ type: 'ready', payload: { port: handle.port } })

      // Forward rename events
      handle.storage.on('renamed', (event) => {
        process.parentPort.postMessage({ type: 'renamed', payload: event })
      })
    } catch (err: any) {
      console.error('Failed to start filesystem API:', err)
      process.parentPort.postMessage({ type: 'error', payload: { message: err.message } })
    }
    } else if (type === 'get-close-state') {
      if (!handle) {
        process.parentPort.postMessage({
          type: 'close-state-ready',
          payload: {
            sourceArchivePath,
            isUpdated: false,
            lastExportedAt: null,
            liveWorkspacePath: workingDirectory,
            isArchiveBacked,
          }
        })
        return
      }

      process.parentPort.postMessage({
        type: 'close-state-ready',
        payload: handle.storage.getCloseState(),
      })
    } else if (type === 'prepare-close') {
      const saveToArchive = payload?.saveToArchive === true

      try {
        if (handle) {
          await handle.storage.flushPendingSaves()

          if (saveToArchive) {
            if (!sourceArchivePath || !workingDirectory) {
              throw new Error('No source archive available for save-on-close')
            }
            await archiveManager.commit(workingDirectory, sourceArchivePath)
          }

          if (workingDirectory && openFilePath) {
            const lockFilePath = `${openFilePath}.lock`
            if (fs.existsSync(lockFilePath)) {
              await fs.promises.rm(lockFilePath, { force: true }).catch(console.error)
            }
          }

          await handle.close()
          handle = null
        }

        process.parentPort.postMessage({ type: 'close-prepared', payload: { success: true } })
      } catch (err: any) {
        console.error('Failed to prepare close in process:', err)
        process.parentPort.postMessage({ type: 'close-prepared', payload: { success: false, error: err.message } })
      }
  } else if (type === 'set-ws-port') {
    const { port } = payload
    if (handle) {
      handle.setWsPort(port)
    }
  } else if (type === 'close') {
      if (handle) {
          if (workingDirectory && openFilePath) {
          const lockFilePath = `${openFilePath}.lock`
              if (fs.existsSync(lockFilePath)) {
            await fs.promises.rm(lockFilePath, { force: true }).catch(console.error)
              }
          }
          await handle.close()
          handle = null
      }
      workingDirectory = null
      process.exit(0)
  } else if (type === 'export') {
    const { targetPath } = payload
    try {
        if (!workingDirectory) throw new Error("No active working directory to export")
      if (!handle) throw new Error("No active filesystem handle to export")
      await handle.storage.flushPendingSaves()
        await archiveManager.commit(workingDirectory, targetPath)
      await handle.storage.markArchiveExported(targetPath)
        process.parentPort.postMessage({ type: 'export-ready', payload: { success: true } })
    } catch (err: any) {
        console.error('Export failed in process:', err)
        process.parentPort.postMessage({ type: 'export-ready', payload: { success: false, error: err.message } })
    }
  }
})
