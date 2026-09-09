import { describe, it, expect, beforeEach } from 'vitest'
import { executeLintWorkspace, lintWorkspace } from '../lintWorkspace'
import { MemoryWikiWorkspaceAdapter } from '../adapters'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import type { LintWorkspaceInput } from '@shared/wiki'

describe('lintWorkspace Tool (Spec §7.4)', () => {
  let adapter: MemoryWikiWorkspaceAdapter
  let ledgerStore: RelationalLedgerStore

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('produces passing report when workspace is clean and consistent', async () => {
    await adapter.saveDocument('DocA', {
      blocks: [{ id: '00000000-0000-4000-8000-000000000001', type: 'paragraph', content: 'Hello' }]
    })
    await adapter.saveDocument('DocB', {
      blocks: [{ id: '00000000-0000-4000-8000-000000000002', type: 'paragraph', content: 'World' }]
    })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'DocA',
      targetEntityId: 'DocB',
      rel: 'supports',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000001',
        justification: 'Cites World'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const input: LintWorkspaceInput = {}
    const { audit, report } = await executeLintWorkspace(input, adapter)

    expect(audit.valid).toBe(true)
    expect(audit.errors).toHaveLength(0)
    expect(report).toContain('✅ PASSED (Graph Structurally Valid)')
  })

  it('surfaces errors in markdown report when unresolved symbols exist', async () => {
    await adapter.saveDocument('SourceDoc', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000004',
      sourceEntityId: 'SourceDoc',
      targetEntityId: 'GhostDoc',
      rel: 'supports',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const input: LintWorkspaceInput = {}
    const { audit, report } = await executeLintWorkspace(input, adapter)

    expect(audit.valid).toBe(false)
    expect(audit.errors.length).toBeGreaterThan(0)
    expect(report).toContain('❌ FAILED (Integrity Violations Detected)')
    expect(report).toContain('GhostDoc')
    expect(report).toContain('WORKSPACE_WIKI_UNRESOLVED_SYMBOL')
  })

  it('can be invoked via LangChain tool protocol', async () => {
    await adapter.saveDocument('DocA', { blocks: [] })

    const output = await lintWorkspace.invoke(
      {},
      {
        configurable: {
          adapter
        }
      }
    )

    expect(output).toBeDefined()
    expect(typeof output).toBe('object')
    expect(output.status).toBe('success')
    expect(output.action).toBe('Linted Workspace')
    expect(output.valid).toBe(true)
    expect(output.report).toContain('# Workspace L1 Structural Audit Report')
  })

  it('runs L2 semantic audit when requested via level: "l2"', async () => {
    await adapter.saveDocument('DocX', { blocks: [] })
    await adapter.saveDocument('DocY', { blocks: [] })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000005',
      sourceEntityId: 'DocX',
      targetEntityId: 'DocY',
      rel: 'contradicts',
      provenance: 'canvas_relational',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000001',
        justification: 'Direct contradiction'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const input: LintWorkspaceInput = { level: 'l2' }
    const { audit, l2Audit, report } = await executeLintWorkspace(input, adapter)

    expect(l2Audit).toBeDefined()
    expect(l2Audit?.valid).toBe(false)
    expect(l2Audit?.contradictionCount).toBe(1)
    expect(report).toContain('# Workspace L2 Semantic Audit Report')
    expect(report).not.toContain('# Workspace L1 Structural Audit Report')
  })

  it('runs both L1 and L2 when requested via semantic: true', async () => {
    await adapter.saveDocument('CleanDoc', { blocks: [] })

    const input: LintWorkspaceInput = { semantic: true }
    const { audit, l2Audit, report } = await executeLintWorkspace(input, adapter)

    expect(audit.valid).toBe(true)
    expect(l2Audit).toBeDefined()
    expect(report).toContain('# Workspace L1 Structural Audit Report')
    expect(report).toContain('# Workspace L2 Semantic Audit Report')
  })
})
