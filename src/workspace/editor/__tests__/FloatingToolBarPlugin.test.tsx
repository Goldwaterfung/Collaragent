// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor
} from 'lexical'
import FloatingToolBarPlugin from '../plugins/FloatingToolBarPlugin'

describe('FloatingToolBarPlugin Lifecycle & Focus Management', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let editorRef: LexicalEditor | null = null

  const CaptureEditorPlugin = () => {
    const [editor] = useLexicalComposerContext()
    editorRef = editor
    return null
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    vi.clearAllMocks()
    editorRef = null

    // Mock requestAnimationFrame and cancelAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      clearTimeout(id)
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
    vi.unstubAllGlobals()
  })

  const renderEditor = (isActive = true) => {
    const initialConfig = {
      namespace: 'test-floating-toolbar',
      nodes: [],
      onError: (err: Error) => {
        throw err
      }
    }

    act(() => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <CaptureEditorPlugin />
          <RichTextPlugin
            contentEditable={<ContentEditable className="editor-input" />}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <FloatingToolBarPlugin isActive={isActive} />
        </LexicalComposer>
      )
    })
  }

  it('does not render toolbar when there is no text selection', async () => {
    renderEditor(true)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const toolbar = document.querySelector('.toolbar')
    expect(toolbar).toBeNull()
  })

  it('does not render toolbar when isActive is false', async () => {
    renderEditor(false)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const toolbar = document.querySelector('.toolbar')
    expect(toolbar).toBeNull()
  })

  it('renders toolbar when text is selected in Lexical and DOM', async () => {
    renderEditor(true)
    const editor = editorRef!
    expect(editor).toBeDefined()

    const rootElement = editor.getRootElement()!
    expect(rootElement).not.toBeNull()

    // Setup initial text node
    await act(async () => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const p = $createParagraphNode()
        const textNode = $createTextNode('Sample selectable text')
        p.append(textNode)
        root.append(p)
      })
    })

    // Mock DOM selection
    const domTextNode = rootElement.querySelector('span') ?? rootElement.firstChild?.firstChild
    expect(domTextNode).not.toBeNull()

    const mockRange = {
      commonAncestorContainer: domTextNode!,
      getClientRects: () => [
        { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 }
      ],
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 120,
        left: 50,
        right: 150,
        width: 100,
        height: 20
      }),
      cloneRange: () => ({
        collapse: vi.fn(),
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 150,
          right: 150,
          width: 0,
          height: 20
        })
      })
    }

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: domTextNode!,
      getRangeAt: () => mockRange,
      setBaseAndExtent: vi.fn(),
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    }

    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection)
    rootElement.focus()

    // Select text in Lexical
    await act(async () => {
      editor.update(() => {
        const root = $getRoot()
        const p = $createParagraphNode()
        const textNode = $createTextNode('Sample selectable text')
        p.append(textNode)
        root.append(p)
        textNode.select(0, 6)
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const toolbar = document.querySelector('.toolbar')
    expect(toolbar).not.toBeNull()
  })

  it('hides toolbar when focusout occurs to an outside element', async () => {
    renderEditor(true)
    const editor = editorRef!
    const rootElement = editor.getRootElement()!

    const domTextNode =
      rootElement.querySelector('span') ?? rootElement.firstChild?.firstChild ?? rootElement
    const mockRange = {
      commonAncestorContainer: domTextNode,
      getClientRects: () => [
        { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 }
      ],
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 120,
        left: 50,
        right: 150,
        width: 100,
        height: 20
      }),
      cloneRange: () => ({
        collapse: vi.fn(),
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 150,
          right: 150,
          width: 0,
          height: 20
        })
      })
    }
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: domTextNode,
      getRangeAt: () => mockRange,
      setBaseAndExtent: vi.fn(),
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    } as unknown as Selection)

    rootElement.focus()

    await act(async () => {
      editor.update(() => {
        const root = $getRoot()
        const p = $createParagraphNode()
        const textNode = $createTextNode('Focused text')
        p.append(textNode)
        root.append(p)
        textNode.select(0, 7)
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(document.querySelector('.toolbar')).not.toBeNull()

    // Trigger focusout with relatedTarget outside toolbar
    const outsideElement = document.createElement('button')
    document.body.appendChild(outsideElement)

    await act(async () => {
      outsideElement.focus()
      const event = new FocusEvent('focusout', {
        bubbles: true,
        relatedTarget: outsideElement
      })
      rootElement.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(document.querySelector('.toolbar')).toBeNull()
    outsideElement.remove()
  })

  it('hides toolbar when Escape key command is dispatched', async () => {
    renderEditor(true)
    const editor = editorRef!
    const rootElement = editor.getRootElement()!

    const domTextNode =
      rootElement.querySelector('span') ?? rootElement.firstChild?.firstChild ?? rootElement
    const mockRange = {
      commonAncestorContainer: domTextNode,
      getClientRects: () => [
        { top: 100, bottom: 120, left: 50, right: 150, width: 100, height: 20 }
      ],
      getBoundingClientRect: () => ({
        top: 100,
        bottom: 120,
        left: 50,
        right: 150,
        width: 100,
        height: 20
      }),
      cloneRange: () => ({
        collapse: vi.fn(),
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 150,
          right: 150,
          width: 0,
          height: 20
        })
      })
    }
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: domTextNode,
      getRangeAt: () => mockRange,
      setBaseAndExtent: vi.fn(),
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    } as unknown as Selection)

    rootElement.focus()

    await act(async () => {
      editor.update(() => {
        const root = $getRoot()
        const p = $createParagraphNode()
        const textNode = $createTextNode('Escape text')
        p.append(textNode)
        root.append(p)
        textNode.select(0, 6)
      })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(document.querySelector('.toolbar')).not.toBeNull()

    // Dispatch KEY_ESCAPE_COMMAND
    await act(async () => {
      editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(document.querySelector('.toolbar')).toBeNull()
  })
})
