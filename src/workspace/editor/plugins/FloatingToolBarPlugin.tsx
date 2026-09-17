import { useCallback, useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { createPortal } from 'react-dom'
import {
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND
} from 'lexical'
import ToolbarPlugin from './ToolBarPlugin'
import { INSERT_COMMENT_COMMAND } from '../utils/commands'

export interface FloatingToolBarPluginProps {
  pluginType?: 'default' | 'skill'
  isActive?: boolean
  anchorElem?: HTMLElement | null
}

export default function FloatingToolBarPlugin({
  pluginType = 'default',
  isActive = true,
  anchorElem = null
}: FloatingToolBarPluginProps) {
  const [editor] = useLexicalComposerContext()
  const [isVisible, setIsVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const rafIdRef = useRef<number | null>(null)
  const toolbarWrapRef = useRef<HTMLDivElement | null>(null)

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

  const getViewportRect = () => {
    if (typeof window === 'undefined') {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    }
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight
    }
  }

  const intersectRects = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number }
  ) => {
    const left = Math.max(a.left, b.left)
    const top = Math.max(a.top, b.top)
    const right = Math.min(a.right, b.right)
    const bottom = Math.min(a.bottom, b.bottom)
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    }
  }

  const update = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!isActive) {
      setIsVisible(false)
      return
    }

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
    }

    rafIdRef.current = window.requestAnimationFrame(() => {
      const root = editor.getRootElement()
      if (!root) {
        setIsVisible(false)
        return
      }

      // 1. Focus check: Editor root, toolbar, or dropdown must contain activeElement
      const activeElem = document.activeElement
      const isFocusedInEditor = root.contains(activeElem)
      const isFocusedInToolbar = toolbarWrapRef.current?.contains(activeElem)
      const isFocusedInDropdown =
        activeElem instanceof HTMLElement &&
        Boolean(activeElem.closest('.dropdown, .color-picker-popover, [data-lexical-dropdown]'))

      if (!isFocusedInEditor && !isFocusedInToolbar && !isFocusedInDropdown) {
        setIsVisible(false)
        return
      }

      // 2. Dual check: Lexical range selection must be non-collapsed
      let hasNonCollapsedLexicalSelection = false
      let isBackward = false
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        hasNonCollapsedLexicalSelection = $isRangeSelection(selection) && !selection.isCollapsed()
        if ($isRangeSelection(selection)) {
          isBackward = selection.isBackward()
        }
      })

      if (!hasNonCollapsedLexicalSelection) {
        setIsVisible(false)
        return
      }

      // 3. Dual check: Native DOM selection must be non-collapsed and inside root
      const nativeSelection = window.getSelection()
      if (!nativeSelection || nativeSelection.isCollapsed || nativeSelection.rangeCount === 0) {
        setIsVisible(false)
        return
      }

      const range = nativeSelection.getRangeAt(0)
      const common = range.commonAncestorContainer
      if (
        !root.contains(common) ||
        (nativeSelection.anchorNode && !root.contains(nativeSelection.anchorNode))
      ) {
        setIsVisible(false)
        return
      }

      // Anchor to the caret (selection end) so the toolbar tracks the cursor.
      const caretRange = range.cloneRange()
      caretRange.collapse(isBackward)
      const caretRect = caretRange.getBoundingClientRect()
      const fallbackRect = range.getClientRects()[0] ?? range.getBoundingClientRect()
      const clientRect = caretRect.width === 0 && caretRect.height === 0 ? fallbackRect : caretRect

      // Determine bounds for clamping (prefer the visible scroll container).
      const viewport = getViewportRect()
      const scrollViewport =
        (root.closest('.workspace__editor-scroll') as HTMLElement | null) ??
        (root.closest('.workspace-card') as HTMLElement | null) ??
        (root.closest('.ant-card') as HTMLElement | null)
      const boundsRaw = scrollViewport?.getBoundingClientRect() ?? viewport
      const bounds = intersectRects(
        {
          left: boundsRaw.left,
          top: boundsRaw.top,
          right: boundsRaw.right,
          bottom: boundsRaw.bottom
        },
        viewport
      )

      // Check if selection is visible inside the scroll container
      const isVisibleInContainer =
        clientRect.bottom >= bounds.top &&
        clientRect.top <= bounds.bottom &&
        clientRect.right >= bounds.left &&
        clientRect.left <= bounds.right

      if (!isVisibleInContainer) {
        setIsVisible(false)
        return
      }

      // Measure toolbar size (fallback to a reasonable default).
      const measured = toolbarWrapRef.current?.getBoundingClientRect()
      const toolbarWidth = measured?.width ?? 420
      const toolbarHeight = measured?.height ?? 44
      const padding = 8
      const offset = 8

      // Prefer above the caret, but flip below if it would go out of bounds.
      const preferredTop = clientRect.top - toolbarHeight - offset
      const flippedTop = clientRect.bottom + offset
      const topCandidate = preferredTop < bounds.top + padding ? flippedTop : preferredTop

      // Center horizontally around caret, but clamp within bounds.
      const leftCandidate = clientRect.left - toolbarWidth / 2
      const clampedLeft = clamp(
        leftCandidate,
        bounds.left + padding,
        bounds.right - toolbarWidth - padding
      )
      const clampedTop = clamp(
        topCandidate,
        bounds.top + padding,
        bounds.bottom - toolbarHeight - padding
      )

      setPos({ top: clampedTop, left: clampedLeft })
      setIsVisible(true)
    })
  }, [editor, isActive])

  const isVisibleRef = useRef(false)
  useEffect(() => {
    isVisibleRef.current = isVisible
  }, [isVisible])

  // Automatically dismiss if card/panel becomes inactive
  useEffect(() => {
    if (!isActive) {
      setIsVisible(false)
    }
  }, [isActive])

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  const handleFocusOut = useCallback((event: FocusEvent) => {
    const related = event.relatedTarget as Node | null
    const toolbarElem = toolbarWrapRef.current

    // If focus moved inside the toolbar itself, keep it open
    if (toolbarElem && related && toolbarElem.contains(related)) {
      return
    }

    // If focus moved inside an open dropdown or popover belonging to toolbar
    if (
      related instanceof HTMLElement &&
      Boolean(related.closest('.dropdown, .color-picker-popover, [data-lexical-dropdown]'))
    ) {
      return
    }

    setIsVisible(false)
  }, [])

  // Focusout / blur handling: dismiss toolbar unless focus moved to toolbar or its dropdowns
  useEffect(() => {
    const attach = (elem: HTMLElement | null) => {
      elem?.addEventListener('focusout', handleFocusOut)
    }
    const detach = (elem: HTMLElement | null) => {
      elem?.removeEventListener('focusout', handleFocusOut)
    }

    const currentRoot = editor.getRootElement()
    attach(currentRoot)

    const unregisterRoot = editor.registerRootListener((rootElement, prevRootElement) => {
      detach(prevRootElement)
      attach(rootElement)
    })

    return () => {
      unregisterRoot()
      detach(editor.getRootElement())
    }
  }, [editor, handleFocusOut])

  // Dismiss on pointer down outside editor and outside toolbar
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!isVisibleRef.current) return

      const target = event.target as Node | null
      const root = editor.getRootElement()
      const toolbarElem = toolbarWrapRef.current

      const isInsideRoot = root !== null && root.contains(target)
      const isInsideToolbar = toolbarElem !== null && toolbarElem.contains(target)
      const isInsideDropdown =
        target instanceof HTMLElement &&
        Boolean(target.closest('.dropdown, .color-picker-popover, [data-lexical-dropdown]'))

      if (!isInsideRoot && !isInsideToolbar && !isInsideDropdown) {
        setIsVisible(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [editor])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(() => {
        update()
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          update()
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        (payload: FocusEvent) => {
          handleFocusOut(payload)
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (isVisibleRef.current) {
            setIsVisible(false)
            editor.update(() => {
              const selection = $getSelection()
              if ($isRangeSelection(selection)) {
                selection.focus.set(
                  selection.anchor.key,
                  selection.anchor.offset,
                  selection.anchor.type
                )
              }
            })
            return true
          }
          return false
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        INSERT_COMMENT_COMMAND,
        () => {
          setIsVisible(false)
          return false
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor, update, handleFocusOut])

  useEffect(() => {
    const onScrollOrResize = () => update()
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [update])

  useEffect(() => {
    if (isVisible) {
      update()
    }
  }, [isVisible, update])

  if (!isVisible || !isActive) return null

  const targetPortal = anchorElem ?? (typeof document !== 'undefined' ? document.body : null)
  if (!targetPortal) return null

  // NOTE: Portal to document.body (or anchorElem) to avoid ancestor `backdrop-filter`/stacking contexts
  // turning `position: fixed` into a non-viewport containing block.
  return createPortal(
    <div
      ref={toolbarWrapRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 3000,
        pointerEvents: 'auto'
      }}
    >
      <ToolbarPlugin pluginType={pluginType} />
    </div>,
    targetPortal
  )
}
