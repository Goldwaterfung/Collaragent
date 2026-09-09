import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread
} from 'lexical'
import type { JSX } from 'react'
import { $applyNodeReplacement, DecoratorNode } from 'lexical'
import type { ClaimRelation } from '@shared/wiki/types'
import { ClaimRelationEnum } from '@shared/wiki/schemas'
import ClaimBadgeComponent from '../components/ClaimBadgeComponent'

export type SerializedInlineClaimBadgeNode = Spread<
  {
    badgeId: string
    targetEntityId: string
    rel: ClaimRelation
    justification: string
  },
  SerializedLexicalNode
>

function $convertClaimBadgeElement(domNode: HTMLElement): DOMConversionOutput | null {
  if (!domNode.hasAttribute('data-lexical-claim-badge')) return null
  const targetEntityId = domNode.getAttribute('data-target-entity') || ''
  const relAttr = domNode.getAttribute('data-rel') || 'relates_to'
  const parsedRel = ClaimRelationEnum.safeParse(relAttr)
  const rel: ClaimRelation = parsedRel.success ? parsedRel.data : 'relates_to'
  const justification = domNode.getAttribute('data-justification') || ''
  const badgeId = domNode.getAttribute('data-badge-id') || undefined
  const node = $createInlineClaimBadgeNode(targetEntityId, rel, justification, badgeId)
  return { node }
}

export class InlineClaimBadgeNode extends DecoratorNode<JSX.Element> {
  __badgeId: string
  __targetEntityId: string
  __rel: ClaimRelation
  __justification: string

  static getType(): string {
    return 'inline-claim-badge'
  }

  static clone(node: InlineClaimBadgeNode): InlineClaimBadgeNode {
    return new InlineClaimBadgeNode(
      node.__targetEntityId,
      node.__rel,
      node.__justification,
      node.__badgeId,
      node.__key
    )
  }

  constructor(
    targetEntityId: string,
    rel: ClaimRelation,
    justification = '',
    badgeId?: string,
    key?: NodeKey
  ) {
    super(key)
    this.__targetEntityId = targetEntityId
    this.__rel = rel
    this.__justification = justification
    this.__badgeId = badgeId || globalThis.crypto?.randomUUID?.() || `badge-${Date.now()}`
  }

  static importJSON(serializedNode: SerializedInlineClaimBadgeNode): InlineClaimBadgeNode {
    const parsedRel = ClaimRelationEnum.safeParse(serializedNode.rel)
    const rel: ClaimRelation = parsedRel.success ? parsedRel.data : 'relates_to'
    return $createInlineClaimBadgeNode(
      serializedNode.targetEntityId,
      rel,
      serializedNode.justification,
      serializedNode.badgeId
    )
  }

  exportJSON(): SerializedInlineClaimBadgeNode {
    return {
      type: 'inline-claim-badge',
      version: 1,
      badgeId: this.__badgeId,
      targetEntityId: this.__targetEntityId,
      rel: this.__rel,
      justification: this.__justification
    }
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.className = 'inline-claim-badge-container inline-block align-baseline'
    element.setAttribute('data-lexical-claim-badge', 'true')
    element.setAttribute('data-badge-id', this.__badgeId)
    element.setAttribute('data-target-entity', this.__targetEntityId)
    element.setAttribute('data-rel', this.__rel)
    element.setAttribute('data-justification', this.__justification)
    return element
  }

  updateDOM(prevNode: this, dom: HTMLElement): boolean {
    if (
      prevNode.__targetEntityId !== this.__targetEntityId ||
      prevNode.__rel !== this.__rel ||
      prevNode.__justification !== this.__justification ||
      prevNode.__badgeId !== this.__badgeId
    ) {
      dom.setAttribute('data-badge-id', this.__badgeId)
      dom.setAttribute('data-target-entity', this.__targetEntityId)
      dom.setAttribute('data-rel', this.__rel)
      dom.setAttribute('data-justification', this.__justification)
    }
    return false
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.setAttribute('data-lexical-claim-badge', 'true')
    element.setAttribute('data-badge-id', this.__badgeId)
    element.setAttribute('data-target-entity', this.__targetEntityId)
    element.setAttribute('data-rel', this.__rel)
    element.setAttribute('data-justification', this.__justification)
    element.className = 'inline-claim-badge'
    element.textContent = `⚡ ${this.__rel}: ${this.__targetEntityId}`
    return { element }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-claim-badge')) return null
        return {
          conversion: $convertClaimBadgeElement,
          priority: 2
        }
      }
    }
  }

  isInline(): boolean {
    return true
  }

  getTextContent(): string {
    return this.__justification
      ? `[[${this.__rel}:${this.__targetEntityId}|${this.__justification}]]`
      : `[[${this.__rel}:${this.__targetEntityId}]]`
  }

  getBadgeId(): string {
    return this.__badgeId
  }

  getTargetEntityId(): string {
    return this.__targetEntityId
  }

  getRel(): ClaimRelation {
    return this.__rel
  }

  getJustification(): string {
    return this.__justification
  }

  setTargetEntityId(targetEntityId: string): void {
    const writable = this.getWritable()
    writable.__targetEntityId = targetEntityId
  }

  setRel(rel: ClaimRelation): void {
    const writable = this.getWritable()
    writable.__rel = rel
  }

  setJustification(justification: string): void {
    const writable = this.getWritable()
    writable.__justification = justification
  }

  decorate(): JSX.Element {
    return (
      <ClaimBadgeComponent
        badgeId={this.__badgeId}
        targetEntityId={this.__targetEntityId}
        rel={this.__rel}
        justification={this.__justification}
        nodeKey={this.__key}
      />
    )
  }
}

export function $createInlineClaimBadgeNode(
  targetEntityId: string,
  rel: ClaimRelation,
  justification = '',
  badgeId?: string
): InlineClaimBadgeNode {
  const badgeNode = new InlineClaimBadgeNode(targetEntityId, rel, justification, badgeId)
  return $applyNodeReplacement(badgeNode)
}

export function $isInlineClaimBadgeNode(
  node: LexicalNode | null | undefined
): node is InlineClaimBadgeNode {
  return node instanceof InlineClaimBadgeNode
}
