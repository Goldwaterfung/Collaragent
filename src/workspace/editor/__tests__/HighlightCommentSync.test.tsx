// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { MarkNode } from '@lexical/mark'
import { PageBreakNode } from '../nodes/PageBreakNode'
import { EquationNode } from '../nodes/EquationNode'
import { InlineClaimBadgeNode } from '../nodes/InlineClaimBadgeNode'
import HighlightCommentPlugin from '../plugins/HighlightCommentPlugin'
import DocumentWebSocketSyncPlugin from '../../sync/EditorSyncPlugin'
import type { DocumentPayload } from '@workspace/persistence/editorContent'
import type { EditorCommand } from '@shared/commands'

const mockSend = vi.fn().mockResolvedValue(1)
let capturedSnapshotHandler: ((snapshot: unknown) => void) | null = null

vi.mock('@workspace/hooks/useSyncSession', () => ({
  useSyncSession: (options: {
    path: string
    onSnapshot: (snapshot: unknown) => void
    subscribeToLocal?: (handler: (cmd: EditorCommand) => void) => () => void
  }) => {
    if (options.path === 'ws/editor') {
      capturedSnapshotHandler = options.onSnapshot
      if (options.subscribeToLocal) {
        options.subscribeToLocal((cmd) => {
          mockSend(cmd)
        })
      }
      return {
        client: {
          requestSync: vi.fn(),
          rejectChanges: vi.fn(),
          acceptChanges: vi.fn(),
          send: mockSend
        },
        isApplyingRemote: () => false,
        setApplyingRemote: vi.fn()
      }
    }
    return { client: null, isApplyingRemote: () => false, setApplyingRemote: vi.fn() }
  }
}))

vi.mock('@workspace/contexts/instance/InstanceContext', () => ({
  useInstanceContext: () => ({
    instanceId: 'test-doc-1',
    instanceSummaries: [{ instanceId: 'test-doc-1', name: 'Test Document' }],
    wsPort: 1234,
    consumePendingMarkdown: vi.fn().mockReturnValue(null)
  })
}))

describe('HighlightCommentPlugin <-> EditorSyncPlugin integration', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    vi.clearAllMocks()
    capturedSnapshotHandler = null

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

  it('tests if comment edit triggers outbound sync command', async () => {
    const initialConfig = {
      namespace: 'test-editor',
      nodes: [
        HeadingNode,
        ListNode,
        ListItemNode,
        QuoteNode,
        CodeNode,
        CodeHighlightNode,
        TableNode,
        TableCellNode,
        TableRowNode,
        AutoLinkNode,
        LinkNode,
        MarkNode,
        PageBreakNode,
        EquationNode,
        InlineClaimBadgeNode
      ],
      onError: (err: Error) => {
        throw err
      }
    }

    act(() => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={<ContentEditable />}
            placeholder={<div>Enter text...</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <DocumentWebSocketSyncPlugin />
          <HighlightCommentPlugin />
        </LexicalComposer>
      )
    })

    const initialDoc: DocumentPayload = {
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          children: [{ text: 'Commented text', commentIds: ['c1'] }]
        }
      ],
      comments: {
        c1: { id: 'c1', author: 'Alice', content: 'Initial comment' }
      }
    }

    // Deliver initial snapshot
    act(() => {
      capturedSnapshotHandler?.(initialDoc)
    })

    // Look for the comment highlight element in container
    const markElem = container?.querySelector('[data-comment-id="c1"]')

    // Click mark element to open edit popover
    act(() => {
      markElem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Look for Edit button in popover
    const editBtn = document.querySelector('button[aria-label="Edit comment"]')

    act(() => {
      editBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const textarea = document.querySelector<HTMLTextAreaElement>('.comment-edit-popover textarea')

    act(() => {
      if (textarea) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set
        nativeInputValueSetter?.call(textarea, 'Updated comment text')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    const saveBtn = document.querySelector<HTMLButtonElement>(
      '.comment-edit-popover .comment-floating-save'
    )

    mockSend.mockClear()

    await act(async () => {
      saveBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 50))
    })

    console.log('mockSend calls count:', mockSend.mock.calls.length)
    for (const call of mockSend.mock.calls) {
      console.log('mockSend call:', JSON.stringify(call[0]))
    }

    expect(mockSend).toHaveBeenCalled()
    const commentUpdateCmd = mockSend.mock.calls.find(
      (c) => (c[0] as EditorCommand).type === 'editor:update_comments'
    )?.[0] as EditorCommand
    expect(commentUpdateCmd).toBeDefined()
  })
})
