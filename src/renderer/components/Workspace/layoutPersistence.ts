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

export function saveDockviewLayout(api: DockviewApi): void {
  try {
    const layout = api.toJSON()
    window.localStorage.setItem(GLOBAL_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch (error: unknown) {
    console.error('Failed to serialize Dockview layout:', error)
  }
}

export function loadDockviewLayout(): SerializedDockviewLayout | null {
  try {
    const raw = window.localStorage.getItem(GLOBAL_LAYOUT_STORAGE_KEY)
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

export function clearDockviewLayout(): void {
  try {
    window.localStorage.removeItem(GLOBAL_LAYOUT_STORAGE_KEY)
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
