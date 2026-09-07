// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  ParagraphNode,
  TextNode
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode } from '@lexical/code'
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table'
import {
  $generateNodesFromMarkdownString,
  $convertToMarkdownString,
  $convertSelectionToMarkdownString
} from '@lexical/markdown'
import { TRANSFORMERS } from '../transformers/markdown'
import { isMarkdownText, insertMarkdownNodes } from '../plugins/PasteMarkdownPlugin'
import { storeBlockId, getStoredBlockId } from '../utils/blockIdentityRegistry'
import { EquationNode } from '../nodes/EquationNode'
import { PageBreakNode } from '../nodes/PageBreakNode'
import type { RangeSelection } from 'lexical'

describe('PasteMarkdownPlugin - Regex Heuristic', () => {
  it('matches headings at start of line', () => {
    expect(isMarkdownText('# Heading 1')).toBe(true)
    expect(isMarkdownText('## Heading 2')).toBe(true)
    expect(isMarkdownText('### Heading 3')).toBe(true)
    expect(isMarkdownText('###### Heading 6')).toBe(true)
  })

  it('matches horizontal rules', () => {
    expect(isMarkdownText('---')).toBe(true)
    expect(isMarkdownText('----')).toBe(true)
  })

  it('matches code fences', () => {
    expect(isMarkdownText('```\nconst x = 1;\n```')).toBe(true)
    expect(isMarkdownText('```typescript\nconst x = 1;\n```')).toBe(true)
  })

  it('matches blockquotes', () => {
    expect(isMarkdownText('> This is a quote')).toBe(true)
  })

  it('matches unordered and ordered lists', () => {
    expect(isMarkdownText('* Bullet item')).toBe(true)
    expect(isMarkdownText('- Dash item')).toBe(true)
    expect(isMarkdownText('1. Numbered item')).toBe(true)
  })

  it('matches markdown links', () => {
    expect(isMarkdownText('Here is [a link](https://example.com) to view.')).toBe(true)
  })

  it('matches markdown tables', () => {
    expect(isMarkdownText('| Header 1 | Header 2 |\n|---|---|\n| A | B |')).toBe(true)
  })

  it('matches block and inline LaTeX equations', () => {
    expect(isMarkdownText('$$E=mc^2$$')).toBe(true)
    expect(isMarkdownText('$$\n\\frac{a}{b}\n$$')).toBe(true)
    expect(isMarkdownText('$E=mc^2$')).toBe(true)
    expect(isMarkdownText('Energy is $E=mc^2$ in physics.')).toBe(true)
  })

  it('rejects plain text and single currency symbols', () => {
    expect(isMarkdownText('Hello world, this is regular text.')).toBe(false)
    expect(isMarkdownText('The price is $50.')).toBe(false)
    expect(isMarkdownText('Costs $100 and another $200.')).toBe(false)
    expect(isMarkdownText('')).toBe(false)
  })
})

