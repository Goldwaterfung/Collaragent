// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DockviewApi } from 'dockview-react'
import {
  saveDockviewLayout,
  loadDockviewLayout,
  clearDockviewLayout,
  emitOpenChatTab,
  emitToggleChatPanel,
  isChatPanelId,
  createChatPanelId,
  getSessionIdFromPanelId,
  GLOBAL_LAYOUT_STORAGE_KEY,
  COLLAR_OPEN_CHAT_TAB_EVENT,
  COLLAR_TOGGLE_CHAT_PANEL_EVENT
} from '../layoutPersistence'
import { useChatStore } from '../../../store/chatStore'

describe('layoutPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('saves and loads dockview layout correctly', () => {
    const mockApi = {
      toJSON: () => ({
        grid: { root: { type: 'branch', data: [] } },
        panels: {},
        activeGroup: 'group-1'
      })
    }

    saveDockviewLayout(mockApi as unknown as DockviewApi)
    const loaded = loadDockviewLayout()

    expect(loaded).toBeDefined()
    expect(loaded?.activeGroup).toBe('group-1')
  })

  it('handles invalid json or missing keys gracefully', () => {
    window.localStorage.setItem(GLOBAL_LAYOUT_STORAGE_KEY, '{ invalid json')
    expect(loadDockviewLayout()).toBeNull()

    window.localStorage.setItem(GLOBAL_LAYOUT_STORAGE_KEY, JSON.stringify({ noGrid: true }))
    expect(loadDockviewLayout()).toBeNull()
  })

  it('clears saved layout', () => {
    window.localStorage.setItem(GLOBAL_LAYOUT_STORAGE_KEY, JSON.stringify({ grid: {} }))
    clearDockviewLayout()
    expect(window.localStorage.getItem(GLOBAL_LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it('handles chat panel id helpers correctly', () => {
    expect(isChatPanelId('chat:123')).toBe(true)
    expect(isChatPanelId('collar-chat')).toBe(true)
    expect(isChatPanelId('doc-456')).toBe(false)

    expect(createChatPanelId('session-789')).toBe('chat:session-789')
    expect(getSessionIdFromPanelId('chat:session-789')).toBe('session-789')
    expect(getSessionIdFromPanelId('collar-chat')).toBe('collar-chat')
  })

  it('emits workspace events', () => {
    const openTabSpy = vi.fn()
    const toggleSpy = vi.fn()

    window.addEventListener(COLLAR_OPEN_CHAT_TAB_EVENT, openTabSpy)
    window.addEventListener(COLLAR_TOGGLE_CHAT_PANEL_EVENT, toggleSpy)

    emitOpenChatTab('session-123', 'My Chat')
    emitToggleChatPanel()

    expect(openTabSpy).toHaveBeenCalledTimes(1)
    expect((openTabSpy.mock.calls[0][0] as CustomEvent).detail).toEqual({
      sessionId: 'session-123',
      title: 'My Chat'
    })
    expect(toggleSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener(COLLAR_OPEN_CHAT_TAB_EVENT, openTabSpy)
    window.removeEventListener(COLLAR_TOGGLE_CHAT_PANEL_EVENT, toggleSpy)
  })
})

describe('chatStore multi-thread isolation', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages()
    useChatStore.setState({ messagesByThread: {}, threadId: undefined })
  })

  it('scopes messages per threadId without cross-pollution', () => {
    const store = useChatStore.getState()

    // Setup thread 1
    store.setThreadId('thread-1')
    store.addMessage({
      id: 'msg-1',
      role: 'user',
      content: 'Hello Thread 1',
      timestamp: new Date()
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello Thread 1')

    // Switch to thread 2
    useChatStore.getState().setThreadId('thread-2')
    useChatStore.getState().addMessage({
      id: 'msg-2',
      role: 'user',
      content: 'Hello Thread 2',
      timestamp: new Date()
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello Thread 2')

    // Thread 1 messages are preserved in messagesByThread
    expect(useChatStore.getState().messagesByThread['thread-1']).toHaveLength(1)
    expect(useChatStore.getState().messagesByThread['thread-1'][0].content).toBe('Hello Thread 1')

    // Switching back restores Thread 1 messages
    useChatStore.getState().setThreadId('thread-1')
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello Thread 1')
  })
})
