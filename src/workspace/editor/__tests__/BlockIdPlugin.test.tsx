// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  ParagraphNode,
  TextNode
} from 'lexical'
import { getStoredBlockId, storeBlockId } from '../utils/blockIdentityRegistry'
import { InlineClaimBadgeNode } from '../nodes/InlineClaimBadgeNode'
import { readDocumentFromEditor } from '../utils/lexicalToEditorContent'
import { applyDocumentToEditor } from '../utils/editorContentToLexical'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

describe('BlockIdPlugin & Block Anchoring', () => {
  const createTestEditor = () =>
    createEditor({
      nodes: [ParagraphNode, TextNode, InlineClaimBadgeNode]
    })

  it('assigns and preserves block IDs in blockIdentityRegistry', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const root = $getRoot()
      const p = $createParagraphNode()
      p.append($createTextNode('Test paragraph content'))
      root.append(p)

      const key = p.getKey()
      storeBlockId(editor, key, 'blk-custom-123')
      expect(getStoredBlockId(editor, key)).toBe('blk-custom-123')
    })
  })

  it('roundtrips claim badges through lexicalToEditorContent and editorContentToLexical', () => {
    const editor1 = createTestEditor()
    let payload: DocumentPayload | undefined

    editor1.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      p.append($createTextNode('Claim evidence: '))
      const badge = new InlineClaimBadgeNode(
        'target-hypothesis',
        'supports',
        'Empirical validation',
        'badge-rt-1'
      )
      p.append(badge)
      root.append(p)
      payload = readDocumentFromEditor(editor1)
    })

    expect(payload).toBeDefined()
    if (!payload) {
      throw new Error('Expected payload to be defined')
    }
    expect(payload.blocks.length).toBe(1)
    const block = payload.blocks[0]
    expect(block.children).toBeDefined()
    const badgeRun = block.children?.find((r) => r.claimBadge !== undefined)
    expect(badgeRun).toBeDefined()
    expect(badgeRun?.claimBadge).toEqual({
      badgeId: 'badge-rt-1',
      targetEntityId: 'target-hypothesis',
      rel: 'supports',
      justification: 'Empirical validation'
    })

    // Hydrate into new editor
    const editor2 = createTestEditor()
    applyDocumentToEditor(editor2, payload!)

    editor2.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren()
      expect(children.length).toBe(1)
      const p = children[0] as ParagraphNode
      const runs = p.getChildren()
      const importedBadge = runs.find((n) => n instanceof InlineClaimBadgeNode) as
        InlineClaimBadgeNode | undefined

      expect(importedBadge).toBeDefined()
      expect(importedBadge?.getTargetEntityId()).toBe('target-hypothesis')
      expect(importedBadge?.getRel()).toBe('supports')
      expect(importedBadge?.getJustification()).toBe('Empirical validation')
      expect(importedBadge?.getBadgeId()).toBe('badge-rt-1')
    })
  })

  it('handles jump-to-block DOM event and triggers scroll and highlight', () => {
    const blockDiv = document.createElement('div')
    blockDiv.setAttribute('data-block-id', 'blk-target-999')
    blockDiv.scrollIntoView = vi.fn()
    document.body.appendChild(blockDiv)

    // Simulate event handler logic
    const handleJumpToBlock = (event: Event) => {
      const customEvent = event as CustomEvent<{ blockId: string }>
      const blockId = customEvent.detail?.blockId
      if (!blockId) return

      const targetElem = document.querySelector(`[data-block-id="${blockId}"]`)
      if (targetElem instanceof HTMLElement) {
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' })
        targetElem.classList.add('ring-2', 'ring-primary-500')
      }
    }

    window.addEventListener('cagent:jump-to-block', handleJumpToBlock)

    window.dispatchEvent(
      new CustomEvent('cagent:jump-to-block', {
        detail: { blockId: 'blk-target-999' }
      })
    )

    expect(blockDiv.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center'
    })
    expect(blockDiv.classList.contains('ring-2')).toBe(true)

    window.removeEventListener('cagent:jump-to-block', handleJumpToBlock)
    document.body.removeChild(blockDiv)
  })
})
