import { describe, it, expect, beforeEach } from 'vitest'
import { executePruneLedger, pruneLedger } from '../pruneLedger'
import { MemoryWikiWorkspaceAdapter } from '../adapters'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { executeLintWorkspace } from '../lintWorkspace'

describe('pruneLedger Tool (Flaw #1 Remediation)', () => {
  let adapter: MemoryWikiWorkspaceAdapter
  let ledgerStore: RelationalLedgerStore

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('prunes a specific ledger edge by UUID', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000001',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    expect(ledgerStore.getAllEdges()).toHaveLength(1)

    const res = await executePruneLedger(
      { edgeId: '00000000-0000-4000-8000-000000000001' },
      adapter
    )

    expect(res.status).toBe('success')
    expect(res.edgesPruned).toBe(1)
    expect(res.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000001')
    expect(res.remainingEdgesCount).toBe(0)
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
  })

  it('prunes all degraded (anchor_lost) edges when pruneAllDegraded is true', async () => {
    // 1 active edge
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000001',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b1', justification: 'Active claim' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    // 2 degraded edges
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000002',
      sourceEntityId: 'DocA',
      targetEntityId: 'GhostDoc1',
      rel: 'relates_to',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'DocB',
      targetEntityId: 'GhostDoc2',
      rel: 'details',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    expect(ledgerStore.getAllEdges()).toHaveLength(3)

    const res = await executePruneLedger({ pruneAllDegraded: true }, adapter)

    expect(res.status).toBe('success')
    expect(res.edgesPruned).toBe(2)
    expect(res.prunedEdgeIds).toEqual(
      expect.arrayContaining([
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003'
      ])
    )
    expect(res.remainingEdgesCount).toBe(1)
    expect(ledgerStore.getAllEdges()).toHaveLength(1)
    expect(ledgerStore.getAllEdges()[0].id).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('prunes all unresolved edges pointing to nonexistent documents when pruneUnresolved is true', async () => {
    await adapter.saveDocument('DocA', {
      blocks: [{ id: 'b1', type: 'paragraph', content: 'Doc A' }]
    })
    await adapter.saveDocument('DocB', {
      blocks: [{ id: 'b2', type: 'paragraph', content: 'Doc B' }]
    })

    // Edge between valid documents
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000010',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b1', justification: 'Valid' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    // Edge to nonexistent document (poisoned link)
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000020',
      sourceEntityId: 'DocA',
      targetEntityId: 'test-graph',
      rel: 'relates_to',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const res = await executePruneLedger({ pruneUnresolved: true }, adapter)

    expect(res.status).toBe('success')
    expect(res.edgesPruned).toBe(1)
    expect(res.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000020')
    expect(res.remainingEdgesCount).toBe(1)
    expect(ledgerStore.getAllEdges()[0].targetEntityId).toBe('DocB')
  })

  it('prunes edges matching query criteria', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000030',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'contradicts',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const res = await executePruneLedger(
      { sourceEntityId: 'DocA', targetEntityId: 'DocB', rel: 'contradicts' },
      adapter
    )

    expect(res.status).toBe('success')
    expect(res.edgesPruned).toBe(1)
    expect(res.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000030')
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
  })

  it('resolves Flaw #1: completely clears degraded poisoned edge so lint passes cleanly', async () => {
    await adapter.saveDocument('sources/DocA', {
      blocks: [{ id: 'b1', type: 'paragraph', content: 'Doc A content.' }]
    })
    await adapter.saveDocument('DocB', {
      blocks: [{ id: 'b2', type: 'paragraph', content: 'Doc B content.' }]
    })

    // Valid edge
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000100',
      sourceEntityId: 'sources/DocA',
      targetEntityId: 'DocB',
      rel: 'details',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b1', justification: 'Details relation' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    // Accidental degraded edge to test-graph that was previously immortal
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000200',
      sourceEntityId: 'sources/DocA',
      targetEntityId: 'test-graph',
      rel: 'relates_to',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    // Before pruning: lintWorkspace warns about degraded edge
    const preLint = await executeLintWorkspace({}, adapter)
    expect(
      preLint.audit.warnings.some((w) => w.edgeId === '00000000-0000-4000-8000-000000000200')
    ).toBe(true)

    // Execute pruneLedger
    const pruneResult = await executePruneLedger({ pruneAllDegraded: true }, adapter)
    expect(pruneResult.edgesPruned).toBe(1)
    expect(pruneResult.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000200')

    // After pruning: workspace is completely clean with 0 warnings and 0 errors!
    const postLint = await executeLintWorkspace({}, adapter)
    expect(postLint.audit.valid).toBe(true)
    expect(postLint.audit.errors).toHaveLength(0)
    expect(postLint.audit.warnings).toHaveLength(0)
  })

  it('prunes multiple specific edges via edgeIds array in a single invocation', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000001',
      sourceEntityId: 'Doc1',
      targetEntityId: 'Doc2',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b1', justification: 'j1' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000002',
      sourceEntityId: 'Doc2',
      targetEntityId: 'Doc3',
      rel: 'cites',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b2', justification: 'j2' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'Doc3',
      targetEntityId: 'Doc4',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const res = await executePruneLedger(
      {
        edgeIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
      },
      adapter
    )

    expect(res.status).toBe('success')
    expect(res.edgesPruned).toBe(2)
    expect(res.prunedEdgeIds).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ])
    expect(res.remainingEdgesCount).toBe(1)
    expect(ledgerStore.getAllEdges()).toHaveLength(1)
    expect(ledgerStore.getAllEdges()[0].id).toBe('00000000-0000-4000-8000-000000000003')
  })

  it('prunes all incident edges for an entity via entityId cascading', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000011',
      sourceEntityId: 'DeletedDoc',
      targetEntityId: 'DocA',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b1', justification: 'j1' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000012',
      sourceEntityId: 'DocB',
      targetEntityId: 'DeletedDoc',
      rel: 'cites',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b2', justification: 'j2' },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000013',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const res = await executePruneLedger({ entityId: 'DeletedDoc' }, adapter)
    expect(res.edgesPruned).toBe(2)
    expect(res.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000011')
    expect(res.prunedEdgeIds).toContain('00000000-0000-4000-8000-000000000012')
    expect(res.remainingEdgesCount).toBe(1)
    expect(ledgerStore.getEdge('00000000-0000-4000-8000-000000000013')).toBeDefined()
  })

  it('supports dryRun simulation without mutating the ledger or saving to disk', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000021',
      sourceEntityId: 'DocX',
      targetEntityId: 'DocY',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    let saveLedgerCalled = false
    adapter.saveLedger = async () => {
      saveLedgerCalled = true
    }

    const res = await executePruneLedger({ pruneAllDegraded: true, dryRun: true }, adapter)

    expect(res.status).toBe('success')
    expect(res.dryRun).toBe(true)
    expect(res.edgesPruned).toBe(1)
    expect(res.prunedEdgeIds).toEqual(['00000000-0000-4000-8000-000000000021'])
    expect(res.remainingEdgesCount).toBe(0)
    expect(res.report).toContain('DRY RUN SIMULATION')

    // In dryRun, store must NOT be mutated and saveLedger must NOT be called
    expect(ledgerStore.getAllEdges()).toHaveLength(1)
    expect(saveLedgerCalled).toBe(false)
  })

  it('invokes adapter.saveLedger when pruning in non-dryRun mode', async () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000031',
      sourceEntityId: 'DocX',
      targetEntityId: 'DocY',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    let saveLedgerCalled = false
    adapter.saveLedger = async () => {
      saveLedgerCalled = true
    }

    const res = await executePruneLedger({ pruneAllDegraded: true, dryRun: false }, adapter)

    expect(res.edgesPruned).toBe(1)
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
    expect(saveLedgerCalled).toBe(true)
  })
})
