import { describe, it, expect, beforeEach } from 'vitest'
import { executeQueryAndFileBack, queryAndFileBack } from '../queryAndFileBack'
import { MemoryWikiWorkspaceAdapter } from '../adapters'
import { InvertedIndexManager } from '@workspace/wiki/InvertedIndexManager'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import type { QueryAndFileBackInput } from '@shared/wiki'

describe('queryAndFileBack (Spec §7.3 & Atomic Compounding)', () => {
  let adapter: MemoryWikiWorkspaceAdapter
  let ledgerStore: RelationalLedgerStore
  let indexManager: InvertedIndexManager

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
    indexManager = new InvertedIndexManager()

    // Pre-seed index with context
    indexManager.addDocument(
      'ViT',
      'Vision Transformer',
      'Vision transformers apply multi-head self-attention to image patches.'
    )
    indexManager.addDocument(
      'CNN',
      'Convolutional Networks',
      'CNNs use sliding kernel convolution matrices.'
    )
  })

  it('atomically files back synthesis with bidirectional ledger relations, index update, and log append', async () => {
    const input: QueryAndFileBackInput = {
      query: 'Compare Vision Transformers and CNN architectures for image classification',
      targetEntity: 'ViT-vs-CNN-Analysis',
      synthesisTitle: 'Comparative Analysis: Vision Transformers vs CNNs',
      synthesisContent:
        'While CNNs bake in translation equivariance inductively, ViTs scale better with large data.',
      referencedEntities: ['ViT', 'CNN'],
      relationToReferences: 'derived_from',
      justification:
        'Synthesized directly from inductive bias comparisons in ViT and CNN literature.',
      summary: 'Architectural comparison between inductive bias and scale.'
    }

    const result = await executeQueryAndFileBack(input, adapter, indexManager)
    expect(result.status).toBe('success')
    expect(result.targetEntity).toBe('ViT-vs-CNN-Analysis')
    expect(result.edgesCreated).toBe(4) // 2 forward + 2 reciprocal
    expect(result.indexUpdated).toBe(true)
    expect(result.logAppended).toBe(true)
    expect(result.searchResults).toBeDefined()
    expect(result.searchResults!.length).toBeGreaterThan(0)

    // 1. Verify Synthesis Document Created
    const doc = await adapter.getDocument('ViT-vs-CNN-Analysis')
    expect(doc).not.toBeNull()
    expect(doc?.blocks[0].children?.[0].text).toBe(
      'Comparative Analysis: Vision Transformers vs CNNs'
    )
    expect(doc?.blocks[1].children?.[0].text).toContain('Synthesis Query: ')

    // Verify claim badges inside document
    const refBlocks = doc?.blocks.filter((b) => b.children?.some((c) => c.claimBadge !== undefined))
    expect(refBlocks).toHaveLength(2)
    expect(refBlocks?.[0].children?.find((c) => c.claimBadge)?.claimBadge?.targetEntityId).toBe(
      'ViT'
    )
    expect(refBlocks?.[1].children?.find((c) => c.claimBadge)?.claimBadge?.targetEntityId).toBe(
      'CNN'
    )

    // 2. Verify Bidirectional Ledger Edges
    const edges = ledgerStore.getAllEdges()
    expect(edges).toHaveLength(4)

    // Forward document_claim edges
    const forwardVit = ledgerStore.findEdge('ViT-vs-CNN-Analysis', 'ViT', 'derived_from')
    expect(forwardVit).toBeDefined()
    expect(forwardVit?.provenance).toBe('document_claim')
    expect(forwardVit?.anchor?.justification).toContain('inductive bias')

    const forwardCnn = ledgerStore.findEdge('ViT-vs-CNN-Analysis', 'CNN', 'derived_from')
    expect(forwardCnn).toBeDefined()
    expect(forwardCnn?.provenance).toBe('document_claim')

    // Reciprocal backlink edges
    const reciprocalVit = ledgerStore.findEdge('ViT', 'ViT-vs-CNN-Analysis', 'details')
    expect(reciprocalVit).toBeDefined()
    expect(reciprocalVit?.provenance).toBe('canvas_relational')

    const reciprocalCnn = ledgerStore.findEdge('CNN', 'ViT-vs-CNN-Analysis', 'details')
    expect(reciprocalCnn).toBeDefined()
    expect(reciprocalCnn?.provenance).toBe('canvas_relational')

    // 3. Verify index.md
    const indexDoc = await adapter.getDocument('index.md')
    expect(indexDoc).not.toBeNull()
    const indexTexts = indexDoc?.blocks.flatMap((b) => b.children?.map((c) => c.text) || [])
    expect(indexTexts?.some((t) => t?.includes('[[ViT-vs-CNN-Analysis]]'))).toBe(true)

    // 4. Verify log.md
    const logDoc = await adapter.getDocument('log.md')
    expect(logDoc).not.toBeNull()
    const logTexts = logDoc?.blocks.flatMap((b) => b.children?.map((c) => c.text) || [])
    expect(logTexts?.some((t) => t?.includes('query | ViT-vs-CNN-Analysis'))).toBe(true)
  })

  it('rolls back all mutations on error (ADR-005 transaction rollback)', async () => {
    const failingAdapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
    const originalSave = failingAdapter.saveDocument.bind(failingAdapter)
    failingAdapter.saveDocument = async (name, payload) => {
      if (name === 'index.md') {
        throw new Error('Simulated write failure on index.md')
      }
      return originalSave(name, payload)
    }

    const input: QueryAndFileBackInput = {
      query: 'Test rollback',
      targetEntity: 'FailedSynthesis',
      synthesisTitle: 'Failed Synthesis',
      synthesisContent: 'Some content',
      referencedEntities: ['ViT'],
      relationToReferences: 'details',
      justification: 'Test reason'
    }

    await expect(executeQueryAndFileBack(input, failingAdapter)).rejects.toThrow(
      'Simulated write failure on index.md'
    )

    // Verify complete rollback:
    expect(await failingAdapter.getDocument('FailedSynthesis')).toBeNull()
    expect(await failingAdapter.getDocument('index.md')).toBeNull()
    expect(await failingAdapter.getDocument('log.md')).toBeNull()
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
  })

  it('invokes via LangChain tool wrapper', async () => {
    const input: QueryAndFileBackInput = {
      query: 'Summarize CNN strengths',
      targetEntity: 'CNN-Summary',
      synthesisTitle: 'CNN Architectural Strengths',
      synthesisContent: 'CNNs excel at translation invariance and sample efficiency.',
      referencedEntities: ['CNN'],
      relationToReferences: 'details',
      justification: 'Literature synthesis'
    }

    const result = await queryAndFileBack.invoke(input, {
      configurable: { adapter, indexManager }
    })

    expect(result.status).toBe('success')
    expect(result.targetEntity).toBe('CNN-Summary')
    expect(await adapter.getDocument('CNN-Summary')).not.toBeNull()
    expect(ledgerStore.getAllEdges()).toHaveLength(2)
  })
})
