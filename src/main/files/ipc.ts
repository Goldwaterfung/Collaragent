import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import fs from 'fs'
import windowManager from '../windows/WindowManager'

import { ConfigManager } from '../config/ConfigManager'

export function registerFileIpc(configManager: ConfigManager) {
  ipcMain.handle('dialog:openFile', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CollarAgent Files', extensions: ['cagent'] }],
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true }
    }
    const filePath = result.filePaths[0]
    try {
      // Get the window that initiated the request
      const senderWindow = BrowserWindow.fromWebContents(event.sender) || undefined
      
      const rec = await windowManager.openFile(filePath, senderWindow)
      await configManager.addRecentFile(filePath)
      try { app.addRecentDocument(filePath) } catch (e) { /* ignore */ }
      return { canceled: false, success: true, windowId: rec.id }
    } catch (err: any) {
      console.error('[ipc] Failed to open file:', err)
      return { canceled: false, success: false, error: err?.message }
    }
  })

  ipcMain.handle('file:removeRecent', async (_event, filePath: string) => {
    return configManager.removeRecentFile(filePath)
  })

  ipcMain.handle('file:openPath', async (event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        const result = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Create New', 'Remove from List', 'Cancel'],
          defaultId: 0,
          title: 'File Not Found',
          message: `The file "${filePath}" does not exist.`,
          detail: 'Would you like to create it as a new file or remove it from the recent files list?'
        })

        if (result.response === 0) {
          // Create new (proceed with opening - storage engine will create it)
        } else if (result.response === 1) {
          // Remove from list
          await configManager.removeRecentFile(filePath)
          return { success: false, error: 'File removed from recent list' }
        } else {
          // Cancel
          return { success: false, error: 'Operation canceled' }
        }
      }

      const senderWindow = BrowserWindow.fromWebContents(event.sender) || undefined
      const rec = await windowManager.openFile(filePath, senderWindow)
      await configManager.addRecentFile(filePath)
      try { app.addRecentDocument(filePath) } catch (e) { /* ignore */ }
      return { success: true, windowId: rec.id }
    } catch (err: any) {
      console.error('[ipc] Failed to open file:', err)
      return { success: false, error: err?.message }
    }
  })

  ipcMain.handle('dialog:createFile', async (event) => {
    const result = await dialog.showSaveDialog({
      title: 'Create New File',
      defaultPath: 'untitled.cagent',
      filters: [{ name: 'CollarAgent Files', extensions: ['cagent'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const filePath = result.filePath
    try {
      // Get the window that initiated the request
      const senderWindow = BrowserWindow.fromWebContents(event.sender) || undefined

      const rec = await windowManager.openFile(filePath, senderWindow)
      await configManager.addRecentFile(filePath)
      try { app.addRecentDocument(filePath) } catch (e) { /* ignore */ }
      return { canceled: false, success: true, windowId: rec.id }
    } catch (err: any) {
      console.error('[ipc] Failed to create file:', err)
      return { canceled: false, success: false, error: err?.message }
    }
  })

  ipcMain.handle('file:getRecent', async () => {
    return configManager.getConfig().recentFiles || []
  })

  ipcMain.handle('dialog:exportWorkspace', async (event) => {
    try {
      const senderWindow = BrowserWindow.fromWebContents(event.sender) || undefined
      if (!senderWindow) return { success: false, error: 'No sender window' }
      
      const rec = windowManager.getWindowRecord(senderWindow.id)
      if (!rec) return { success: false, error: 'No active workspace found for this window' }

      const result = await dialog.showSaveDialog({
        title: 'Export Workspace Archive',
        defaultPath: rec.filePath,
        filters: [{ name: 'CollarAgent Archives', extensions: ['cagent'] }],
      })

      if (result.canceled || !result.filePath) return { canceled: true }

      // Notify the renderer that the actual export work is starting (dialog is done)
      event.sender.send('export:started')

      const { success, error } = await windowManager.exportArchive(senderWindow.id, result.filePath);

      // Notify the renderer that export finished (success or failure)
      event.sender.send('export:ended')

      return { success, error, canceled: false }
    } catch (err: any) {
      console.error('[ipc] Failed to export workspace:', err)
      event.sender.send('export:ended')
      return { success: false, error: err?.message, canceled: false }
    }
  })
}
