import { describe, it, expect, beforeEach } from 'vitest'
import { extractClaimsFromDocument, syncDocumentClaimsToLedger } from '../LinkExtractor'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

describe('LinkExtractor & Graceful Degradation', () => {
  let store: RelationalLedgerStore

  beforeEach(() => {
    store = new RelationalLedgerStore()
  })

  it('extracts inline claim badges across blocks and runs', () => {
    const doc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-1',
          type: 'paragraph',
          children: [
            { text: 'First paragraph with ' },
            {
              text: '',
              claimBadge: {
                badgeId: 'b-1',
                targetEntityId: 'transformer',
                rel: 'details',
                justification: 'Details attention mechanism'
              }
            },
            { text: ' in prose.' }
          ]
        },
        {
          id: 'blk-2',
          type: 'h2',
          children: [{ text: 'Heading' }]
        },
        {
          id: 'blk-3',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-2',
                targetEntityId: 'rnn-baseline',
                rel: 'supersedes',
                justification: 'Outperforms sequential recurrence'
              }
            }
          ]
        }
      ]
    }

    const claims = extractClaimsFromDocument('doc-source', doc)
    expect(claims).toHaveLength(2)

    expect(claims[0]).toEqual({
      badgeId: 'b-1',
      sourceEntityId: 'doc-source',
      targetEntityId: 'transformer',
      rel: 'details',
      justification: 'Details attention mechanism',
      anchorBlockId: 'blk-1'
    })

    expect(claims[1]).toEqual({
      badgeId: 'b-2',
      sourceEntityId: 'doc-source',
      targetEntityId: 'rnn-baseline',
      rel: 'supersedes',
      justification: 'Outperforms sequential recurrence',
      anchorBlockId: 'blk-3'
    })
  })

  it('synchronizes claims to ledger and promotes edges to document_claim', () => {
    // Pre-populate a canvas_relational edge
    store.upsertEdge({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      sourceEntityId: 'doc-source',
      targetEntityId: 'transformer',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user'
      }
    })

    const doc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-10',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-10',
                targetEntityId: 'transformer',
                rel: 'details',
                justification: 'Anchored from document prose'
              }
            }
          ]
        }
      ]
    }

    const result = syncDocumentClaimsToLedger('doc-source', doc, store)
    expect(result.activeClaims).toHaveLength(1)
    expect(result.promotedOrUpsertedEdgeIds).toHaveLength(1)
    expect(result.degradedEdgeIds).toHaveLength(0)

    const edge = store.findEdge('doc-source', 'transformer', 'details')
    expect(edge).toBeDefined()
    expect(edge?.provenance).toBe('document_claim')
    expect(edge?.status).toBe('active')
    expect(edge?.anchor?.blockId).toBe('blk-10')
    expect(edge?.anchor?.justification).toBe('Anchored from document prose')
  })

  it('gracefully degrades to anchor_lost on paragraph deletion without deleting graph edge', () => {
    // Document originally has 2 claims
    const initialDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-keep',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-keep',
                targetEntityId: 'concept-keep',
                rel: 'supports',
                justification: 'Will remain'
              }
            }
          ]
        },
        {
          id: 'blk-del',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-del',
                targetEntityId: 'concept-del',
                rel: 'contradicts',
                justification: 'Will be deleted'
              }
            }
          ]
        }
      ]
    }

    syncDocumentClaimsToLedger('doc-source', initialDoc, store)
    expect(store.getAllEdges()).toHaveLength(2)

    // User deletes the second paragraph containing the 'concept-del' claim
    const updatedDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-keep',
          type: 'paragraph',
          children: [
            {
              text: '',
              claimBadge: {
                badgeId: 'b-keep',
                targetEntityId: 'concept-keep',
                rel: 'supports',
                justification: 'Will remain'
              }
            }
          ]
        }
      ]
    }

    const result = syncDocumentClaimsToLedger('doc-source', updatedDoc, store)
    expect(result.activeClaims).toHaveLength(1)
    expect(result.degradedEdgeIds).toHaveLength(1)

    // Verify knowledge edge was NOT purged
    const allEdges = store.getAllEdges()
    expect(allEdges).toHaveLength(2)

    const degradedEdge = store.findEdge('doc-source', 'concept-del', 'contradicts')
    expect(degradedEdge).toBeDefined()
    expect(degradedEdge?.status).toBe('anchor_lost')
    expect(degradedEdge?.provenance).toBe('document_claim')

    const activeEdge = store.findEdge('doc-source', 'concept-keep', 'supports')
    expect(activeEdge).toBeDefined()
    expect(activeEdge?.status).toBe('active')
  })
})
