import 'dotenv/config'
import fixPath from 'fix-path'

// Fix PATH for macOS GUI apps
try {
  const init = typeof fixPath === 'function' ? fixPath : (fixPath as any).default;
  init?.();
} catch (e) {
  console.error("fixPath failed:", e);
}

import { app, shell, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.png?asset'
import { ConfigManager } from './config/ConfigManager'
import { SecureStorage } from './config/SecureStorage'
import { ModelManager } from './config/ModelManager'
import { applyStateToOptions, saveFromWindow } from './windowState'
import { registerConfigHandlers } from './handlers/config'
import { AgentFactory } from './agents/factory'
import { PersistenceManager } from './storage/Persistence'
import { registerAgentHandlers } from './handlers/agent'
import { registerCheckpointHandlers } from './handlers/checkpoints'
import { registerSkillsHandlers } from './handlers/skills'
import { registerFileIpc } from './files/ipc'
import windowManager from './windows/WindowManager'
// Per-window servers are started by WindowManager when opening a project

function createWindow(): void {
  // Create the browser window.
  const defaultWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 10, y: 10 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  const mainWindow = new BrowserWindow(applyStateToOptions(defaultWindowOptions))

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Persist window bounds when closed
  mainWindow.on('close', () => {
    try {
      saveFromWindow(mainWindow)
    } catch (e) {
      // ignore
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize Services
  const secureStorage = new SecureStorage();
  const modelManager = new ModelManager();
  const configManager = new ConfigManager(secureStorage, modelManager);
  const persistenceManager = new PersistenceManager(); // Persistence layer
  await persistenceManager.setup().catch(err => console.error("Failed to setup persistence:", err));

  const agentFactory = new AgentFactory(configManager, persistenceManager);

  // Initialize Chat History
  // Register Handlers
  registerConfigHandlers(configManager, modelManager);
  registerAgentHandlers(agentFactory);
  registerCheckpointHandlers(persistenceManager);
  registerSkillsHandlers(configManager);

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Register file-related IPC handlers that open/create projects
  registerFileIpc(configManager)

  // On app start show the Welcome screen (no project).
  createWindow()


  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Set up the application menu
  createMenu()

  // Set up the dock menu for macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setMenu(Menu.buildFromTemplate([
      {
        label: 'New Window',
        click() {
          createWindow()
        }
      }
    ]))
  }
})

function createMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    // { role: 'appMenu' }
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []) as MenuItemConstructorOptions[],
    // { role: 'fileMenu' }
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow()
          }
        },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    } as MenuItemConstructorOptions,
    // { role: 'editMenu' }
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' },
              { type: 'separator' },
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' },
                  { role: 'stopSpeaking' }
                ]
              }
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ])
      ]
    } as MenuItemConstructorOptions,
    // { role: 'viewMenu' }
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    } as MenuItemConstructorOptions,
    // { role: 'windowMenu' }
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ]
          : [
              { role: 'close' }
            ])
      ]
    } as MenuItemConstructorOptions,
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://electronjs.org')
          }
        }
      ]
    } as MenuItemConstructorOptions
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// macOS: open-file event when user double-clicks a document
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) {
    void windowManager.openFile(filePath)
  } else {
    app.once('ready', () => {
      void windowManager.openFile(filePath)
    })
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
