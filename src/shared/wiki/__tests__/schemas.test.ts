import { describe, it, expect } from 'vitest'
import {
  ClaimRelationEnum,
  EdgeProvenanceEnum,
  ClaimBadgeSchema,
  RelationalLedgerEntrySchema,
  WorkspaceEntitySchema,
  IngestSourceInputSchema
} from '../schemas'
import { InlineRunSchema, InstanceTypeSchema } from '../../schemas/instances'
import { WorkspaceErrorCode } from '../../errors/WorkspaceErrors'

describe('Shared Wiki Schemas & Types', () => {
  it('validates ClaimRelationEnum correctly', () => {
    expect(ClaimRelationEnum.safeParse('supports').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('contradicts').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('supersedes').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('details').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('derived_from').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('cites').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('relates_to').success).toBe(true)
    expect(ClaimRelationEnum.safeParse('invalid_rel').success).toBe(false)
  })

  it('validates InstanceTypeSchema includes ledger', () => {
    expect(InstanceTypeSchema.safeParse('document').success).toBe(true)
    expect(InstanceTypeSchema.safeParse('canvas').success).toBe(true)
    expect(InstanceTypeSchema.safeParse('ledger').success).toBe(true)
    expect(InstanceTypeSchema.safeParse('unknown').success).toBe(false)
  })

  it('validates RelationalLedgerEntrySchema for canvas_relational and document_claim', () => {
    const canvasEntry = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      sourceEntityId: 'CNN',
      targetEntityId: 'ViT',
      rel: 'supersedes',
      provenance: 'canvas_relational',
      canvasContext: {
        label: 'supersedes',
        createdVia: 'writeGraph'
      },
      status: 'active',
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'agent'
      }
    }
    expect(RelationalLedgerEntrySchema.safeParse(canvasEntry).success).toBe(true)

    const docClaimEntry = {
      id: '550e8400-e29b-41d4-a716-446655440001',
      sourceEntityId: 'CNN',
      targetEntityId: 'ViT',
      rel: 'supersedes',
      provenance: 'document_claim',
      anchor: {
        blockId: 'blk_01HZX89',
        justification: 'Vision Transformers outperform CNNs on large datasets'
      },
      status: 'active',
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user'
      }
    }
    expect(RelationalLedgerEntrySchema.safeParse(docClaimEntry).success).toBe(true)
  })

  it('validates ClaimBadge embedded in InlineRunSchema', () => {
    const inlineRun = {
      text: 'Vision Transformers achieve SOTA',
      bold: true,
      claimBadge: {
        badgeId: 'badge-123',
        targetEntityId: 'transformer-architecture',
        rel: 'details',
        justification: 'Explains attention mechanism'
      }
    }
    const result = InlineRunSchema.safeParse(inlineRun)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.claimBadge?.targetEntityId).toBe('transformer-architecture')
    }
  })

  it('validates WorkspaceEntitySchema', () => {
    const entity = {
      id: 'transformer-architecture',
      type: 'concept',
      title: 'Transformer Architecture',
      facets: {
        contentInstanceId: 'doc-uuid-1',
        ledgerInstanceId: 'ledger-default',
        layoutInstanceId: 'canvas-uuid-1'
      },
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        tags: ['deep-learning', 'attention'],
        sourceOfTruth: 'ledger'
      }
    }
    expect(WorkspaceEntitySchema.safeParse(entity).success).toBe(true)
  })

  it('validates EdgeProvenanceEnum and ClaimBadgeSchema', () => {
    expect(EdgeProvenanceEnum.safeParse('canvas_relational').success).toBe(true)
    expect(EdgeProvenanceEnum.safeParse('document_claim').success).toBe(true)
    expect(EdgeProvenanceEnum.safeParse('invalid').success).toBe(false)

    const badge = {
      badgeId: 'b-1',
      targetEntityId: 'e-1',
      rel: 'supports',
      justification: 'Ground truth evidence'
    }
    expect(ClaimBadgeSchema.safeParse(badge).success).toBe(true)
  })

  it('validates IngestSourceInputSchema', () => {
    const input = {
      sourceTitle: 'Attention Is All You Need',
      sourceType: 'paper',
      rawContent: 'Ashish Vaswani et al...',
      claims: [
        {
          targetEntity: 'transformer-architecture',
          rel: 'details',
          claimText: 'Proposes multi-head self-attention mechanism',
          justification: 'Section 3.2'
        }
      ],
      summary: 'Foundational transformer paper'
    }
    expect(IngestSourceInputSchema.safeParse(input).success).toBe(true)
  })

  it('verifies WorkspaceErrorCode contains all wiki error codes', () => {
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_ENTITY_COLLISION).toBe(
      'WORKSPACE_WIKI_ENTITY_COLLISION'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL).toBe(
      'WORKSPACE_WIKI_UNRESOLVED_SYMBOL'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE).toBe(
      'WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_CYCLE_DETECTED).toBe('WORKSPACE_WIKI_CYCLE_DETECTED')
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_COMPILATION_FAILED).toBe(
      'WORKSPACE_WIKI_COMPILATION_FAILED'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA).toBe(
      'WORKSPACE_WIKI_INVALID_LINK_SCHEMA'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND).toBe(
      'WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED).toBe(
      'WORKSPACE_WIKI_LEDGER_SYNC_FAILED'
    )
    expect(WorkspaceErrorCode.WORKSPACE_WIKI_MIGRATION_FAILED).toBe(
      'WORKSPACE_WIKI_MIGRATION_FAILED'
    )
  })
})
