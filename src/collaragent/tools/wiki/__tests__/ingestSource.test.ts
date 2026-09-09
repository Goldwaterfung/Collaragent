import { describe, it, expect, beforeEach } from 'vitest'
import { executeIngestSource, ingestSource } from '../ingestSource'
import { MemoryWikiWorkspaceAdapter } from '../adapters'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { WorkspaceErrorCode, WorkspaceError } from '@shared/errors/WorkspaceErrors'
import type { IngestSourceInput } from '@shared/wiki'

describe('ingestSource (Spec §7.2 & SC-7 Atomic Parity)', () => {
  let adapter: MemoryWikiWorkspaceAdapter
  let ledgerStore: RelationalLedgerStore

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    adapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
  })

  it('completes full atomic ingestion across source doc, 3 concept docs, ledger edges, index.md, and log.md', async () => {
    const input: IngestSourceInput = {
      sourceTitle: 'Attention Is All You Need',
      sourceType: 'paper',
      rawContent: 'We propose the Transformer, a model architecture eschewing recurrence...',
      summary: 'Introduced the self-attention based Transformer architecture replacing RNNs.',
      claims: [
        {
          targetEntity: 'Transformer',
          rel: 'details',
          claimText: 'The Transformer relies entirely on self-attention mechanisms.',
          justification: 'Section 1 introduction and architecture'
        },
        {
          targetEntity: 'Self-Attention',
          rel: 'supports',
          claimText: 'Self-attention connects all positions with a constant number of operations.',
          justification: 'Section 3.1 self-attention complexity analysis'
        },
        {
          targetEntity: 'RNN',
          rel: 'supersedes',
          claimText:
            'Transformer achieves superior translation quality while being more parallelizable than RNNs.',
          justification: 'Table 2 WMT 2014 translation results'
        }
      ]
    }

    const result = await executeIngestSource(input, adapter)
    expect(result.status).toBe('success')
    expect(result.sourceTitle).toBe('Attention Is All You Need')
    expect(result.createdDocuments).toContain('Attention Is All You Need')
    expect(result.createdDocuments).toContain('Transformer')
    expect(result.createdDocuments).toContain('Self-Attention')
    expect(result.createdDocuments).toContain('RNN')
    expect(result.edgesCreated).toBe(3)
    expect(result.indexUpdated).toBe(true)
    expect(result.logAppended).toBe(true)

    // 1. Verify Source Document
    const sourceDoc = await adapter.getDocument('Attention Is All You Need')
    expect(sourceDoc).not.toBeNull()
    expect(sourceDoc?.blocks[0].type).toBe('h1')
    expect(sourceDoc?.blocks[0].children?.[0].text).toBe('Attention Is All You Need')

    // 2. Verify Target Concept Documents have inline claim badges
    const transformerDoc = await adapter.getDocument('Transformer')
    expect(transformerDoc).not.toBeNull()
    expect(transformerDoc?.blocks[0].type).toBe('h1')
    expect(transformerDoc?.blocks[0].children?.[0].text).toBe('Transformer')
    const claimBlock = transformerDoc?.blocks[1]
    expect(claimBlock?.type).toBe('paragraph')
    expect(claimBlock?.children?.[0].text).toContain('relies entirely on self-attention')
    const badgeRun = claimBlock?.children?.[1]
    expect(badgeRun?.claimBadge).toBeDefined()
    expect(badgeRun?.claimBadge?.targetEntityId).toBe('Attention Is All You Need')
    expect(badgeRun?.claimBadge?.rel).toBe('details')

    // 3. Verify Ledger Store Edges
    const edges = ledgerStore.getAllEdges()
    expect(edges).toHaveLength(3)
    const supersedesEdge = edges.find((e) => e.rel === 'supersedes')
    expect(supersedesEdge).toBeDefined()
    expect(supersedesEdge?.sourceEntityId).toBe('Attention Is All You Need')
    expect(supersedesEdge?.targetEntityId).toBe('RNN')
    expect(supersedesEdge?.provenance).toBe('document_claim')
    expect(supersedesEdge?.status).toBe('active')

    // 4. Verify index.md
    const indexDoc = await adapter.getDocument('index.md')
    expect(indexDoc).not.toBeNull()
    const indexTexts = indexDoc?.blocks.flatMap((b) => b.children?.map((c) => c.text) || [])
    expect(indexTexts?.some((t) => t?.includes('[[Attention Is All You Need]]'))).toBe(true)
    expect(indexTexts?.some((t) => t?.includes('[[Transformer]]'))).toBe(true)

    // 5. Verify log.md
    const logDoc = await adapter.getDocument('log.md')
    expect(logDoc).not.toBeNull()
    const logTexts = logDoc?.blocks.flatMap((b) => b.children?.map((c) => c.text) || [])
    expect(logTexts?.some((t) => t?.includes('ingest | Attention Is All You Need'))).toBe(true)
  })

  it('preserves existing content when appending claims to existing concept document', async () => {
    // Pre-populate concept doc
    await adapter.saveDocument('CNN', {
      blocks: [
        {
          id: 'b-init-1',
          type: 'h1',
          children: [{ text: 'Convolutional Neural Networks' }]
        },
        {
          id: 'b-init-2',
          type: 'paragraph',
          children: [{ text: 'CNNs use sliding kernel convolution layers.' }]
        }
      ]
    })

    const input: IngestSourceInput = {
      sourceTitle: 'AlexNet Paper',
      sourceType: 'paper',
      rawContent: 'ImageNet Classification with Deep CNNs...',
      summary: 'Showed GPUs can train deep CNNs on ImageNet.',
      claims: [
        {
          targetEntity: 'CNN',
          rel: 'supports',
          claimText: 'AlexNet proved deep CNN scalability.',
          justification: 'ImageNet Top-5 error drop'
        }
      ]
    }

    const result = await executeIngestSource(input, adapter)
    expect(result.status).toBe('success')
    expect(result.updatedDocuments).toContain('CNN')

    const cnnDoc = await adapter.getDocument('CNN')
    expect(cnnDoc?.blocks).toHaveLength(3)
    expect(cnnDoc?.blocks[1].children?.[0].text).toContain('sliding kernel convolution layers')
    expect(cnnDoc?.blocks[2].children?.[0].text).toContain('AlexNet proved deep CNN scalability')
  })

  it('rolls back all changes completely when Tarjan cycle detection catches circular supersedence (SC-7)', async () => {
    // Set up existing edge: ViT supersedes CNN
    ledgerStore.upsertEdge({
      id: '550e8400-e29b-41d4-a716-446655440020',
      sourceEntityId: 'ViT',
      targetEntityId: 'CNN',
      rel: 'supersedes',
      provenance: 'document_claim',
      status: 'active',
      anchor: { blockId: 'b-1', justification: 'ViT outperforms CNN' },
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent'
      }
    })
    expect(ledgerStore.getAllEdges()).toHaveLength(1)

    // Now try to ingest a source that introduces CNN supersedes ViT (creating a cycle: ViT -> CNN -> ViT)
    const cyclicInput: IngestSourceInput = {
      sourceTitle: 'ConvNeXt Paper',
      sourceType: 'paper',
      rawContent: 'A ConvNet for the 2020s...',
      summary: 'Modernizing CNNs to match ViT performance.',
      claims: [
        {
          targetEntity: 'Modern CNN',
          rel: 'details',
          claimText: 'ConvNeXt redesigns standard ResNet blocks.',
          justification: 'Section 2'
        },
        {
          targetEntity: 'CNN',
          rel: 'supersedes',
          claimText: 'ConvNeXt supersedes ViT on throughput and accuracy.',
          justification: 'Benchmark comparison'
        }
      ]
    }

    // Must throw WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE
    let thrownError: unknown
    try {
      // Note: sourceTitle is ConvNeXt Paper. If claim says targetEntity: 'CNN' with rel: 'supersedes',
      // wait: edge is sourceTitle -> CNN.
      // To create cycle: ViT -> ConvNeXt Paper -> ViT.
      // Let's create an existing edge: ConvNeXt Paper -> CNN, and here claim is: targetEntity: ViT with rel supersedes.
      // Let's create a cycle: CNN -> ViT, and candidate is ViT -> CNN.
      // Let sourceTitle be "CNN" to directly trigger CNN -> ViT!
      const directCycleInput: IngestSourceInput = {
        sourceTitle: 'CNN',
        sourceType: 'article',
        rawContent: 'Historical review',
        summary: 'Review',
        claims: [
          {
            targetEntity: 'ViT',
            rel: 'supersedes',
            claimText: 'Contradictory claim: CNN supersedes ViT.',
            justification: 'Flawed reasoning'
          }
        ]
      }
      await executeIngestSource(directCycleInput, adapter)
      expect.fail('Should have failed with circular supersedence')
    } catch (err) {
      thrownError = err
    }

    expect(thrownError).toBeInstanceOf(WorkspaceError)
    const wErr = thrownError as WorkspaceError
    expect(wErr.code).toBe(WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE)

    // Verify FULL ROLLBACK:
    // 1. Source doc was NOT left behind
    const sourceDoc = await adapter.getDocument('CNN')
    expect(sourceDoc).toBeNull()

    // 2. Target doc ViT was NOT created
    const targetDoc = await adapter.getDocument('ViT')
    expect(targetDoc).toBeNull()

    // 3. index.md was NOT created
    const indexDoc = await adapter.getDocument('index.md')
    expect(indexDoc).toBeNull()

    // 4. log.md was NOT created
    const logDoc = await adapter.getDocument('log.md')
    expect(logDoc).toBeNull()

    // 5. Ledger store still has ONLY the original 1 edge
    expect(ledgerStore.getAllEdges()).toHaveLength(1)
    expect(ledgerStore.getAllEdges()[0].sourceEntityId).toBe('ViT')
  })

  it('rolls back all prior documents and ledger mutations if saving log.md fails (SC-7 parity)', async () => {
    // Create an adapter that fails when saving log.md
    const failingAdapter = new MemoryWikiWorkspaceAdapter(ledgerStore)
    const originalSave = failingAdapter.saveDocument.bind(failingAdapter)
    failingAdapter.saveDocument = async (name, payload) => {
      if (name === 'log.md') {
        throw new Error('Simulated disk full error on log.md')
      }
      return originalSave(name, payload)
    }

    const input: IngestSourceInput = {
      sourceTitle: 'ResNet Paper',
      sourceType: 'paper',
      rawContent: 'Deep Residual Learning for Image Recognition...',
      summary: 'Introduced residual skip connections to train ultra-deep networks.',
      claims: [
        {
          targetEntity: 'ResNet',
          rel: 'details',
          claimText: 'Residual connections solve vanishing gradients.',
          justification: 'Section 3'
        },
        {
          targetEntity: 'Skip Connection',
          rel: 'supports',
          claimText: 'Identity mapping enables optimization of 100+ layer networks.',
          justification: 'Figure 2'
        }
      ]
    }

    await expect(executeIngestSource(input, failingAdapter)).rejects.toThrow(
      'Simulated disk full error on log.md'
    )

    // Verify strict transactional rollback:
    expect(await failingAdapter.getDocument('ResNet Paper')).toBeNull()
    expect(await failingAdapter.getDocument('ResNet')).toBeNull()
    expect(await failingAdapter.getDocument('Skip Connection')).toBeNull()
    expect(await failingAdapter.getDocument('index.md')).toBeNull()
    expect(await failingAdapter.getDocument('log.md')).toBeNull()
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
  })

  it('invokes via LangChain tool interface with configurable adapter', async () => {
    const input = {
      sourceTitle: 'Dropout Paper',
      sourceType: 'paper' as const,
      rawContent: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
      summary: 'Randomly dropping units during training prevents co-adaptation.',
      claims: [
        {
          targetEntity: 'Regularization',
          rel: 'supports' as const,
          claimText: 'Dropout significantly reduces overfitting.',
          justification: 'Empirical MNIST and CIFAR results'
        }
      ]
    }

    const result = await ingestSource.invoke(input, {
      configurable: { adapter }
    })

    expect(result.status).toBe('success')
    expect(result.sourceTitle).toBe('Dropout Paper')
    expect(await adapter.getDocument('Dropout Paper')).not.toBeNull()
    expect(await adapter.getDocument('Regularization')).not.toBeNull()
    expect(ledgerStore.getAllEdges()).toHaveLength(1)
  })
})
