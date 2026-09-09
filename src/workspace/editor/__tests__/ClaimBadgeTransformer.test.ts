// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $isParagraphNode,
  ParagraphNode,
  TextNode
} from 'lexical'
import { $generateNodesFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown'
import { TRANSFORMERS } from '../transformers/markdown'
import {
  $createInlineClaimBadgeNode,
  $isInlineClaimBadgeNode,
  InlineClaimBadgeNode
} from '../nodes/InlineClaimBadgeNode'

describe('ClaimBadgeTransformer', () => {
  const createTestEditor = () =>
    createEditor({
      nodes: [ParagraphNode, TextNode, InlineClaimBadgeNode]
    })

  it('imports markdown shortcut with relation and justification', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const markdown =
        'This mechanism is foundational [[details:transformer-architecture|Explains parallel attention subspaces]].'
      const nodes = $generateNodesFromMarkdownString(markdown, TRANSFORMERS)

      expect(nodes.length).toBeGreaterThan(0)
      const paragraph = nodes[0]
      expect($isParagraphNode(paragraph)).toBe(true)

      if ($isParagraphNode(paragraph)) {
        const children = paragraph.getChildren()
        const badgeNode = children.find($isInlineClaimBadgeNode)

        expect(badgeNode).toBeDefined()
        if ($isInlineClaimBadgeNode(badgeNode)) {
          expect(badgeNode.getTargetEntityId()).toBe('transformer-architecture')
          expect(badgeNode.getRel()).toBe('details')
          expect(badgeNode.getJustification()).toBe('Explains parallel attention subspaces')
        }
      }
    })
  })

  it('imports markdown shortcut without justification', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const markdown = 'We build upon [[supports:Attention Is All You Need]] directly.'
      const nodes = $generateNodesFromMarkdownString(markdown, TRANSFORMERS)

      expect(nodes.length).toBeGreaterThan(0)
      const paragraph = nodes[0]
      expect($isParagraphNode(paragraph)).toBe(true)

      if ($isParagraphNode(paragraph)) {
        const children = paragraph.getChildren()
        const badgeNode = children.find($isInlineClaimBadgeNode)

        expect(badgeNode).toBeDefined()
        if ($isInlineClaimBadgeNode(badgeNode)) {
          expect(badgeNode.getTargetEntityId()).toBe('Attention Is All You Need')
          expect(badgeNode.getRel()).toBe('supports')
          expect(badgeNode.getJustification()).toBe('')
        }
      }
    })
  })

  it('exports InlineClaimBadgeNode to markdown string', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const p1 = $createParagraphNode()
      const badgeWithJustification = $createInlineClaimBadgeNode(
        'target-concept',
        'contradicts',
        'Counterexample discovered'
      )
      p1.append(badgeWithJustification)
      root.append(p1)

      const exportedWithJust = $convertToMarkdownString(TRANSFORMERS)
      expect(exportedWithJust).toContain('[[contradicts:target-concept|Counterexample discovered]]')

      root.clear()
      const p2 = $createParagraphNode()
      const badgeWithoutJustification = $createInlineClaimBadgeNode('source-paper', 'cites')
      p2.append(badgeWithoutJustification)
      root.append(p2)

      const exportedWithoutJust = $convertToMarkdownString(TRANSFORMERS)
      expect(exportedWithoutJust).toContain('[[cites:source-paper]]')
    })
  })

  it('performs lossless markdown roundtrip', () => {
    const editor = createTestEditor()
    const originalMarkdown =
      'Key insight [[supersedes:legacy-rnn|Better parallelization across sequences]] achieved.'

    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const nodes = $generateNodesFromMarkdownString(originalMarkdown, TRANSFORMERS)
      nodes.forEach((node) => root.append(node))

      const exported = $convertToMarkdownString(TRANSFORMERS)
      expect(exported.trim()).toBe(originalMarkdown.trim())
    })
  })
})
