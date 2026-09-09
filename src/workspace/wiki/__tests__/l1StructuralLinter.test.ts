import { describe, it, expect, beforeEach } from 'vitest'
import {
  runL1Audit,
  compileWorkspaceProjection,
  createFsWikiWorkspaceAdapter
} from '../L1StructuralLinter'
import { MemoryWikiWorkspaceAdapter } from '../adapter'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { DocumentPayload } from '@workspace/persistence/editorContent'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

describe('L1StructuralLinter & Workspace Compiler', () => {
  let ledgerStore: RelationalLedgerStore
  let adapter: MemoryWikiWorkspaceAdapter

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('reports clean audit for interconnected documents with valid anchors', async () => {
    const sourceDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-1',
          type: 'paragraph',
          content: 'We propose the Transformer model.'
        }
      ]
    }
    const conceptDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-2',
          type: 'paragraph',
          content: 'Self-attention mechanism.'
        }
      ]
    }

    await adapter.saveDocument('sources/vaswani2017', sourceDoc)
    await adapter.saveDocument('Transformer', conceptDoc)

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000001',
      sourceEntityId: 'sources/vaswani2017',
      targetEntityId: 'Transformer',
      rel: 'details',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: 'blk-1',
        justification: 'Introduces Transformer architecture'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const audit = await runL1Audit(adapter)
    expect(audit.valid).toBe(true)
    expect(audit.errors).toHaveLength(0)
    expect(audit.warnings).toHaveLength(0)
  })

  it('detects entity title collisions with normalized duplicates', async () => {
    await adapter.saveDocument('Transformer Model', { blocks: [] })
    await adapter.saveDocument('transformer-model', { blocks: [] })

    const audit = await runL1Audit(adapter)
    expect(audit.valid).toBe(false)
    const collisionErr = audit.errors.find(
      (e) => e.code === WorkspaceErrorCode.WORKSPACE_WIKI_ENTITY_COLLISION
    )
    expect(collisionErr).toBeDefined()
    expect(collisionErr?.message).toContain('Entity collision detected')
  })

  it('detects unresolved symbols when edge points to non-existent document', async () => {
    await adapter.saveDocument('sources/paper1', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000002',
      sourceEntityId: 'sources/paper1',
      targetEntityId: 'NonExistentConcept',
      rel: 'supports',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'user'
      }
    })

    const audit = await runL1Audit(adapter)
    expect(audit.valid).toBe(false)
    const unresolvedErr = audit.errors.find(
      (e) => e.code === WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL
    )
    expect(unresolvedErr).toBeDefined()
    expect(unresolvedErr?.entityId).toBe('NonExistentConcept')
  })

  it('detects missing anchor block in source document', async () => {
    const sourceDoc: DocumentPayload = {
      blocks: [
        {
          id: 'blk-real',
          type: 'paragraph',
          content: 'Actual content.'
        }
      ]
    }
    await adapter.saveDocument('sources/docA', sourceDoc)
    await adapter.saveDocument('ConceptA', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'sources/docA',
      targetEntityId: 'ConceptA',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: 'blk-deleted',
        justification: 'Claim anchor deleted'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const audit = await runL1Audit(adapter)
    expect(audit.valid).toBe(false)
    const anchorErr = audit.errors.find(
      (e) => e.code === WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND
    )
    expect(anchorErr).toBeDefined()
    expect(anchorErr?.anchorBlockId).toBe('blk-deleted')
  })

  it('warns on anchor_lost edges', async () => {
    await adapter.saveDocument('DocA', { blocks: [] })
    await adapter.saveDocument('DocB', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000004',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'relates_to',
      provenance: 'canvas_relational',
      status: 'anchor_lost',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const audit = await runL1Audit(adapter)
    const degradedWarn = audit.warnings.find(
      (w) => w.edgeId === '00000000-0000-4000-8000-000000000004' && w.severity === 'warning'
    )
    expect(degradedWarn).toBeDefined()
  })

  it('detects circular supersedence cycles', async () => {
    await adapter.saveDocument('ModelA', { blocks: [] })
    await adapter.saveDocument('ModelB', { blocks: [] })
    await adapter.saveDocument('ModelC', { blocks: [] })

    // Insert edges directly to bypass assertNoSupersedenceCycle for audit testing
    ledgerStore.loadFromSnapshot([
      {
        id: '00000000-0000-4000-8000-00000000000a',
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
      },
      {
        id: '00000000-0000-4000-8000-00000000000b',
        sourceEntityId: 'ModelB',
        targetEntityId: 'ModelC',
        rel: 'supersedes',
        provenance: 'canvas_relational',
        status: 'active',
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: 'agent'
        }
      },
      {
        id: '00000000-0000-4000-8000-00000000000c',
        sourceEntityId: 'ModelC',
        targetEntityId: 'ModelA',
        rel: 'supersedes',
        provenance: 'canvas_relational',
        status: 'active',
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: 'agent'
        }
      }
    ])

    const audit = await runL1Audit(adapter)
    expect(audit.valid).toBe(false)
    const cycleErr = audit.errors.find(
      (e) => e.code === WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE
    )
    expect(cycleErr).toBeDefined()
  })

  it('compiles workspace into deterministic graph projection snapshot', async () => {
    await adapter.saveDocument('sources/source1', { blocks: [] })
    await adapter.saveDocument('Concept1', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000005',
      sourceEntityId: 'sources/source1',
      targetEntityId: 'Concept1',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const projection = await compileWorkspaceProjection(adapter)
    expect(projection.workspaceId).toBe('default')
    expect(projection.nodes).toHaveLength(2)
    expect(projection.edges).toHaveLength(1)
    expect(projection.unresolvedSymbols).toHaveLength(0)
    expect(projection.entities['Concept1'].type).toBe('concept')
    expect(projection.entities['sources/source1'].type).toBe('source')
  })

  it('createFsWikiWorkspaceAdapter discovers documents in instances and ignores root config files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collar-l1-test-'))
    try {
      const instancesDir = path.join(tempDir, '.collar', 'instances')
      await fs.mkdir(instancesDir, { recursive: true })

      // Write valid instance document
      await fs.writeFile(
        path.join(instancesDir, 'ConceptA.json'),
        JSON.stringify({ blocks: [{ id: 'b1', text: 'Hello' }] }),
        'utf-8'
      )

      // Write root config and non-document files
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-pkg', blocks: [] }),
        'utf-8'
      )
      await fs.writeFile(
        path.join(tempDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: {}, blocks: [] }),
        'utf-8'
      )
      await fs.writeFile(
        path.join(tempDir, 'manifest.json'),
        JSON.stringify({ instances: {}, blocks: [] }),
        'utf-8'
      )

      const fsAdapter = await createFsWikiWorkspaceAdapter(tempDir)
      expect(fsAdapter.listDocuments).toBeDefined()
      const docs = (await fsAdapter.listDocuments?.()) ?? []

      expect(docs).toHaveLength(1)
      expect(docs[0].name).toBe('ConceptA')
      expect(docs.map((d) => d.name)).not.toContain('package')
      expect(docs.map((d) => d.name)).not.toContain('tsconfig')
      expect(docs.map((d) => d.name)).not.toContain('manifest')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
