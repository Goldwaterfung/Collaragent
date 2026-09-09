import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runL2SemanticAudit, formatL2AuditReport } from '../L2SemanticLinter'
import { MemoryWikiWorkspaceAdapter } from '../adapter'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import type { RelationalLedgerEntry } from '@shared/wiki'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

describe('L2SemanticLinter (Spec §7.5)', () => {
  let ledgerStore: RelationalLedgerStore
  let adapter: MemoryWikiWorkspaceAdapter

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('detects contradiction edges between documents without LLM', async () => {
    const docA: DocumentPayload = {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'paragraph',
          content: 'Theory A asserts light travels as pure particles in medium.'
        }
      ]
    }
    const docB: DocumentPayload = {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'paragraph',
          content: 'Theory B asserts light travels as continuous waves.'
        }
      ]
    }

    await adapter.saveDocument('TheoryA', docA)
    await adapter.saveDocument('TheoryB', docB)

    const contradictionEdge: RelationalLedgerEntry = {
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'TheoryA',
      targetEntityId: 'TheoryB',
      rel: 'contradicts',
      provenance: 'document_claim',
      status: 'active',
      anchor: {
        blockId: '00000000-0000-4000-8000-000000000001',
        justification: 'Wave-particle duality debate.'
      },
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    }
    ledgerStore.upsertEdge(contradictionEdge)

    const result = await runL2SemanticAudit({ workspace: adapter })

    expect(result.valid).toBe(false)
    expect(result.contradictionCount).toBe(1)
    const diag = result.diagnostics.find((d) => d.category === 'contradiction')
    expect(diag).toBeDefined()
    expect(diag?.entityId).toBe('TheoryA')
    expect(diag?.targetEntityId).toBe('TheoryB')
    expect(diag?.analysis).toContain('Wave-particle duality debate.')
  })

  it('invokes LLM model when provided for contradiction analysis and handles failure gracefully', async () => {
    await adapter.saveDocument('ClaimAlpha', {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'paragraph',
          content: 'Alpha claim content'
        }
      ]
    })
    await adapter.saveDocument('ClaimBeta', {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'paragraph',
          content: 'Beta claim content'
        }
      ]
    })

    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000003',
      sourceEntityId: 'ClaimAlpha',
      targetEntityId: 'ClaimBeta',
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

    const mockInvoke = vi
      .fn()
      .mockResolvedValue('Scholarly debate regarding empirical sample sizes.')
    const result = await runL2SemanticAudit({
      workspace: adapter,
      invokeModel: mockInvoke
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const diag = result.diagnostics.find((d) => d.category === 'contradiction')
    expect(diag?.analysis).toBe('Scholarly debate regarding empirical sample sizes.')

    // Graceful fallback when model throws
    const throwingInvoke = vi.fn().mockRejectedValue(new Error('LLM rate limit reached'))
    const fallbackResult = await runL2SemanticAudit({
      workspace: adapter,
      invokeModel: throwingInvoke
    })
    expect(fallbackResult.contradictionCount).toBe(1)
    expect(fallbackResult.diagnostics[0].analysis).toContain('Direct contradiction')
  })

  it('detects staleness when a document depends on a superseded entity', async () => {
    // ModelV2 supersedes ModelV1
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000010',
      sourceEntityId: 'ModelV2',
      targetEntityId: 'ModelV1',
      rel: 'supersedes',
      provenance: 'document_claim',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    // ExperimentAlpha still depends on ModelV1 (stale!)
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000011',
      sourceEntityId: 'ExperimentAlpha',
      targetEntityId: 'ModelV1',
      rel: 'supports',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    await adapter.saveDocument('ModelV2', { blocks: [] })
    await adapter.saveDocument('ModelV1', { blocks: [] })
    await adapter.saveDocument('ExperimentAlpha', { blocks: [] })

    const result = await runL2SemanticAudit({ workspace: adapter })

    expect(result.valid).toBe(false)
    expect(result.staleClaimsCount).toBe(1)
    const staleDiag = result.diagnostics.find((d) => d.category === 'staleness')
    expect(staleDiag?.entityId).toBe('ExperimentAlpha')
    expect(staleDiag?.targetEntityId).toBe('ModelV1')
    expect(staleDiag?.analysis).toContain('superseded by "ModelV2"')

    // If ExperimentAlpha also cites ModelV2, it is no longer flagged as stale
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000012',
      sourceEntityId: 'ExperimentAlpha',
      targetEntityId: 'ModelV2',
      rel: 'supports',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const updatedResult = await runL2SemanticAudit({ workspace: adapter })
    expect(updatedResult.staleClaimsCount).toBe(0)
  })

  it('detects implicit mentions of known entities missing claim badges or links', async () => {
    await adapter.saveDocument('NeuralNetwork', {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000020',
          type: 'paragraph',
          content: 'Architecture details.'
        }
      ]
    })

    // PaperDoc mentions "NeuralNetwork" in text without any claimBadge
    await adapter.saveDocument('PaperDoc', {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000021',
          type: 'paragraph',
          content: 'We evaluate the performance of our NeuralNetwork on the benchmark dataset.'
        }
      ]
    })

    const result = await runL2SemanticAudit({ workspace: adapter })

    expect(result.implicitMentionsCount).toBe(1)
    const mention = result.diagnostics.find((d) => d.category === 'implicit_mention')
    expect(mention?.entityId).toBe('PaperDoc')
    expect(mention?.targetEntityId).toBe('NeuralNetwork')

    // If PaperDoc has a claim badge referencing NeuralNetwork, it should not be flagged as missing
    await adapter.saveDocument('PaperDoc', {
      blocks: [
        {
          id: '00000000-0000-4000-8000-000000000021',
          type: 'paragraph',
          children: [
            {
              text: 'We evaluate NeuralNetwork',
              claimBadge: {
                badgeId: '00000000-0000-4000-8000-000000000099',
                rel: 'supports',
                targetEntityId: 'NeuralNetwork',
                justification: 'Explicit claim badge'
              }
            }
          ]
        }
      ]
    })

    const clearedResult = await runL2SemanticAudit({ workspace: adapter })
    expect(clearedResult.implicitMentionsCount).toBe(0)
  })

  it('detects research gaps for isolated concept documents', async () => {
    await adapter.saveDocument('QuantumPhysics', { blocks: [] })
    await adapter.saveDocument('ClassicalMechanics', { blocks: [] })
    await adapter.saveDocument('IsolatedIdea', { blocks: [] })

    // Link QuantumPhysics and ClassicalMechanics
    ledgerStore.upsertEdge({
      id: '00000000-0000-4000-8000-000000000030',
      sourceEntityId: 'QuantumPhysics',
      targetEntityId: 'ClassicalMechanics',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'agent'
      }
    })

    const result = await runL2SemanticAudit({ workspace: adapter })

    expect(result.researchGapsCount).toBe(1)
    const gap = result.diagnostics.find((d) => d.category === 'research_gap')
    expect(gap?.entityId).toBe('IsolatedIdea')
  })

  it('formats comprehensive Markdown reports with status icons', () => {
    const report = formatL2AuditReport({
      valid: false,
      diagnostics: [
        {
          category: 'contradiction',
          severity: 'warning',
          entityId: 'DocA',
          targetEntityId: 'DocB',
          edgeId: 'edge-1',
          title: 'Contradiction: DocA vs DocB',
          analysis: 'Divergent theoretical framing.',
          suggestedAction: 'Synthesize literature.'
        },
        {
          category: 'staleness',
          severity: 'warning',
          entityId: 'DocC',
          targetEntityId: 'DocA',
          edgeId: 'edge-2',
          title: 'Stale Dependency: DocC on DocA',
          analysis: 'DocA superseded.',
          suggestedAction: 'Update target.'
        }
      ],
      contradictionCount: 1,
      staleClaimsCount: 1,
      implicitMentionsCount: 0,
      researchGapsCount: 0,
      auditedAt: '2026-09-09T00:00:00.000Z'
    })

    expect(report).toContain('# Workspace L2 Semantic Audit Report')
    expect(report).toContain('⚠️ ATTENTION REQUIRED')
    expect(report).toContain('## ⚡ Contradictions & Theoretical Tensions')
    expect(report).toContain('## ⏳ Staleness & Supersedence Dependencies')
    expect(report).toContain('Synthesize literature.')
  })
})
