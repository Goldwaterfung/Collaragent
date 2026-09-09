import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import '../RelationalLedgerStorage'
import { WorkspaceErrorCode, WorkspaceError } from '@shared/errors/WorkspaceErrors'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('RelationalLedgerStore', () => {
  let store: RelationalLedgerStore
  let tempDir: string

  beforeEach(async () => {
    store = new RelationalLedgerStore()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collar-ledger-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('inserts and indexes new edges with O(1) outlink and backlink lookups', () => {
    const edge1 = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      sourceEntityId: 'transformer',
      targetEntityId: 'attention',
      rel: 'details' as const,
      provenance: 'canvas_relational' as const,
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent' as const
      }
    }

    const edge2 = {
      id: '550e8400-e29b-41d4-a716-446655440002',
      sourceEntityId: 'bert',
      targetEntityId: 'transformer',
      rel: 'derived_from' as const,
      provenance: 'document_claim' as const,
      anchor: {
        blockId: 'blk_01',
        justification: 'BERT uses Transformer encoder stack'
      },
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user' as const
      }
    }

    const res1 = store.upsertEdge(edge1)
    expect(res1.created).toBe(true)
    expect(res1.edge.id).toBe(edge1.id)

    const res2 = store.upsertEdge(edge2)
    expect(res2.created).toBe(true)

    // Outlinks from 'transformer'
    const outlinks = store.getOutlinks('transformer')
    expect(outlinks.length).toBe(1)
    expect(outlinks[0].targetEntityId).toBe('attention')

    // Backlinks to 'transformer'
    const backlinks = store.getBacklinks('transformer')
    expect(backlinks.length).toBe(1)
    expect(backlinks[0].sourceEntityId).toBe('bert')

    // Total edges
    expect(store.getAllEdges().length).toBe(2)
  })

  it('promotes canvas_relational edge to document_claim in-place upon duplicate claim', () => {
    const canvasEdge = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      sourceEntityId: 'CNN',
      targetEntityId: 'ViT',
      rel: 'supersedes' as const,
      provenance: 'canvas_relational' as const,
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent' as const
      }
    }
    store.upsertEdge(canvasEdge)

    // Later: Prose crystallization adds document_claim for identical (source, target, rel)
    const claimEdge = {
      id: '550e8400-e29b-41d4-a716-446655440011', // different candidate UUID
      sourceEntityId: 'CNN',
      targetEntityId: 'ViT',
      rel: 'supersedes' as const,
      provenance: 'document_claim' as const,
      anchor: {
        blockId: 'blk_99',
        justification: 'Vision Transformers outperform CNN on ImageNet'
      },
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T01:00:00.000Z',
        updatedAt: '2026-09-08T01:00:00.000Z',
        author: 'user' as const
      }
    }

    const result = store.upsertEdge(claimEdge)
    expect(result.created).toBe(false)
    expect(result.previous?.provenance).toBe('canvas_relational')
    expect(result.edge.id).toBe(canvasEdge.id) // Preserves original edge UUID!
    expect(result.edge.provenance).toBe('document_claim')
    expect(result.edge.anchor?.blockId).toBe('blk_99')
    expect(store.getAllEdges().length).toBe(1) // No duplicate parallel edge
  })

  it('handles edge removal and cleans up index maps', () => {
    const edge = {
      id: '550e8400-e29b-41d4-a716-446655440020',
      sourceEntityId: 'A',
      targetEntityId: 'B',
      rel: 'supports' as const,
      provenance: 'canvas_relational' as const,
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent' as const
      }
    }
    store.upsertEdge(edge)
    expect(store.getOutlinks('A').length).toBe(1)

    const removed = store.removeEdge(edge.id)
    expect(removed).toBeDefined()
    expect(removed?.id).toBe(edge.id)

    expect(store.getEdge(edge.id)).toBeUndefined()
    expect(store.getOutlinks('A').length).toBe(0)
    expect(store.getBacklinks('B').length).toBe(0)
  })

  it('degrades anchored edge to anchor_lost on paragraph deletion and restores on re-anchor', () => {
    const edge = {
      id: '550e8400-e29b-41d4-a716-446655440030',
      sourceEntityId: 'ResNet',
      targetEntityId: 'VGG',
      rel: 'supersedes' as const,
      provenance: 'document_claim' as const,
      anchor: {
        blockId: 'blk_42',
        justification: 'Residual skip connections enable deeper training'
      },
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user' as const
      }
    }
    store.upsertEdge(edge)

    // Paragraph blk_42 is cut/deleted
    const degraded = store.degradeEdge(edge.id, 'anchor_lost')
    expect(degraded?.status).toBe('anchor_lost')

    // Edge still exists in knowledge graph!
    expect(store.getEdge(edge.id)?.status).toBe('anchor_lost')
    expect(store.getOutlinks('ResNet').length).toBe(1)

    // User restores / re-anchors to new block blk_43
    const restored = store.restoreEdge(edge.id, {
      blockId: 'blk_43',
      justification: 'Re-anchored to summary section'
    })
    expect(restored?.status).toBe('active')
    expect(restored?.anchor?.blockId).toBe('blk_43')
  })

  it('persists and reloads cleanly via saveToFile and loadFromFile', async () => {
    const edge = {
      id: '550e8400-e29b-41d4-a716-446655440040',
      sourceEntityId: 'GraphRAG',
      targetEntityId: 'RAG',
      rel: 'supersedes' as const,
      provenance: 'canvas_relational' as const,
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent' as const
      }
    }
    store.upsertEdge(edge)

    const filePath = path.join(tempDir, 'instances', 'ledger-default.json')
    await store.saveToFile(filePath)

    const secondStore = new RelationalLedgerStore()
    await secondStore.loadFromFile(filePath)

    expect(secondStore.getAllEdges().length).toBe(1)
    const loadedEdge = secondStore.getEdge(edge.id)
    expect(loadedEdge?.sourceEntityId).toBe('GraphRAG')
    expect(loadedEdge?.targetEntityId).toBe('RAG')
  })

  it('throws WorkspaceError with WORKSPACE_WIKI_INVALID_LINK_SCHEMA on invalid entry', () => {
    expect(() => {
      store.upsertEdge({
        id: 'not-a-uuid',
        sourceEntityId: 'A'
      })
    }).toThrowError(WorkspaceError)

    try {
      store.upsertEdge({ id: 'invalid', sourceEntityId: 'A' })
    } catch (err: unknown) {
      expect((err as WorkspaceError).code).toBe(
        WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA
      )
    }
  })
})
