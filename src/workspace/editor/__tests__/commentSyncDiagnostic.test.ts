// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createEditor, $getRoot, type LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { TableNode, TableCellNode, TableRowNode } from '@lexical/table'
import { AutoLinkNode, LinkNode } from '@lexical/link'
import { MarkNode, $isMarkNode } from '@lexical/mark'
import { $isElementNode } from 'lexical'
import { PageBreakNode } from '../nodes/PageBreakNode'
import { EquationNode } from '../nodes/EquationNode'
import { InlineClaimBadgeNode } from '../nodes/InlineClaimBadgeNode'
import { applyDocumentToEditor } from '../utils/editorContentToLexical'
import { readDocumentFromEditor } from '../utils/lexicalToEditorContent'
import { DocumentDiffEngine } from '../../../collaragent/runtime/DocumentDiffEngine'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

describe('Comment sync diagnostic', () => {
  const createTestEditor = () =>
    createEditor({
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
      ]
    })

  it('tests full comment edit lifecycle', () => {
    const editor = createTestEditor()

    const initialDoc: DocumentPayload = {
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          children: [
            {
              text: 'Hello world',
              commentIds: ['c1']
            }
          ]
        }
      ],
      comments: {
        c1: {
          id: 'c1',
          author: 'Alice',
          content: 'Original comment'
        }
      }
    }

    applyDocumentToEditor(editor, initialDoc)

    let doc1: DocumentPayload | null = null
    editor.getEditorState().read(() => {
      doc1 = readDocumentFromEditor(editor)
    })

    expect(doc1).not.toBeNull()
    console.log('Doc1 comments:', (doc1 as DocumentPayload | null)?.comments)

    // HighlightCommentPlugin decodeCommentId:
    const COMMENT_PREFIX = 'comment:'
    const decodeCommentId = (rawId: string) => {
      if (!rawId.startsWith(COMMENT_PREFIX)) return null
      const remainder = rawId.slice(COMMENT_PREFIX.length)
      const firstColonIndex = remainder.indexOf(':')
      if (firstColonIndex === -1) return null
      const id = remainder.slice(0, firstColonIndex)
      const encodedText = remainder.slice(firstColonIndex + 1)
      try {
        return { id, text: decodeURIComponent(encodedText), storageId: rawId }
      } catch {
        return { id, text: encodedText, storageId: rawId }
      }
    }

    let markIds: string[] = []
    editor.getEditorState().read(() => {
      const root = $getRoot()
      const visit = (n: LexicalNode) => {
        if ($isMarkNode(n)) {
          markIds = n.getIDs()
        }
        if ($isElementNode(n)) {
          for (const c of n.getChildren()) visit(c)
        }
      }
      visit(root)
    })

    const decoded = decodeCommentId(markIds[0])
    console.log('Decoded in HighlightCommentPlugin:', decoded)

    const encodeCommentId = (id: string, text: string) =>
      `${COMMENT_PREFIX}${id}:${encodeURIComponent(text)}`

    const previousStorageId = decoded!.storageId
    // In HighlightCommentPlugin, user edits the comment to 'Alice:Edited comment text' (or 'Edited comment text')
    const nextStorageId = encodeCommentId(decoded!.id, 'Edited comment text')

    editor.update(
      () => {
        const root = $getRoot()
        const updateMark = (node: LexicalNode) => {
          if ($isMarkNode(node) && node.hasID(previousStorageId)) {
            node.deleteID(previousStorageId)
            node.addID(nextStorageId)
          }
          if ($isElementNode(node)) {
            for (const child of node.getChildren()) {
              updateMark(child)
            }
          }
        }
        updateMark(root)
      },
      { discrete: true }
    )

    let doc2: DocumentPayload | null = null
    editor.getEditorState().read(() => {
      doc2 = readDocumentFromEditor(editor)
    })
    expect(doc2).not.toBeNull()
    console.log('Doc2 comments:', (doc2 as DocumentPayload | null)?.comments)

    const diff = DocumentDiffEngine.computeDocumentDiff(doc1!, doc2!)
    console.log('Diff:', diff)
  })
})
