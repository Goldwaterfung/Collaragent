import { app, BrowserWindow, dialog, utilityProcess, UtilityProcess } from 'electron'
import { join } from 'path'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { applyStateToOptions } from '../windowState'
import { startWsServer, type WsServerHandle } from '../server/ws/ws-server'

type WindowRecord = {
  id: number
  window: BrowserWindow
  filePath: string
  fsProcess: UtilityProcess
  fsPort: number
  wsHandle: WsServerHandle
  allowWindowClose: boolean
  isClosing: boolean
  fsPreparedForClose: boolean
  resourcesDisposed: boolean
}

type CloseState = {
  sourceArchivePath: string | null
  isUpdated: boolean
  lastExportedAt: number | null
  liveWorkspacePath: string | null
  isArchiveBacked: boolean
}

type ProcessResult = {
  success: boolean
  error?: string
}

class WindowManager {
  private windows = new Map<number, WindowRecord>()
  private nextId = 1

  private async requestFsProcess<T>(rec: WindowRecord, requestType: string, responseType: string, payload?: Record<string, unknown>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        rec.fsProcess.removeListener('message', handler)
        reject(new Error(`Timeout waiting for ${responseType}`))
      }, 30000)

      const handler = (data: any) => {
        if (data.type !== responseType) return
        clearTimeout(timeout)
        rec.fsProcess.removeListener('message', handler)
        resolve(data.payload as T)
      }

      rec.fsProcess.on('message', handler)
      rec.fsProcess.postMessage({ type: requestType, payload })
    })
  }

  private async getCloseState(rec: WindowRecord): Promise<CloseState> {
    return await this.requestFsProcess<CloseState>(rec, 'get-close-state', 'close-state-ready')
  }

  private async prepareClose(rec: WindowRecord, options: { saveToArchive: boolean }): Promise<ProcessResult> {
    return await this.requestFsProcess<ProcessResult>(rec, 'prepare-close', 'close-prepared', options)
  }

  private async disposeWindowResources(rec: WindowRecord): Promise<void> {
    if (rec.resourcesDisposed) return
    rec.resourcesDisposed = true

    try {
      await rec.wsHandle.flush()
    } catch (err) {
      console.warn('[WindowManager] ws flush failed', err)
    }

    try {
      await rec.wsHandle.close()
    } catch (err) {
      console.warn('[WindowManager] ws close failed', err)
    }

    try {
      if (!rec.fsPreparedForClose) {
        rec.fsProcess.postMessage({ type: 'close' })
        // Wait for process to exit naturally with a safety timeout
        await new Promise<void>((resolve) => {
          rec.fsProcess.once('exit', () => resolve())
          setTimeout(resolve, 30000) // Safety fallback
        })
      }
      rec.fsProcess.kill()
    } catch (err) {
      console.warn('[WindowManager] fs process close failed', err)
    }

    this.windows.delete(rec.id)
  }

  private async handleManagedWindowClose(rec: WindowRecord): Promise<void> {
    if (rec.isClosing || rec.window.isDestroyed()) return
    rec.isClosing = true

    try {
      // Deterministically flush in-memory WS changes to storage engine before checking close state
      await rec.wsHandle.flush()

      const closeState = await this.getCloseState(rec)
      let saveToArchive = false
      if (closeState.isArchiveBacked && closeState.isUpdated) {
        const sourceName = closeState.sourceArchivePath ? path.basename(closeState.sourceArchivePath) : path.basename(rec.filePath)
        const liveName = closeState.liveWorkspacePath ? path.basename(closeState.liveWorkspacePath) : `${path.basename(sourceName, '.cagent')}.collar`

        const choice = await dialog.showMessageBox(rec.window, {
          type: 'warning',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          title: 'Unsaved Archive Changes',
          message: `${sourceName} has live changes that are not packed into the archive yet.`,
          detail: `Current edits are stored in ${liveName}. Save will export the live workspace back into the .cagent archive and keep the .collar folder for future editing.`
        })

        if (choice.response === 2) {
          rec.isClosing = false
          return
        }

        saveToArchive = choice.response === 0
      }

      // Notify the renderer that archive writing is starting so the ProgressBar appears.
      // This mirrors the same push done in the manual exportWorkspace IPC handler.
      if (saveToArchive && !rec.window.isDestroyed()) {
        rec.window.webContents.send('export:started')
      }

      const result = await this.prepareClose(rec, { saveToArchive })

      if (saveToArchive && !rec.window.isDestroyed()) {
        rec.window.webContents.send('export:ended')
      }

      if (!result.success) {
        await dialog.showMessageBox(rec.window, {
          type: 'error',
          title: 'Close Failed',
          message: 'The workspace could not be prepared for close.',
          detail: result.error || 'Unknown error'
        })
        rec.isClosing = false
        return
      }

      rec.fsPreparedForClose = true
      rec.allowWindowClose = true
      rec.window.close()
    } catch (err: any) {
      console.error('[WindowManager] managed close failed', err)
      // Ensure the progress bar is dismissed even if something goes wrong
      if (!rec.window.isDestroyed()) {
        rec.window.webContents.send('export:ended')
      }
      try {
        await dialog.showMessageBox(rec.window, {
          type: 'error',
          title: 'Close Failed',
          message: 'The workspace could not be closed safely.',
          detail: err?.message || 'Unknown error'
        })
      } catch {
        // ignore dialog errors if the window is already unstable
      }
      rec.isClosing = false
    }
  }

  public async openFile(filePath: string, reuseWindow?: BrowserWindow): Promise<WindowRecord> {
    // Start Filesystem API via UtilityProcess
    const scriptPath = is.dev
      ? join(__dirname, '../../out/main/server.js')
      : join(__dirname, '../main/server.js')
    
    const fsProcess = utilityProcess.fork(scriptPath)
    
    const fsPort = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Timeout waiting for filesystem process'))
        }, 100000)

        const onMessage = (data: any) => {
            if (data.type === 'ready') {
                cleanup()
                resolve(data.payload.port)
            } else if (data.type === 'error') {
                cleanup()
                reject(new Error(data.payload.message))
            }
        }

        const onExit = (code: number) => {
            cleanup()
            reject(new Error(`Filesystem process exited with code ${code} before becoming ready`))
        }

        const cleanup = () => {
            clearTimeout(timeout)
            fsProcess.removeListener('message', onMessage)
            fsProcess.removeListener('exit', onExit)
        }

        if (reuseWindow && !reuseWindow.isDestroyed()) {
            reuseWindow.webContents.send('import:started')
        }

        fsProcess.once('spawn', () => {
            fsProcess.postMessage({ type: 'start', payload: { filePath } })
        })

        fsProcess.on('message', onMessage)
        fsProcess.once('exit', onExit)
    })

    if (reuseWindow && !reuseWindow.isDestroyed()) {
        reuseWindow.webContents.send('import:ended')
    }

    // Start WS server and point it at the filesystem API's instances endpoint
    const apiBase = `http://127.0.0.1:${fsPort}/api/instances`
    const wsHandle = await startWsServer({ port: 0, apiBaseUrl: apiBase })
    
    // Wire up the WS port back to the Filesystem API so it can broadcast updates
    fsProcess.postMessage({ type: 'set-ws-port', payload: { port: wsHandle.port } })

    let win: BrowserWindow
    const id = this.nextId++

    // DECISION: Reuse window logic
    // We only reuse if:
    // 1. A window was provided (reuseWindow)
    // 2. It is NOT already managing a project (not in this.windows map)
    const isManaged = reuseWindow && Array.from(this.windows.values()).some(r => r.window.id === reuseWindow.id)
    
    if (reuseWindow && !isManaged && !reuseWindow.isDestroyed()) {
      console.log(`[WindowManager] Reusing existing window (id=${reuseWindow.id}) for file: ${path.basename(filePath)}`)
      win = reuseWindow
    } else {
      console.log(`[WindowManager] Spawning new window for file: ${path.basename(filePath)}`)
      win = new BrowserWindow(applyStateToOptions({
        width: 1280,
        height: 720,
        show: false, // Don't show until ready
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 10, y: 10 } } : {}),
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          sandbox: false,
        },
      }))
      win.on('ready-to-show', () => win.show())
    }

    // Compose URL (respect dev mode)
    let url: string
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      url = `${process.env['ELECTRON_RENDERER_URL']}?apiPort=${fsPort}&wsPort=${wsHandle.port}&filePath=${encodeURIComponent(filePath)}`
    } else {
      url = `file://${join(__dirname, '../renderer/index.html')}?apiPort=${fsPort}&wsPort=${wsHandle.port}&filePath=${encodeURIComponent(filePath)}`
    }

    void win.loadURL(url)
    win.setTitle(path.basename(filePath))

    const rec: WindowRecord = {
      id,
      window: win,
      filePath,
      fsProcess,
      fsPort,
      wsHandle,
      allowWindowClose: false,
      isClosing: false,
      fsPreparedForClose: false,
      resourcesDisposed: false,
    }
    this.windows.set(id, rec)

    // Listen for storage-level rename events to update window metadata
    fsProcess.on('message', (data: any) => {
        if (data.type === 'renamed') {
            const { newPath } = data.payload
            rec.filePath = newPath
            try {
                rec.window.setTitle(path.basename(newPath))
            } catch (e) {
                // ignore
            }
            try { app.addRecentDocument(newPath) } catch (e) { /* ignore */ }
        }
    })

    win.on('close', (event) => {
      if (rec.allowWindowClose) {
        return
      }

      event.preventDefault()
      void this.handleManagedWindowClose(rec)
    })

    win.on('closed', () => {
      void this.disposeWindowResources(rec)
    })

    return rec
  }

  public async closeWindow(id: number): Promise<void> {
    const rec = this.windows.get(id)
    if (!rec) return

    if (!rec.window.isDestroyed()) {
      rec.window.close()
      return
    }

    await this.disposeWindowResources(rec)
  }

  public listWindows() {
    return Array.from(this.windows.values()).map(w => ({ id: w.id, filePath: w.filePath, port: w.fsPort }))
  }

  public getWindowRecord(windowId: number): WindowRecord | undefined {
    for (const record of this.windows.values()) {
      if (record.window.id === windowId) return record
    }
    return undefined
  }

  public async exportArchive(windowId: number, targetPath: string): Promise<{ success: boolean; error?: string }> {
    const rec = this.getWindowRecord(windowId)
    if (!rec) return { success: false, error: 'No active workspace found for this window' }

    return await this.requestFsProcess<{ success: boolean; error?: string }>(rec, 'export', 'export-ready', { targetPath })
  }
}

export const windowManager = new WindowManager()

export default windowManager
