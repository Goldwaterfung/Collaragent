import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $generateNodesFromMarkdownString } from '@lexical/markdown'
import { TRANSFORMERS } from '../transformers/markdown'
import {
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isDecoratorNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type ElementNode,
  type LexicalNode,
  type PasteCommandType,
  type RangeSelection
} from 'lexical'

/**
 * Heuristic regex to detect Markdown-like content.
 * Matches headers (#..######), horizontal rules (---), code fences (```),
 * blockquotes (>), unordered lists (*, -), ordered lists (1.), links ([text](url)),
 * tables (| col |), block math ($$...$$), and inline math ($...$).
 * Single dollar signs (e.g. $50) are excluded to prevent treating currency as equations.
 */
export const MARKDOWN_TEST_REGEX =
  /(^#{1,6}\s)|(^-{3,}$)|(^```)|(^>\s)|(^[\*\-]\s)|(^\d+\.\s)|(\[[^\]]+\]\([^)]+\))|(^\|.*\|)|(?:\$\$[\s\S]+?\$\$)|(?:\$(?!\s)[^$\n]+(?<!\s)\$)/m

export function isMarkdownText(text: string): boolean {
  return MARKDOWN_TEST_REGEX.test(text)
}

/**
 * Inserts parsed Markdown nodes into the document tree at the position
 * indicated by the selection.
 *
 * When pasting block-level nodes:
 * - If on an empty block: replaces the empty placeholder block.
 * - If at the start of a block: inserts cleanly BEFORE the block.
 * - If at the end of a block: inserts cleanly AFTER the block.
 * - Otherwise: uses Lexical's $insertNodes for standard inline/split insertion.
 */
export function insertMarkdownNodes(nodes: LexicalNode[], selection: RangeSelection): void {
  if (nodes.length === 0) return

  const hasBlockNodes = nodes.some(
    (node) => ($isElementNode(node) || $isDecoratorNode(node)) && !node.isInline()
  )

  if (hasBlockNodes && selection.isCollapsed()) {
    const anchor = selection.anchor
    const anchorNode = anchor.getNode()

    // Find the top-level block ancestor under the Root node
    let topBlock: ElementNode | null = null
    let curr: LexicalNode | null = anchorNode
    while (curr !== null) {
      const parent = curr.getParent()
      if (parent !== null && $isRootOrShadowRoot(parent)) {
        if ($isElementNode(curr)) {
          topBlock = curr
        }
        break
      }
      curr = parent
    }

    if (topBlock) {
      // 1. If the current block is empty (e.g. empty line between blocks), replace it
      if (topBlock.isEmpty()) {
        for (const node of nodes) {
          topBlock.insertBefore(node)
        }
        topBlock.remove()
        nodes[nodes.length - 1].selectEnd()
        return
      }

      // 2. If caret is at the beginning of the block (pasting BEFORE the block)
      const firstDescendant = topBlock.getFirstDescendant()
      const isAtStart =
        (anchorNode === topBlock && anchor.offset === 0) ||
        (anchorNode === firstDescendant && anchor.offset === 0)

      if (isAtStart) {
        for (const node of nodes) {
          topBlock.insertBefore(node)
        }
        nodes[nodes.length - 1].selectEnd()
        return
      }

      // 3. If caret is at the end of the block (pasting AFTER the block)
      const lastDescendant = topBlock.getLastDescendant()
      const isAtEnd =
        (anchorNode === topBlock && anchor.offset === topBlock.getChildrenSize()) ||
        (anchorNode === lastDescendant && anchor.offset === anchorNode.getTextContentSize())

      if (isAtEnd) {
        let prev: LexicalNode = topBlock
        for (const node of nodes) {
          prev.insertAfter(node)
          prev = node
        }
        nodes[nodes.length - 1].selectEnd()
        return
      }
    }
  }

  // Standard fallback
  $insertNodes(nodes)
}

/**
 * Intercepts paste events in the editor and, when the pasted text looks like
 * Markdown, parses the markdown non-destructively into Lexical nodes and
 * inserts them at the current cursor / selection position rather than
 * replacing the entire document.
 */
export default function PasteMarkdownPlugin(): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (e: PasteCommandType) => {
        // Let inputs/textareas handle their own paste (e.g. equation editor).
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return false
        }

        const clipboardData = 'clipboardData' in e && e.clipboardData ? e.clipboardData : null
        const text = clipboardData?.getData('text/plain')
        if (!text) return false

        if (!isMarkdownText(text)) {
          return false
        }

        e.preventDefault()

        editor.update(() => {
          const selection = $getSelection()
          if (!selection) return

          // Parse markdown into nodes non-destructively without clearing the root.
          const nodes = $generateNodesFromMarkdownString(text, TRANSFORMERS, true)
          if (nodes.length === 0) return

          if ($isRangeSelection(selection)) {
            insertMarkdownNodes(nodes, selection)
          } else {
            $insertNodes(nodes)
          }
        })

        return true
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor])

  return null
}
