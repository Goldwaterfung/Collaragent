import type { TextMatchTransformer } from '@lexical/markdown'
import {
  $createInlineClaimBadgeNode,
  $isInlineClaimBadgeNode,
  InlineClaimBadgeNode
} from '../../nodes/InlineClaimBadgeNode'
import { ClaimRelationEnum } from '@shared/wiki/schemas'

const CLAIM_BADGE_IMPORT_REGEXP =
  /\[\[(supports|contradicts|supersedes|details|derived_from|cites|relates_to):([^\]|]+)(?:\|([^\]]+))?\]\]/

const CLAIM_BADGE_REGEXP =
  /\[\[(supports|contradicts|supersedes|details|derived_from|cites|relates_to):([^\]|]+)(?:\|([^\]]+))?\]\]$/

export const CLAIM_BADGE_TRANSFORMER: TextMatchTransformer = {
  dependencies: [InlineClaimBadgeNode],
  export: (node) => {
    if (!$isInlineClaimBadgeNode(node)) return null
    const justification = node.getJustification()
    const target = node.getTargetEntityId()
    const rel = node.getRel()
    return justification ? `[[${rel}:${target}|${justification}]]` : `[[${rel}:${target}]]`
  },
  importRegExp: CLAIM_BADGE_IMPORT_REGEXP,
  regExp: CLAIM_BADGE_REGEXP,
  replace: (textNode, match) => {
    const [, relStr, targetEntityId, justification = ''] = match
    const relParsed = ClaimRelationEnum.safeParse(relStr)
    if (!relParsed.success) return
    const badgeNode = $createInlineClaimBadgeNode(
      targetEntityId.trim(),
      relParsed.data,
      justification.trim()
    )
    textNode.replace(badgeNode)
  },
  trigger: ']',
  type: 'text-match'
}