describe('PasteMarkdownPlugin - Non-Destructive Positional Insertion', () => {
  const nodes = [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    CodeNode,
    TableNode,
    TableRowNode,
    TableCellNode,
    EquationNode,
    PageBreakNode,
    ParagraphNode,
    TextNode
  ]

  function createTestEditor() {
    const rootElement = document.createElement('div')
    rootElement.contentEditable = 'true'
    document.body.appendChild(rootElement)
    const editor = createEditor({
      nodes,
      onError: (err) => {
        throw err
      }
    })
    editor.setRootElement(rootElement)
    return editor
  }

  it('inserts nodes after a block without clearing root or modifying existing block content', () => {
    const editor = createTestEditor()

    // 1. Initialize editor with two paragraphs
    editor.update(
      () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        p1.append($createTextNode('Existing Paragraph 1'))
        const p2 = $createParagraphNode()
        p2.append($createTextNode('Existing Paragraph 2'))
        root.append(p1, p2)

        storeBlockId(editor, p1.getKey(), 'block-1')
        storeBlockId(editor, p2.getKey(), 'block-2')
      },
      { discrete: true }
    )

    // 2. Simulate paste after p1
    editor.update(
      () => {
        const root = $getRoot()
        const firstP = root.getFirstChild()
        expect(firstP).not.toBeNull()
        firstP?.selectEnd()

        const markdownToPaste = '### Subheading Inserted\n\n- List Item 1\n- List Item 2'
        const generatedNodes = $generateNodesFromMarkdownString(markdownToPaste, TRANSFORMERS, true)
        expect(generatedNodes.length).toBeGreaterThan(0)

        const selection = $getSelection() as RangeSelection
        expect(selection).not.toBeNull()
        insertMarkdownNodes(generatedNodes, selection)
      },
      { discrete: true }
    )

    // 3. Verify that existing blocks were preserved and new blocks were inserted
    editor.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren()

      // Initial block 1 is intact
      const p1 = children[0]
      expect(p1.getTextContent()).toBe('Existing Paragraph 1')
      expect(getStoredBlockId(editor, p1.getKey())).toBe('block-1')

      // Last block is still p2 with its original block ID
      const lastChild = children[children.length - 1]
      expect(lastChild.getTextContent()).toBe('Existing Paragraph 2')
      expect(getStoredBlockId(editor, lastChild.getKey())).toBe('block-2')

      // Intermediate blocks contain the pasted markdown
      const totalText = root.getTextContent()
      expect(totalText).toContain('Existing Paragraph 1')
      expect(totalText).toContain('Subheading Inserted')
      expect(totalText).toContain('List Item 1')
      expect(totalText).toContain('Existing Paragraph 2')
    })
  })

  it('inserts nodes before a block when caret is at the beginning of the block', () => {
    const editor = createTestEditor()

    editor.update(
      () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        p1.append($createTextNode('Existing Paragraph 1'))
        root.append(p1)
        storeBlockId(editor, p1.getKey(), 'block-1')

        // Place caret at start of p1
        p1.selectStart()

        const markdownToPaste = '# Prepended Header'
        const generatedNodes = $generateNodesFromMarkdownString(markdownToPaste, TRANSFORMERS, true)
        const selection = $getSelection() as RangeSelection
        insertMarkdownNodes(generatedNodes, selection)
      },
      { discrete: true }
    )

    editor.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren()

      expect(children.length).toBe(2)
      // First block is the newly inserted header
      expect(children[0].getTextContent()).toBe('Prepended Header')
      // Second block is the original p1 intact with block ID
      expect(children[1].getTextContent()).toBe('Existing Paragraph 1')
      expect(getStoredBlockId(editor, children[1].getKey())).toBe('block-1')
    })
  })

  it('replaces an empty placeholder paragraph when pasting on an empty line', () => {
    const editor = createTestEditor()

    editor.update(
      () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        p1.append($createTextNode('Top Paragraph'))
        const emptyP = $createParagraphNode()
        const p2 = $createParagraphNode()
        p2.append($createTextNode('Bottom Paragraph'))
        root.append(p1, emptyP, p2)

        storeBlockId(editor, p1.getKey(), 'block-1')
        storeBlockId(editor, p2.getKey(), 'block-2')

        emptyP.select()

        const markdownToPaste = '> Quoted announcement'
        const generatedNodes = $generateNodesFromMarkdownString(markdownToPaste, TRANSFORMERS, true)
        const selection = $getSelection() as RangeSelection
        insertMarkdownNodes(generatedNodes, selection)
      },
      { discrete: true }
    )

    editor.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren()

      expect(children.length).toBe(3)
      expect(children[0].getTextContent()).toBe('Top Paragraph')
      expect(getStoredBlockId(editor, children[0].getKey())).toBe('block-1')

      expect(children[1].getTextContent()).toBe('Quoted announcement')

      expect(children[2].getTextContent()).toBe('Bottom Paragraph')
      expect(getStoredBlockId(editor, children[2].getKey())).toBe('block-2')
    })
  })
})

describe('CopyMarkdownPlugin - Selection-Aware Serialization', () => {
  const nodes = [ParagraphNode, TextNode, HeadingNode]

  function createTestEditor() {
    const rootElement = document.createElement('div')
    rootElement.contentEditable = 'true'
    document.body.appendChild(rootElement)
    const editor = createEditor({
      nodes,
      onError: (err) => {
        throw err
      }
    })
    editor.setRootElement(rootElement)
    return editor
  }

  it('serializes only the selected range when a range selection exists', () => {
    const editor = createTestEditor()

    editor.update(
      () => {
        const root = $getRoot()
        const p1 = $createParagraphNode()
        const t1 = $createTextNode('First paragraph text')
        p1.append(t1)

        const p2 = $createParagraphNode()
        const t2 = $createTextNode('Second paragraph text')
        p2.append(t2)

        root.append(p1, p2)

        // Select only p2
        t2.select(0, 'Second paragraph text'.length)
      },
      { discrete: true }
    )

    editor.getEditorState().read(() => {
      const selection = $getSelection()
      expect(selection).not.toBeNull()

      const fullMarkdown = $convertToMarkdownString(TRANSFORMERS)
      const selectedMarkdown = $convertSelectionToMarkdownString(TRANSFORMERS, selection)

      expect(fullMarkdown).toContain('First paragraph text')
      expect(fullMarkdown).toContain('Second paragraph text')

      expect(selectedMarkdown.trim()).toBe('Second paragraph text')
      expect(selectedMarkdown).not.toContain('First paragraph text')
    })
  })
})
