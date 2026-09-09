import type { DockviewApi } from 'dockview-react'

export const GLOBAL_LAYOUT_STORAGE_KEY = 'collar:workspace:global-dockview-layout'

export const CHAT_PANEL_PREFIX = 'chat:'
export const DEFAULT_CHAT_PANEL_ID = 'chat:default'
export const CHAT_COMPONENT_NAME = 'chat'
export const DEFAULT_CHAT_TITLE = 'Chat'

export const COLLAR_OPEN_CHAT_TAB_EVENT = 'collar:open-chat-tab'
export const COLLAR_TOGGLE_CHAT_PANEL_EVENT = 'collar:toggle-chat-panel'

export function isChatPanelId(id: string): boolean {
  return id.startsWith(CHAT_PANEL_PREFIX) || id === 'collar-chat'
}

export function getSessionIdFromPanelId(panelId: string): string {
  if (panelId.startsWith(CHAT_PANEL_PREFIX)) {
    return panelId.slice(CHAT_PANEL_PREFIX.length)
  }
  return panelId
}

export function createChatPanelId(sessionId: string): string {
  return `${CHAT_PANEL_PREFIX}${sessionId}`
}

export type SerializedDockviewLayout = ReturnType<DockviewApi['toJSON']>

export interface OpenChatTabDetail {
  sessionId: string
  title?: string
}

export function hashWorkspacePath(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export function getWorkspaceLayoutStorageKey(filePath?: string | null): string {
  if (!filePath || !filePath.trim()) {
    return GLOBAL_LAYOUT_STORAGE_KEY
  }
  const normalized = filePath.trim()
  const fileName =
    normalized
      .split(/[/\\]/)
      .filter(Boolean)
      .pop()
      ?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'workspace'
  return `collar:workspace:layout:${fileName}:${hashWorkspacePath(normalized)}`
}

export function saveDockviewLayout(api: DockviewApi, filePath?: string | null): void {
  try {
    const layout = api.toJSON()
    const storageKey = getWorkspaceLayoutStorageKey(filePath)
    window.localStorage.setItem(storageKey, JSON.stringify(layout))
  } catch (error: unknown) {
    console.error('Failed to serialize Dockview layout:', error)
  }
}

export function loadDockviewLayout(filePath?: string | null): SerializedDockviewLayout | null {
  try {
    const storageKey = getWorkspaceLayoutStorageKey(filePath)
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'grid' in parsed) {
      return parsed as SerializedDockviewLayout
    }
  } catch (error: unknown) {
    console.warn('Failed to parse saved Dockview layout:', error)
  }
  return null
}

export function clearDockviewLayout(filePath?: string | null): void {
  try {
    const storageKey = getWorkspaceLayoutStorageKey(filePath)
    window.localStorage.removeItem(storageKey)
    if (!filePath) {
      window.localStorage.removeItem(GLOBAL_LAYOUT_STORAGE_KEY)
    }
  } catch (error: unknown) {
    console.error('Failed to clear saved Dockview layout:', error)
  }
}

export function emitOpenChatTab(sessionId: string, title?: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenChatTabDetail>(COLLAR_OPEN_CHAT_TAB_EVENT, {
      detail: { sessionId, title }
    })
  )
}

export function emitToggleChatPanel(): void {
  window.dispatchEvent(new CustomEvent(COLLAR_TOGGLE_CHAT_PANEL_EVENT))
}
