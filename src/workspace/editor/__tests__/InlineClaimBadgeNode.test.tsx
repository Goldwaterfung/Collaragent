// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createEditor } from 'lexical'
import {
  $createInlineClaimBadgeNode,
  $isInlineClaimBadgeNode,
  InlineClaimBadgeNode,
  type SerializedInlineClaimBadgeNode
} from '../nodes/InlineClaimBadgeNode'

describe('InlineClaimBadgeNode', () => {
  const createTestEditor = () =>
    createEditor({
      nodes: [InlineClaimBadgeNode]
    })

  it('creates an InlineClaimBadgeNode with proper properties', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const node = $createInlineClaimBadgeNode(
        'transformer-architecture',
        'details',
        'Explains parallel attention subspaces',
        'test-badge-1'
      )

      expect($isInlineClaimBadgeNode(node)).toBe(true)
      expect(node.getType()).toBe('inline-claim-badge')
      expect(node.getTargetEntityId()).toBe('transformer-architecture')
      expect(node.getRel()).toBe('details')
      expect(node.getJustification()).toBe('Explains parallel attention subspaces')
      expect(node.getBadgeId()).toBe('test-badge-1')
      expect(node.isInline()).toBe(true)
      expect(node.getTextContent()).toBe(
        '[[details:transformer-architecture|Explains parallel attention subspaces]]'
      )
    })
  })

  it('updates properties via setters', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const node = $createInlineClaimBadgeNode('entity-a', 'relates_to')
      expect(node.getRel()).toBe('relates_to')
      expect(node.getJustification()).toBe('')

      node.setTargetEntityId('entity-b')
      node.setRel('supports')
      node.setJustification('Empirical benchmark verification')

      expect(node.getTargetEntityId()).toBe('entity-b')
      expect(node.getRel()).toBe('supports')
      expect(node.getJustification()).toBe('Empirical benchmark verification')
      expect(node.getTextContent()).toBe('[[supports:entity-b|Empirical benchmark verification]]')
    })
  })

  it('clones an InlineClaimBadgeNode correctly', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const original = $createInlineClaimBadgeNode(
        'attention-head',
        'derived_from',
        'Derived from self-attention mechanism',
        'badge-clone-id'
      )

      const cloned = InlineClaimBadgeNode.clone(original)
      expect(cloned.getTargetEntityId()).toBe('attention-head')
      expect(cloned.getRel()).toBe('derived_from')
      expect(cloned.getJustification()).toBe('Derived from self-attention mechanism')
      expect(cloned.getBadgeId()).toBe('badge-clone-id')
    })
  })

  it('exports and imports JSON cleanly', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const original = $createInlineClaimBadgeNode(
        'target-node-99',
        'contradicts',
        'Incompatible with single-head design',
        'json-badge-id'
      )

      const json = original.exportJSON()
      expect(json.type).toBe('inline-claim-badge')
      expect(json.targetEntityId).toBe('target-node-99')
      expect(json.rel).toBe('contradicts')
      expect(json.justification).toBe('Incompatible with single-head design')
      expect(json.badgeId).toBe('json-badge-id')

      const imported = InlineClaimBadgeNode.importJSON(json as SerializedInlineClaimBadgeNode)
      expect($isInlineClaimBadgeNode(imported)).toBe(true)
      expect(imported.getTargetEntityId()).toBe('target-node-99')
      expect(imported.getRel()).toBe('contradicts')
      expect(imported.getJustification()).toBe('Incompatible with single-head design')
      expect(imported.getBadgeId()).toBe('json-badge-id')
    })
  })

  it('exports and imports DOM elements faithfully', () => {
    const editor = createTestEditor()
    editor.update(() => {
      const node = $createInlineClaimBadgeNode(
        'target-entity-x',
        'cites',
        'Reference paper citation',
        'badge-dom-id'
      )

      const domOutput = node.exportDOM()
      expect(domOutput.element instanceof HTMLElement).toBe(true)
      if (!(domOutput.element instanceof HTMLElement)) {
        throw new Error('Expected HTMLElement')
      }
      const element = domOutput.element
      expect(element.getAttribute('data-lexical-claim-badge')).toBe('true')
      expect(element.getAttribute('data-badge-id')).toBe('badge-dom-id')
      expect(element.getAttribute('data-target-entity')).toBe('target-entity-x')
      expect(element.getAttribute('data-rel')).toBe('cites')
      expect(element.getAttribute('data-justification')).toBe('Reference paper citation')
      expect(element.textContent).toBe('⚡ cites: target-entity-x')

      const domImport = InlineClaimBadgeNode.importDOM()
      expect(domImport).not.toBeNull()
      const spanConverter = domImport?.span(element)
      expect(spanConverter).not.toBeNull()
      const conversionResult = spanConverter?.conversion(element)
      expect(conversionResult).toBeDefined()
      const rawImportedNode = conversionResult?.node
      const importedNode = Array.isArray(rawImportedNode) ? rawImportedNode[0] : rawImportedNode
      expect($isInlineClaimBadgeNode(importedNode)).toBe(true)
      if (!$isInlineClaimBadgeNode(importedNode)) {
        throw new Error('Expected InlineClaimBadgeNode')
      }
      expect(importedNode.getTargetEntityId()).toBe('target-entity-x')
      expect(importedNode.getRel()).toBe('cites')
      expect(importedNode.getJustification()).toBe('Reference paper citation')
      expect(importedNode.getBadgeId()).toBe('badge-dom-id')
    })
  })
})
