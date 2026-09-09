import { describe, it, expect, beforeEach } from 'vitest'
import {
  compileGraphProjection,
  compileIncrementalProjection,
  compileWorkspace
} from '../GraphCompiler'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import { MemoryWikiWorkspaceAdapter } from '../adapter'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import type { RelationalLedgerEntry } from '@shared/wiki'
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants'

describe('GraphCompiler (Spec §7.6)', () => {
  let ledgerStore: RelationalLedgerStore
  let adapter: MemoryWikiWorkspaceAdapter

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('preserves existing node layout and attributes from canvas snapshot', () => {
    const existingCanvas: GraphCanvasDTO = {
      schemaVersion: 1,
      type: 'graph-canvas',
      graph: {
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'card',
            name: 'ConceptA',
            attrs: { clusterId: 'cluster-42', color: '#ff0000' }
          }
        },
        relationships: {}
      },
      layout: {
        layoutByNodeId: {
          'node-1': { x: 150, y: 320, width: 280, height: 140 }
        }
      }
    }

    const projection = compileGraphProjection({
      ledgerStore,
      layoutSnapshot: existingCanvas
    })

    expect(projection.graph.nodes['node-1']).toBeDefined()
    expect(projection.graph.nodes['node-1'].name).toBe('ConceptA')
    expect(projection.graph.nodes['node-1'].attrs?.clusterId).toBe('cluster-42')
    expect(projection.layout.layoutByNodeId['node-1']).toEqual({
      x: 150,
      y: 320,
      width: 280,
      height: 140
    })
  })

  it('auto-provisions non-colliding layout coordinates for new ledger entities', () => {
    const edge: RelationalLedgerEntry = {
      id: '00000000-0000-4000-8000-000000000001',
      sourceEntityId: 'SourceConcept',
      targetEntityId: 'TargetConcept',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000002',
        justification: 'Grounding evidence'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    }
    ledgerStore.upsertEdge(edge)

    const projection = compileGraphProjection({
      ledgerStore,
      layoutSnapshot: null
    })

    const nodeValues = Object.values(projection.graph.nodes)
    expect(nodeValues).toHaveLength(2)

    const sourceNode = nodeValues.find((n) => n.name === 'SourceConcept')
    const targetNode = nodeValues.find((n) => n.name === 'TargetConcept')
    expect(sourceNode).toBeDefined()
    expect(targetNode).toBeDefined()

    const sourceLayout = projection.layout.layoutByNodeId[sourceNode!.id]
    const targetLayout = projection.layout.layoutByNodeId[targetNode!.id]
    expect(sourceLayout.width).toBe(DEFAULT_NODE_WIDTH)
    expect(sourceLayout.height).toBe(DEFAULT_NODE_HEIGHT)
    expect(targetLayout.width).toBe(DEFAULT_NODE_WIDTH)
    expect(targetLayout.height).toBe(DEFAULT_NODE_HEIGHT)

    // They should not overlap vertically if sharing same X column
    if (sourceLayout.x === targetLayout.x) {
      expect(Math.abs(sourceLayout.y - targetLayout.y)).toBeGreaterThanOrEqual(DEFAULT_NODE_HEIGHT)
    }

    // Relationship projected accurately
    const rel = projection.graph.relationships[edge.id]
    expect(rel).toBeDefined()
    expect(rel.from.nodeId).toBe(sourceNode!.id)
    expect(rel.to.nodeId).toBe(targetNode!.id)
    expect(rel.attrs?.rel).toBe('supports')
    expect(rel.attrs?.provenance).toBe('document_claim')
    expect(rel.attrs?.anchorBlockId).toBe('00000000-0000-4000-8000-000000000002')
  })

  it('filters out archived ledger edges from projection', () => {
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000010',
      sourceEntityId: 'ActiveSource',
      targetEntityId: 'ActiveTarget',
      rel: 'cites',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000011',
      sourceEntityId: 'ArchivedSource',
      targetEntityId: 'ArchivedTarget',
      rel: 'cites',
      provenance: 'canvas_relational',
      status: 'archived',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const projection = compileGraphProjection({ ledgerStore })
    expect(projection.graph.relationships['00000000-0000-4000-8000-000000000010']).toBeDefined()
    expect(projection.graph.relationships['00000000-0000-4000-8000-000000000011']).toBeUndefined()
  })

  it('incrementally projects ledger commands (upsert, remove, degrade, restore)', () => {
    let projection: GraphCanvasDTO = {
      schemaVersion: 1,
      type: 'graph-canvas',
      graph: {
        nodes: {
          'node-a': { id: 'node-a', type: 'card', name: 'Alpha' },
          'node-b': { id: 'node-b', type: 'card', name: 'Beta' }
        },
        relationships: {}
      },
      layout: {
        layoutByNodeId: {
          'node-a': { x: 100, y: 100, width: 300, height: 100 },
          'node-b': { x: 500, y: 100, width: 300, height: 100 }
        }
      }
    }

    // 1. Incremental upsert_edge
    projection = compileIncrementalProjection(projection, {
      type: 'ledger:upsert_edge',
      entry: {
        id: 'edge-ab',
        sourceEntityId: 'Alpha',
        targetEntityId: 'Beta',
        rel: 'supports',
        provenance: 'document_claim',
        status: 'active',
        anchor: { blockId: 'blk-1', justification: 'Direct claim' },
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: 'agent'
        }
      }
    })

    expect(projection.graph.relationships['edge-ab']).toBeDefined()
    expect(projection.graph.relationships['edge-ab'].from.nodeId).toBe('node-a')
    expect(projection.graph.relationships['edge-ab'].to.nodeId).toBe('node-b')
    expect(projection.graph.relationships['edge-ab'].attrs?.status).toBe('active')

    // 2. Incremental degrade_edge
    projection = compileIncrementalProjection(projection, {
      type: 'ledger:degrade_edge',
      edgeId: 'edge-ab',
      reason: 'anchor_lost'
    })
    expect(projection.graph.relationships['edge-ab'].attrs?.status).toBe('anchor_lost')

    // 3. Incremental restore_edge
    projection = compileIncrementalProjection(projection, {
      type: 'ledger:restore_edge',
      edgeId: 'edge-ab',
      anchor: {
        blockId: 'blk-2',
        justification: 'Restored claim'
      }
    })
    expect(projection.graph.relationships['edge-ab'].attrs?.status).toBe('active')
    expect(projection.graph.relationships['edge-ab'].attrs?.anchorBlockId).toBe('blk-2')

    // 4. Incremental remove_edge
    projection = compileIncrementalProjection(projection, {
      type: 'ledger:remove_edge',
      edgeId: 'edge-ab'
    })
    expect(projection.graph.relationships['edge-ab']).toBeUndefined()
  })

  it('compiles entire workspace via compileWorkspace helper', async () => {
    await adapter.saveDocument('DocAlpha', { blocks: [] })
    await adapter.saveDocument('DocBeta', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000020',
      sourceEntityId: 'DocAlpha',
      targetEntityId: 'DocBeta',
      rel: 'details',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000001',
        justification: 'Details relation'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const projection = await compileWorkspace(adapter)
    expect(Object.keys(projection.graph.nodes).length).toBe(2)
    expect(Object.keys(projection.graph.relationships).length).toBe(1)
    expect(projection.graph.relationships['00000000-0000-4000-8000-000000000020'].attrs?.rel).toBe(
      'details'
    )
  })

  it('does not fabricate phantom nodes for unresolvable targets when documents are specified (Flaw #5)', async () => {
    await adapter.saveDocument('ValidDoc', { blocks: [] })

    // Insert an edge pointing to a non-existent document
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000099',
      sourceEntityId: 'ValidDoc',
      targetEntityId: 'NonExistentDoc',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: 'blk-1',
        justification: 'Points to ghost'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const projection = await compileWorkspace(adapter)
    // Only ValidDoc should exist as a node, NOT NonExistentDoc
    expect(Object.keys(projection.graph.nodes)).toHaveLength(1)
    expect(projection.graph.nodes[Object.keys(projection.graph.nodes)[0]].name).toBe('ValidDoc')
    // Unresolvable edge must NOT be projected
    expect(projection.graph.relationships['00000000-0000-4000-8000-000000000099']).toBeUndefined()
  })
})
