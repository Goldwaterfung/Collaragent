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
    expect(markers.length).toBe(1)
    expect(markers[0].textContent).toContain('Initial checkpoint')

    const restoreButtons = container?.querySelectorAll('button') || []
    expect(restoreButtons.length).toBeGreaterThanOrEqual(1)
    const restoreTexts = Array.from(restoreButtons).map((b) => b.textContent)
    expect(restoreTexts).toContain('Restore')
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
    expect(markers.length).toBe(0)
    expect(container?.textContent).not.toContain('Auto before restore')
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
    expect(markers.length).toBe(0)
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

  it('renders alternate branch switcher and handles branch switching (Bug 2: chronological order & enabled left chevron)', async () => {
    const onRestoreMock = vi.fn()
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3b',
        role: 'user',
        content: 'Question 2 Branch B',
        timestamp: new Date('2026-09-06T10:04:00Z')
      },
      {
        id: 'msg-4b',
        role: 'assistant',
        content: 'Answer 2 Branch B',
        timestamp: new Date('2026-09-06T10:05:00Z')
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
        id: 'cp-2a',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-4a', // Alternate branch message not in active messages
        parentBundleId: 'cp-1',
        threadId: 'thread-1',
        sessionId: 'session-1'
      },
      {
        id: 'cp-2b',
        createdAt: '2026-09-06T10:05:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-4b', // Active branch message
        parentBundleId: 'cp-1',
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

    // Active branch cp-2b (10:05:00) is chronologically after cp-2a (10:02:00),
    // so indicator must display '2 / 2' and left chevron must be enabled.
    const stepperBtn = container?.querySelector('button[aria-label="View turn branches"]')
    expect(stepperBtn).not.toBeNull()
    expect(stepperBtn?.textContent).toContain('2 / 2')

    const prevBranchBtn = container?.querySelector(
      'button[aria-label="Previous branch"]'
    ) as HTMLButtonElement
    expect(prevBranchBtn).not.toBeNull()
    expect(prevBranchBtn.disabled).toBe(false)

    const nextBranchBtn = container?.querySelector(
      'button[aria-label="Next branch"]'
    ) as HTMLButtonElement
    expect(nextBranchBtn).not.toBeNull()
    expect(nextBranchBtn.disabled).toBe(true)

    act(() => {
      prevBranchBtn.click()
    })

    // Clicking Previous Branch triggers restore of earlier alternate branch head bundle cp-2a
    expect(onRestoreMock).toHaveBeenCalledWith('cp-2a')
  })

  it('opens BranchPreviewPopover on stepper click and allows selecting an alternate branch', async () => {
    const onRestoreMock = vi.fn()
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Question 2 Active',
        timestamp: new Date('2026-09-06T10:04:00Z')
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
        id: 'cp-2-alt',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-alt-leaf',
        parentBundleId: 'cp-1',
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

    const stepperBtn = container?.querySelector(
      'button[aria-label="View turn branches"]'
    ) as HTMLButtonElement
    expect(stepperBtn).not.toBeNull()

    // Open popover
    act(() => {
      stepperBtn.click()
    })

    const popover = container?.querySelector('[role="dialog"][aria-label="Turn branches"]')
    expect(popover).not.toBeNull()

    const branchOptions = Array.from(popover?.querySelectorAll('[role="option"]') || [])
    expect(branchOptions.length).toBe(2)

    // Option 0 is cp-2-alt (10:02:00), Option 1 is active branch (10:04:00)
    expect(branchOptions[0].getAttribute('aria-selected')).toBe('false')
    expect(branchOptions[1].getAttribute('aria-selected')).toBe('true')

    // Click alternate branch option (Option 0)
    act(() => {
      ;(branchOptions[0] as HTMLButtonElement).click()
    })

    expect(onRestoreMock).toHaveBeenCalledWith('cp-2-alt')
  })

  it('Bug 1: toggles popover closed when trigger button is clicked while open', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Question 2',
        timestamp: new Date('2026-09-06T10:04:00Z')
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
        id: 'cp-2-alt',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-alt-leaf',
        parentBundleId: 'cp-1',
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

    const stepperBtn = container?.querySelector(
      'button[aria-label="View turn branches"]'
    ) as HTMLButtonElement
    expect(stepperBtn).not.toBeNull()
    expect(stepperBtn.getAttribute('aria-expanded')).toBe('false')

    // 1st click: opens popover
    act(() => {
      stepperBtn.click()
    })
    expect(stepperBtn.getAttribute('aria-expanded')).toBe('true')
    expect(container?.querySelector('[role="dialog"][aria-label="Turn branches"]')).not.toBeNull()

    // 2nd click on trigger button: must close popover without glitch
    act(() => {
      // Simulate click directly on stepperBtn while popover is open
      stepperBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      stepperBtn.click()
    })
    expect(stepperBtn.getAttribute('aria-expanded')).toBe('false')
    expect(container?.querySelector('[role="dialog"][aria-label="Turn branches"]')).toBeNull()
  })

  it('Bug 3: does not trigger full restore when clicking the already-active branch in popover', async () => {
    const onRestoreMock = vi.fn()
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Question 2',
        timestamp: new Date('2026-09-06T10:04:00Z')
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
        id: 'cp-2-alt',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-alt-leaf',
        parentBundleId: 'cp-1',
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

    const stepperBtn = container?.querySelector(
      'button[aria-label="View turn branches"]'
    ) as HTMLButtonElement

    // Open popover
    act(() => {
      stepperBtn.click()
    })

    const popover = container?.querySelector('[role="dialog"][aria-label="Turn branches"]')
    const activeOption = popover?.querySelector(
      '[role="option"][aria-selected="true"]'
    ) as HTMLButtonElement
    expect(activeOption).not.toBeNull()

    // Click active branch
    act(() => {
      activeOption.click()
    })

    // Should close popover
    expect(container?.querySelector('[role="dialog"][aria-label="Turn branches"]')).toBeNull()
    // Must NOT call restore on active branch
    expect(onRestoreMock).not.toHaveBeenCalled()
  })

  it('Bug 4: restores focus to trigger button on Escape and active branch click', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Question 1',
        timestamp: new Date('2026-09-06T10:00:00Z')
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Answer 1',
        timestamp: new Date('2026-09-06T10:00:05Z')
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Question 2',
        timestamp: new Date('2026-09-06T10:04:00Z')
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
        id: 'cp-2-alt',
        createdAt: '2026-09-06T10:02:00Z',
        label: 'Turn checkpoint',
        chatMessageId: 'msg-alt-leaf',
        parentBundleId: 'cp-1',
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

    const stepperBtn = container?.querySelector(
      'button[aria-label="View turn branches"]'
    ) as HTMLButtonElement

    // 1. Test Escape key dismissal
    act(() => {
      stepperBtn.click()
    })

    const popover = container?.querySelector('[role="dialog"][aria-label="Turn branches"]')
    expect(popover).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(container?.querySelector('[role="dialog"][aria-label="Turn branches"]')).toBeNull()
    expect(document.activeElement).toBe(stepperBtn)

    // 2. Test selecting active branch dismissal
    act(() => {
      stepperBtn.click()
    })

    const popover2 = container?.querySelector('[role="dialog"][aria-label="Turn branches"]')
    const activeOption = popover2?.querySelector(
      '[role="option"][aria-selected="true"]'
    ) as HTMLButtonElement

    act(() => {
      activeOption.click()
    })

    expect(container?.querySelector('[role="dialog"][aria-label="Turn branches"]')).toBeNull()
    expect(document.activeElement).toBe(stepperBtn)
  })

  it('allows restoring from UserMessageCard and passes current content for re-drafting', async () => {
    const onRestoreMock = vi.fn()
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Draft query to re-draft',
        timestamp: new Date('2026-09-06T10:00:00Z')
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

    const userCard = container?.querySelector('.group.relative')
    expect(userCard).not.toBeNull()

    const restoreBtn = userCard?.querySelector(
      'button[title^="Restore to this checkpoint and re-draft"]'
    ) as HTMLButtonElement
    expect(restoreBtn).not.toBeNull()

    act(() => {
      restoreBtn.click()
    })

    expect(onRestoreMock).toHaveBeenCalledWith('cp-0', 'Draft query to re-draft')
  })
})
