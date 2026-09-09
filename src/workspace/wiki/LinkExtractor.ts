import type { DocumentPayload } from '@workspace/persistence/editorContent'
import type { ClaimRelation } from '@shared/wiki'
import type { RelationalLedgerStore } from './RelationalLedgerStore'

export interface ExtractedClaimBadge {
  badgeId: string
  sourceEntityId: string
  targetEntityId: string
  rel: ClaimRelation
  justification: string
  anchorBlockId: string
}

export interface LinkExtractionResult {
  activeClaims: ExtractedClaimBadge[]
  degradedEdgeIds: string[]
  promotedOrUpsertedEdgeIds: string[]
}

/**
 * Extracts all inline claim badges from a DocumentPayload across all blocks and runs.
 */
export function extractClaimsFromDocument(
  sourceEntityId: string,
  doc: DocumentPayload
): ExtractedClaimBadge[] {
  const claims: ExtractedClaimBadge[] = []
  if (!doc?.blocks || !Array.isArray(doc.blocks)) return claims

  for (const block of doc.blocks) {
    const blockId = block.id || ''
    if (block.children && Array.isArray(block.children)) {
      for (const run of block.children) {
        if (run.claimBadge) {
          claims.push({
            badgeId: run.claimBadge.badgeId,
            sourceEntityId,
            targetEntityId: run.claimBadge.targetEntityId,
            rel: run.claimBadge.rel,
            justification: run.claimBadge.justification || '',
            anchorBlockId: blockId
          })
        }
      }
    }
  }

  return claims
}

/**
 * Synchronizes extracted document claims with the RelationalLedgerStore.
 * - Claims present in the document are upserted/promoted to provenance: 'document_claim' with status: 'active'.
 * - Previously active document_claim edges whose anchor block/badge was removed are gracefully
 *   degraded to status: 'anchor_lost' (never purged from the graph).
 */
export function syncDocumentClaimsToLedger(
  sourceEntityId: string,
  doc: DocumentPayload,
  ledgerStore: RelationalLedgerStore
): LinkExtractionResult {
  const activeClaims = extractClaimsFromDocument(sourceEntityId, doc)
  const promotedOrUpsertedEdgeIds: string[] = []
  const degradedEdgeIds: string[] = []

  // Track keys of claims currently alive in the document
  const currentClaimKeys = new Set<string>()

  for (const claim of activeClaims) {
    currentClaimKeys.add(`${claim.targetEntityId}:::${claim.rel}:::${claim.anchorBlockId}`)

    // Upsert or promote edge in the ledger
    const existing = ledgerStore.findEdge(claim.sourceEntityId, claim.targetEntityId, claim.rel)
    const now = new Date().toISOString()
    const result = ledgerStore.upsertEdge({
      id: existing?.id || crypto.randomUUID(),
      sourceEntityId: claim.sourceEntityId,
      targetEntityId: claim.targetEntityId,
      rel: claim.rel,
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: claim.anchorBlockId,
        justification: claim.justification
      },
      meta: existing?.meta
        ? { ...existing.meta, updatedAt: now }
        : {
            createdAt: now,
            updatedAt: now,
            author: 'user'
          }
    })

    promotedOrUpsertedEdgeIds.push(result.edge.id)
  }

  // Graceful degradation: Check all outlinks from sourceEntityId that were document_claim and active
  const outlinks = ledgerStore.getOutlinks(sourceEntityId)
  for (const edge of outlinks) {
    if (edge.provenance === 'document_claim' && edge.status === 'active') {
      const edgeKeyWithBlock = `${edge.targetEntityId}:::${edge.rel}:::${edge.anchor?.blockId || ''}`
      const matchesActiveClaim =
        currentClaimKeys.has(edgeKeyWithBlock) ||
        (edge.anchor?.blockId &&
          activeClaims.some(
            (c) =>
              c.targetEntityId === edge.targetEntityId &&
              c.rel === edge.rel &&
              c.anchorBlockId === edge.anchor?.blockId
          ))

      if (!matchesActiveClaim) {
        // Block or badge was removed from document! Degrade gracefully to anchor_lost
        const degraded = ledgerStore.degradeEdge(edge.id, 'anchor_lost')
        if (degraded) {
          degradedEdgeIds.push(edge.id)
        }
      }
    }
  }

  return {
    activeClaims,
    degradedEdgeIds,
    promotedOrUpsertedEdgeIds
  }
}
