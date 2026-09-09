// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import DocumentWebSocketSyncPlugin from '../EditorSyncPlugin'
import CanvasWebSocketSyncPlugin from '../CanvasSyncPlugin'
import {
  COLLAR_CHECKPOINT_RESTORED_EVENT,
  type CheckpointRestoredDetail
} from '@shared/checkpoints/events'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

const mockEditorRequestSync = vi.fn()
let capturedEditorSnapshotHandler: ((snapshot: unknown) => void) | null = null

const mockCanvasRequestSync = vi.fn()

vi.mock('@workspace/hooks/useSyncSession', () => ({
  useSyncSession: (options: { path: string; onSnapshot: (snapshot: unknown) => void }) => {
    if (options.path === 'ws/editor') {
      capturedEditorSnapshotHandler = options.onSnapshot
      return {
        client: {
          requestSync: mockEditorRequestSync,
          rejectChanges: vi.fn(),
          acceptChanges: vi.fn(),
          send: vi.fn()
        },
        isApplyingRemote: () => false,
        setApplyingRemote: vi.fn()
      }
    }
    if (options.path === 'ws/canvas') {
      return {
        client: {
          requestSync: mockCanvasRequestSync,
          rejectChanges: vi.fn(),
          acceptChanges: vi.fn(),
          send: vi.fn()
        },
        isApplyingRemote: () => false,
        setApplyingRemote: vi.fn()
      }
    }
    return {
      client: null,
      isApplyingRemote: () => false,
      setApplyingRemote: vi.fn()
    }
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

const mockApplyDocumentToEditor = vi.fn()
vi.mock('../../editor/utils/editorContentToLexical', () => ({
  applyDocumentToEditor: (editor: unknown, payload: unknown, options: unknown) => {
    mockApplyDocumentToEditor(editor, payload, options)
  }
}))

let currentMockDoc: DocumentPayload = {
  blocks: [{ id: 'b0', type: 'paragraph', children: [{ text: 'Initial' }] }]
}
vi.mock('../../editor/utils/lexicalToEditorContent', () => ({
  readDocumentFromEditor: () => currentMockDoc
}))

const mockCanvasDispatch = vi.fn()
vi.mock('@workspace/canvas/store', () => ({
  useCanvas: () => ({
    dispatch: mockCanvasDispatch,
    subscribe: vi.fn().mockReturnValue(() => {})
  })
}))

vi.mock('@workspace/persistence/canvasSerialization', () => ({
  CanvasHydrationError: class extends Error {},
  deserializeCanvas: vi.fn().mockReturnValue({
    graph: { nodesById: {}, relationshipsById: {} },
    layoutByNodeId: {}
  })
}))

describe('EditorSyncPlugin & CanvasSyncPlugin Checkpoint Rehydration', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    vi.clearAllMocks()
    capturedEditorSnapshotHandler = null
    currentMockDoc = { blocks: [{ id: 'b0', type: 'paragraph', children: [{ text: 'Initial' }] }] }

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

  it('re-applies snapshot when live Lexical content differs from stale lastAppliedDocRef', () => {
    const initialConfig = {
      namespace: 'test-editor',
      onError: (err: Error) => {
        throw err
      }
    }

    act(() => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <DocumentWebSocketSyncPlugin />
        </LexicalComposer>
      )
    })

    expect(capturedEditorSnapshotHandler).not.toBeNull()

    const s0: DocumentPayload = {
      blocks: [{ id: 'b0', type: 'paragraph', children: [{ text: 'Baseline S0' }] }]
    }

    // 1. Initial snapshot S0 applied
    currentMockDoc = s0
    act(() => {
      capturedEditorSnapshotHandler?.(s0)
    })
    expect(mockApplyDocumentToEditor).toHaveBeenCalledTimes(1)
    expect(mockApplyDocumentToEditor).toHaveBeenLastCalledWith(expect.anything(), s0, {
      tag: 'sync'
    })

    // 2. Exact same snapshot S0 arrives with unchanged editor content -> deduplicated
    act(() => {
      capturedEditorSnapshotHandler?.(s0)
    })
    expect(mockApplyDocumentToEditor).toHaveBeenCalledTimes(1)

    // 3. User edits locally to S1
    const s1: DocumentPayload = {
      blocks: [{ id: 'b0', type: 'paragraph', children: [{ text: 'Dirty S1' }] }]
    }
    currentMockDoc = s1

    // 4. Checkpoint reverts to S0. Even though lastAppliedDocRef was S0,
    // because the live editor has S1, deduplication must NOT abort!
    act(() => {
      capturedEditorSnapshotHandler?.(s0)
    })
    expect(mockApplyDocumentToEditor).toHaveBeenCalledTimes(2)
    expect(mockApplyDocumentToEditor).toHaveBeenLastCalledWith(expect.anything(), s0, {
      tag: 'sync'
    })
  })

  it('triggers client.requestSync and invalidates deduplication on COLLAR_CHECKPOINT_RESTORED_EVENT', () => {
    const initialConfig = {
      namespace: 'test-editor',
      onError: (err: Error) => {
        throw err
      }
    }

    act(() => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <DocumentWebSocketSyncPlugin />
        </LexicalComposer>
      )
    })

    expect(mockEditorRequestSync).not.toHaveBeenCalled()

    // Dispatch restore event
    act(() => {
      window.dispatchEvent(
        new CustomEvent<CheckpointRestoredDetail>(COLLAR_CHECKPOINT_RESTORED_EVENT, {
          detail: {
            threadId: 'thread-1',
            bundleId: 'bundle-1',
            timestamp: Date.now()
          }
        })
      )
    })

    // EditorSyncPlugin must request fresh sync
    expect(mockEditorRequestSync).toHaveBeenCalledTimes(1)
  })

  it('triggers canvas requestSync on COLLAR_CHECKPOINT_RESTORED_EVENT', () => {
    act(() => {
      root?.render(<CanvasWebSocketSyncPlugin />)
    })

    expect(mockCanvasRequestSync).not.toHaveBeenCalled()

    // Dispatch restore event
    act(() => {
      window.dispatchEvent(
        new CustomEvent<CheckpointRestoredDetail>(COLLAR_CHECKPOINT_RESTORED_EVENT, {
          detail: {
            threadId: 'thread-1',
            bundleId: 'bundle-1',
            timestamp: Date.now()
          }
        })
      )
    })

    // CanvasSyncPlugin must request fresh sync
    expect(mockCanvasRequestSync).toHaveBeenCalledTimes(1)
  })
})
