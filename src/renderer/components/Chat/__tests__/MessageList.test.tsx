// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageList } from '../MessageList'
import type { ChatMessage } from '../../../types/ui'
import type { CheckpointBundleSummary } from '@shared/ipc/checkpoints/types'

describe('MessageList & CheckpointMarker rendering', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    if (container) {
      container.remove()
      container = null
    }
  })

  it('renders initial checkpoint at the top and turn checkpoint under its message', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there',
        timestamp: new Date('2026-09-06T10:00:05Z')
      }
    ]

    const checkpointBundles: CheckpointBundleSummary[] = [
      {
        id: 'cp-0',
        createdAt: '2026-09-06T09:59:00Z',
        label: 'Initial checkpoint',
        chatMessageId: '__start__',
        threadId: 'thread-1',
        sessionId: 'session-1'
      },
      {
        id: 'cp-1',
        createdAt: '2026-09-06T10:00:06Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-2',
        threadId: 'thread-1',
        sessionId: 'session-1'
      }
    ]

    await act(async () => {
      root?.render(
        <MessageList
          messages={messages}
          checkpointBundles={checkpointBundles}
          onRestoreCheckpoint={vi.fn()}
        />
      )
    })

    const markers = container?.querySelectorAll('[role="separator"]') || []
    expect(markers.length).toBe(2)
    expect(markers[0].textContent).toContain('Initial checkpoint')
    expect(markers[1].textContent).toContain('Turn checkpoint')
  })

  it('filters out internal auto-restore checkpoints (reason: restore)', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there',
        timestamp: new Date('2026-09-06T10:00:05Z')
      }
    ]

    const checkpointBundles: CheckpointBundleSummary[] = [
      {
        id: 'cp-1',
        createdAt: '2026-09-06T10:00:06Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-2',
        threadId: 'thread-1',
        sessionId: 'session-1',
        reason: 'auto'
      },
      {
        id: 'cp-auto-restore',
        createdAt: '2026-09-06T10:01:00Z',
        label: 'Auto before restore',
        chatMessageId: 'msg-2',
        threadId: 'thread-1',
        sessionId: 'session-1',
        reason: 'restore'
      }
    ]

    await act(async () => {
      root?.render(
        <MessageList
          messages={messages}
          checkpointBundles={checkpointBundles}
          onRestoreCheckpoint={vi.fn()}
        />
      )
    })

    const markers = container?.querySelectorAll('[role="separator"]') || []
    // Only the turn checkpoint should be rendered, not the restore snapshot
    expect(markers.length).toBe(1)
    expect(markers[0].textContent).toContain('Turn checkpoint')
    expect(markers[0].textContent).not.toContain('Auto before restore')
  })

  it('does NOT add extra checkpoint markers after restoring to an earlier checkpoint', async () => {
    // Before restore: 4 messages (2 turns), with checkpoints at msg-2 and msg-4.
    // User restores checkpoint at msg-2:
    // Chat messages are truncated back to [msg-1, msg-2].
    // Checkpoint at msg-4 is retained in storage but its message msg-4 is gone.
    const messagesAfterRestore: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Initial request',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Initial response',
        timestamp: new Date('2026-09-06T10:00:05Z')
      }
    ]

    const checkpointBundles: CheckpointBundleSummary[] = [
      {
        id: 'cp-1',
        createdAt: '2026-09-06T10:00:06Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-2',
        threadId: 'thread-1',
        sessionId: 'session-1'
      },
      {
        id: 'cp-2',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-4', // msg-4 was truncated from messages
        threadId: 'thread-1',
        sessionId: 'session-1'
      }
    ]

    await act(async () => {
      root?.render(
        <MessageList
          messages={messagesAfterRestore}
          checkpointBundles={checkpointBundles}
          onRestoreCheckpoint={vi.fn()}
        />
      )
    })

    const markers = container?.querySelectorAll('[role="separator"]') || []
    // Only cp-1 should be rendered. cp-2 must NOT be anchored to msg-2 as an added marker!
    expect(markers.length).toBe(1)
    expect(markers[0].textContent).toContain('Turn checkpoint')
  })

  it('passes the next user message to restoreContent for re-drafting', async () => {
    const onRestoreMock = vi.fn()
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'First turn',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'First reply',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Second turn to be re-drafted',
        timestamp: new Date('2026-09-06T10:01:00Z')
      }
    ]

    const checkpointBundles: CheckpointBundleSummary[] = [
      {
        id: 'cp-1',
        createdAt: '2026-09-06T10:00:06Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-2',
        threadId: 'thread-1',
        sessionId: 'session-1'
      }
    ]

    await act(async () => {
      root?.render(
        <MessageList
          messages={messages}
          checkpointBundles={checkpointBundles}
          onRestoreCheckpoint={onRestoreMock}
        />
      )
    })

    const restoreButton = container?.querySelector('button')
    expect(restoreButton).not.toBeNull()
    expect(restoreButton?.getAttribute('title')).toContain('Second turn to be re-drafted')

    act(() => {
      restoreButton?.click()
    })

    expect(onRestoreMock).toHaveBeenCalledWith('cp-1', 'Second turn to be re-drafted')
  })
})
