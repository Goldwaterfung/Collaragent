import { describe, it, expect, beforeEach } from 'vitest'
import { executeCompileGraph, compileGraph } from '../compileGraph'
import { executeLintWorkspace } from '../lintWorkspace'
import { MemoryWikiWorkspaceAdapter } from '../adapters'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { parseGraphFromSnapshot } from '@workspace/wstools/manageGraph'
import type { CompileGraphInput } from '@shared/wiki'

describe('compileGraph Tool (Spec §7.4, §11)', () => {
  let adapter: MemoryWikiWorkspaceAdapter
  let ledgerStore: RelationalLedgerStore

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('aborts compilation and returns error report when structural errors exist (failOnError: true)', async () => {
    await adapter.saveDocument('DocA', {
      blocks: [{ id: '00000000-0000-4000-8000-000000000001', type: 'paragraph', content: 'Doc A' }]
    })

    // Create an edge pointing to a non-existent document
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000010',
      sourceEntityId: 'DocA',
      targetEntityId: 'MissingDoc',
      rel: 'supports',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const input: CompileGraphInput = {
      canvasName: 'test-canvas',
      failOnError: true
    }

    const result = await executeCompileGraph(input, adapter)

    expect(result.status).toBe('error')
    expect(result.valid).toBe(false)
    expect(result.report).toContain('🛑 Graph Compilation Aborted')
    expect(result.report).toContain('MissingDoc')
    expect(result.nodeCount).toBe(0)
    expect(result.edgeCount).toBe(0)

    // Verify canvas was not created
    const saved = await adapter.getCanvas('test-canvas')
    expect(saved).toBeNull()
  })

  it('successfully lints and compiles valid workspace documents into a canvas graph in adapter', async () => {
    await adapter.saveDocument('Attention Mechanism', {
      blocks: [
        { id: '00000000-0000-4000-8000-000000000001', type: 'paragraph', content: 'Core mechanism' }
      ]
    })
    await adapter.saveDocument('Transformer Architecture', {
      blocks: [
        { id: '00000000-0000-4000-8000-000000000002', type: 'paragraph', content: 'Uses attention' }
      ]
    })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000020',
      sourceEntityId: 'Transformer Architecture',
      targetEntityId: 'Attention Mechanism',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000002',
        justification: 'Transformers rely heavily on scaled dot-product attention'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const input: CompileGraphInput = {
      canvasName: 'concept-canvas',
      failOnError: true
    }

    const result = await executeCompileGraph(input, adapter)

    expect(result.status).toBe('success')
    expect(result.valid).toBe(true)
    expect(result.instanceName).toBe('concept-canvas')
    expect(result.nodeCount).toBe(2)
    expect(result.edgeCount).toBe(1)
    expect(result.relationsBreakdown.supports).toBe(1)
    expect(result.report).toContain('🗺️ Workspace Knowledge Graph Compiled Successfully')
    expect(result.report).toContain('readGraph({ instanceName: "concept-canvas" })')

    // Verify the canvas was persisted to the adapter
    const savedCanvas = await adapter.getCanvas('concept-canvas')
    expect(savedCanvas).not.toBeNull()
    expect(Object.keys(savedCanvas!.graph.nodes)).toHaveLength(2)
    expect(Object.keys(savedCanvas!.graph.relationships)).toHaveLength(1)

    // Verify readGraph snapshot parsing can read the compiled canvas
    const parsedGraph = parseGraphFromSnapshot(savedCanvas)
    expect(parsedGraph.nodes).toHaveLength(2)
    const entityNames = parsedGraph.nodes.map((n) => n.entity)
    expect(entityNames).toContain('Attention Mechanism')
    expect(entityNames).toContain('Transformer Architecture')
    expect(parsedGraph.edges).toHaveLength(1)
    expect(parsedGraph.edges[0].from).toBe('Transformer Architecture')
    expect(parsedGraph.edges[0].to).toBe('Attention Mechanism')
    expect(parsedGraph.edges[0].label).toBe('supports')
  })

  it('preserves existing layout coordinates when compiling over an existing canvas', async () => {
    // Pre-seed an existing canvas with custom positions
    await adapter.saveCanvas('concept-canvas', {
      schemaVersion: 1,
      type: 'graph-canvas',
      graph: {
        nodes: {
          'existing-node-1': {
            id: 'existing-node-1',
            type: 'card',
            name: 'DocOld',
            attrs: {}
          }
        },
        relationships: {}
      },
      layout: {
        layoutByNodeId: {
          'existing-node-1': {
            x: 777,
            y: 888,
            width: 250,
            height: 120
          }
        }
      },
      meta: {}
    })

    // Now add DocOld and DocNew in the workspace
    await adapter.saveDocument('DocOld', { blocks: [] })
    await adapter.saveDocument('DocNew', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000030',
      sourceEntityId: 'DocOld',
      targetEntityId: 'DocNew',
      rel: 'relates_to',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const result = await executeCompileGraph(
      { canvasName: 'concept-canvas', failOnError: true },
      adapter
    )

    expect(result.status).toBe('success')

    const reloaded = await adapter.getCanvas('concept-canvas')
    expect(reloaded).not.toBeNull()
    // The existing node coordinate must be preserved
    expect(reloaded!.layout.layoutByNodeId['existing-node-1'].x).toBe(777)
    expect(reloaded!.layout.layoutByNodeId['existing-node-1'].y).toBe(888)

    // The new node should have non-colliding layout coordinates
    const newNodes = Object.keys(reloaded!.graph.nodes).filter((id) => id !== 'existing-node-1')
    expect(newNodes).toHaveLength(1)
    const newLayout = reloaded!.layout.layoutByNodeId[newNodes[0]]
    expect(newLayout).toBeDefined()
    expect(newLayout.x).toBeGreaterThan(0)
  })

  it('can be invoked via LangChain tool protocol', async () => {
    await adapter.saveDocument('PaperA', { blocks: [] })
    await adapter.saveDocument('PaperB', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000040',
      sourceEntityId: 'PaperA',
      targetEntityId: 'PaperB',
      rel: 'cites',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const output = await compileGraph.invoke(
      { canvasName: 'test-lc-canvas' },
      {
        configurable: {
          adapter
        }
      }
    )

    expect(output).toBeDefined()
    expect(typeof output).toBe('object')
    expect(output.status).toBe('success')
    expect(output.action).toBe('Compiled Graph')
    expect(output.instanceName).toBe('test-lc-canvas')
    expect(output.nodeCount).toBe(2)
    expect(output.edgeCount).toBe(1)
    expect(output.report).toContain('# 🗺️ Workspace Knowledge Graph Compiled Successfully')
    expect(output.report).toContain('test-lc-canvas')
    expect(output.report).toContain('**Total Nodes**: 2')
    expect(output.report).toContain('**Total Relationships**: 1')
  })

  it('lintWorkspace compiles and saves canvas when compileToCanvas: true is passed', async () => {
    await adapter.saveDocument('ModelA', { blocks: [] })
    await adapter.saveDocument('ModelB', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000050',
      sourceEntityId: 'ModelA',
      targetEntityId: 'ModelB',
      rel: 'supersedes',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const { audit, report } = await executeLintWorkspace(
      { compileToCanvas: true, canvasName: 'lint-compiled-canvas' },
      adapter
    )

    expect(audit.valid).toBe(true)
    expect(report).toContain('## 🗺️ Canvas Graph Materialization')
    expect(report).toContain(
      'Successfully compiled and persisted graph to canvas `lint-compiled-canvas`'
    )

    const saved = await adapter.getCanvas('lint-compiled-canvas')
    expect(saved).not.toBeNull()
    expect(Object.keys(saved!.graph.nodes)).toHaveLength(2)
  })

  describe('Live SQLite & REST API Integration', () => {
    let testDir: string
    let dbFilePath: string
    let db: import('@main/server/fileServer/db/SqliteDatabase').SqliteDatabase
    let storage: import('@main/server/fileServer/SqliteStorageEngine').SqliteStorageEngine
    let apiHandle: import('@main/server/fileServer/filesystemAPI').FilesystemApiHandle

    beforeEach(async () => {
      const fs = await import('node:fs')
      const os = await import('node:os')
      const path = await import('node:path')
      const { SqliteDatabase } = await import('@main/server/fileServer/db/SqliteDatabase')
      const { SqliteStorageEngine } = await import('@main/server/fileServer/SqliteStorageEngine')
      const { startFilesystemApi } = await import('@main/server/fileServer/filesystemAPI')

      testDir = path.join(
        os.tmpdir(),
        `collar-compile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      fs.mkdirSync(testDir, { recursive: true })
      dbFilePath = path.join(testDir, 'test-workspace.cagent')

      db = new SqliteDatabase(dbFilePath)
      storage = new SqliteStorageEngine(db, { cagentPath: dbFilePath })

      apiHandle = await startFilesystemApi({
        port: 0,
        filePath: dbFilePath,
        storageEngine: storage
      })
    })

    afterEach(async () => {
      const fs = await import('node:fs')
      await apiHandle.close()
      await storage.close()
      try {
        fs.rmSync(testDir, { recursive: true, force: true })
      } catch {
        // Ignore removal errors
      }
    })

    it('compiles graph into real SQLite database and readGraph can inspect it', async () => {
      const { unpack } = await import('msgpackr')
      const { LiveWikiWorkspaceAdapter } = await import('../adapters')

      // 1. Seed project and document instances in SQLite
      const defaultProject = storage.createProject('Default Project')
      storage.createInstance('document', {
        id: '00000000-0000-4000-8000-000000000101',
        name: 'Artificial Intelligence',
        projectId: defaultProject.id,
        payload: {
          blocks: [{ id: 'b1', type: 'paragraph', content: 'AI overview' }]
        }
      })
      storage.createInstance('document', {
        id: '00000000-0000-4000-8000-000000000102',
        name: 'Machine Learning',
        projectId: defaultProject.id,
        payload: {
          blocks: [{ id: 'b2', type: 'paragraph', content: 'ML subfield' }]
        }
      })

      // 2. Set up Relational Ledger
      const liveLedger = new RelationalLedgerStore()
      liveLedger.upsertEdge({
        id: '00000000-0000-4000-8000-000000000099',
        sourceEntityId: 'Machine Learning',
        targetEntityId: 'Artificial Intelligence',
        rel: 'derived_from',
        provenance: 'document_claim',
        status: 'active',
        anchor: {
          blockId: 'b2',
          justification: 'ML is derived from AI principles'
        },
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: 'agent'
        }
      })

      const liveAdapter = new LiveWikiWorkspaceAdapter({ apiPort: apiHandle.port }, liveLedger)

      // 3. Execute compileGraph tool
      const compileResult = await executeCompileGraph(
        { canvasName: 'knowledge-canvas', failOnError: true },
        liveAdapter
      )

      expect(compileResult.status).toBe('success')
      expect(compileResult.instanceName).toBe('knowledge-canvas')
      expect(compileResult.nodeCount).toBe(2)
      expect(compileResult.edgeCount).toBe(1)
      expect(compileResult.relationsBreakdown.derived_from).toBe(1)

      // 4. Verify directly in SQLite storage engine
      const instances = storage.getInstancesMeta()
      const canvasInstance = instances.find(
        (i) => i.name === 'knowledge-canvas' && i.type === 'canvas'
      )
      expect(canvasInstance).toBeDefined()

      const rawBlob = storage.getInstanceContent(canvasInstance!.id)
      expect(rawBlob).not.toBeNull()
      const unpacked = unpack(rawBlob as Buffer) as unknown

      // 5. Verify that readGraph snapshot parser reads the SQLite stored canvas
      const readGraphResult = parseGraphFromSnapshot(unpacked)
      expect(readGraphResult.nodes).toHaveLength(2)
      const entities = readGraphResult.nodes.map((n) => n.entity)
      expect(entities).toContain('Artificial Intelligence')
      expect(entities).toContain('Machine Learning')

      expect(readGraphResult.edges).toHaveLength(1)
      expect(readGraphResult.edges[0].from).toBe('Machine Learning')
      expect(readGraphResult.edges[0].to).toBe('Artificial Intelligence')
      expect(readGraphResult.edges[0].label).toBe('derived_from')
    })
  })
})
