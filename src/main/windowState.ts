import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'

type Bounds = {
  x?: number
  y?: number
  width?: number
  height?: number
}

const STATE_FILE = path.join(app.getPath('home'), '.collaragent', 'window-state.json')

function ensureDir() {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function loadWindowState(): Bounds | undefined {
  try {
    if (!fs.existsSync(STATE_FILE)) return undefined
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(raw) as Bounds
  } catch (e) {
    console.error('Failed to load window state:', e)
    return undefined
  }
}

export function saveWindowState(bounds: Bounds): void {
  try {
    ensureDir()
    fs.writeFileSync(STATE_FILE, JSON.stringify(bounds, null, 2))
  } catch (e) {
    console.error('Failed to save window state:', e)
  }
}

export function applyStateToOptions(opts: Electron.BrowserWindowConstructorOptions): Electron.BrowserWindowConstructorOptions {
  const state = loadWindowState()
  if (!state) return opts
  const copy = { ...opts }
  if (state.width) copy.width = state.width
  if (state.height) copy.height = state.height
  if (typeof state.x === 'number') copy.x = state.x
  if (typeof state.y === 'number') copy.y = state.y
  return copy
}

export function saveFromWindow(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    saveWindowState(bounds)
  } catch (e) {
    console.error('Failed to save window bounds from window:', e)
  }
}
