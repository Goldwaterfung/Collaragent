import { z } from 'zod'

export const ClaimRelationEnum = z.enum([
  'supports', // Evidence or claim affirming the target
  'contradicts', // Evidence or claim in direct tension/conflict
  'supersedes', // Updated version replacing older claim/data
  'details', // Hierarchical elaboration or breakdown
  'derived_from', // Provenance / lineage
  'cites', // Reference to raw source material
  'relates_to' // General associational link
])

export const EdgeProvenanceEnum = z.enum([
  'canvas_relational', // Ideation: Created visually on canvas or via writeGraph (unanchored)
  'document_claim' // Crystallization: Anchored to a specific Lexical block with justification
])

export const EntityTypeEnum = z.enum(['concept', 'source', 'claim', 'synthesis', 'log', 'page'])

export const ClaimBadgeSchema = z.object({
  badgeId: z.string().min(1).describe('Unique ID of the claim badge.'),
  targetEntityId: z.string().min(1).describe('Target entity ID or slug.'),
  rel: ClaimRelationEnum.describe('Typed relational predicate.'),
  justification: z.string().describe('Human/Agent justification explaining the connection.')
})

export const RelationalLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  rel: ClaimRelationEnum,
  provenance: EdgeProvenanceEnum,

  // Populated when provenance === 'document_claim'
  anchor: z
    .object({
      blockId: z.string().min(1),
      justification: z.string(),
      selectedTextSnippet: z.string().optional()
    })
    .optional(),

  // Populated when provenance === 'canvas_relational'
  canvasContext: z
    .object({
      label: z.string().optional(),
      createdVia: z.enum(['ui_drag', 'writeGraph']).optional()
    })
    .optional(),

  status: z.enum(['active', 'anchor_lost', 'archived']).default('active'),

  meta: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    author: z.enum(['user', 'agent'])
  })
})

export const WorkspaceEntitySchema = z.object({
  id: z.string().min(1),
  type: EntityTypeEnum,
  title: z.string().min(1),
  facets: z.object({
    contentInstanceId: z.string().min(1),
    ledgerInstanceId: z.string().min(1),
    layoutInstanceId: z.string().optional()
  }),
  meta: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    tags: z.array(z.string()),
    sourceOfTruth: z.literal('ledger')
  })
})

export const IngestSourceInputSchema = z.object({
  sourceTitle: z.string().min(1),
  sourceType: z.enum(['paper', 'article', 'dataset', 'meeting', 'interview']),
  rawContent: z.string(),
  claims: z.array(
    z.object({
      targetEntity: z.string().min(1),
      rel: ClaimRelationEnum,
      claimText: z.string().min(1),
      justification: z.string().min(1)
    })
  ),
  summary: z.string()
})

export const QueryAndFileBackInputSchema = z.object({
  query: z.string().min(1).describe('The synthesis question or query.'),
  targetEntity: z
    .string()
    .min(1)
    .describe('Title of the new or updated synthesis page to file back into the wiki.'),
  synthesisTitle: z.string().min(1).describe('Human-readable title of the synthesis document.'),
  synthesisContent: z.string().min(1).describe('The synthesized answer or content.'),
  referencedEntities: z
    .array(z.string().min(1))
    .min(1)
    .describe('List of entities/sources that this synthesis cites/references.'),
  relationToReferences: ClaimRelationEnum.default('derived_from').describe(
    'Relational predicate linking the synthesis to referenced entities.'
  ),
  justification: z
    .string()
    .min(1)
    .describe('Evidence or reason for the relationship between synthesis and referenced entities.'),
  summary: z.string().optional().describe('One-line summary for index.md.')
})

export const LintWorkspaceInputSchema = z.object({
  workspacePath: z
    .string()
    .optional()
    .describe(
      'Optional path to a .cagent archive or directory to lint. Defaults to the active workspace.'
    ),
  level: z
    .enum(['l1', 'l2', 'both'])
    .optional()
    .describe(
      'Audit tier: "l1" for structural deterministic checks, "l2" for semantic reasoning, or "both".'
    ),
  semantic: z
    .boolean()
    .optional()
    .describe(
      'Convenience flag: when true, enables L2 semantic audit alongside L1 structural checks.'
    ),
  compileToCanvas: z
    .boolean()
    .optional()
    .describe(
      'When true, compiles the validated document linkage and ledger to a concept canvas in SQLite if lint passes.'
    ),
  canvasName: z
    .string()
    .optional()
    .describe('Canvas instance name when compileToCanvas is true (defaults to "concept-canvas").'),
  projectName: z.string().optional().describe('Optional project name to scope the canvas instance.')
})

export const CompileGraphInputSchema = z.object({
  workspacePath: z
    .string()
    .optional()
    .describe(
      'Optional path to a .cagent archive or directory to compile. Defaults to the active workspace.'
    ),
  canvasName: z
    .string()
    .optional()
    .default('concept-canvas')
    .describe(
      'Name of the canvas instance in SQLite to store the compiled graph. Defaults to "concept-canvas".'
    ),
  projectName: z
    .string()
    .optional()
    .describe('Optional project name to scope the canvas instance.'),
  level: z
    .enum(['l1', 'l2', 'both'])
    .optional()
    .default('l1')
    .describe('Audit tier to execute before compiling: "l1", "l2", or "both". Defaults to "l1".'),
  failOnError: z
    .boolean()
    .optional()
    .default(true)
    .describe('Abort compilation if structural lint errors are detected (defaults to true).')
})

export const CompileGraphResultSchema = z.object({
  status: z.enum(['success', 'error']),
  valid: z.boolean(),
  instanceId: z.string().optional(),
  instanceName: z.string(),
  projectName: z.string().optional(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  relationsBreakdown: z.record(z.string(), z.number()),
  lintReport: z.string(),
  report: z.string()
})

export const L2CategoryEnum = z.enum([
  'contradiction',
  'staleness',
  'implicit_mention',
  'research_gap'
])

export const L2SemanticDiagnosticSchema = z.object({
  category: L2CategoryEnum,
  severity: z.enum(['warning', 'info']),
  entityId: z.string().min(1),
  targetEntityId: z.string().optional(),
  edgeId: z.string().optional(),
  title: z.string().min(1),
  analysis: z.string().min(1),
  suggestedAction: z.string().optional()
})

export const L2AuditResultSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(L2SemanticDiagnosticSchema),
  contradictionCount: z.number(),
  staleClaimsCount: z.number(),
  implicitMentionsCount: z.number(),
  researchGapsCount: z.number(),
  auditedAt: z.string()
})

export const PrunedEdgeReasonEnum = z.enum([
  'explicit_id',
  'incident_entity',
  'unresolved_source',
  'unresolved_target',
  'anchor_lost',
  'query_match'
])
export type PrunedEdgeReason = z.infer<typeof PrunedEdgeReasonEnum>

export const PrunedEdgeDetailSchema = z.object({
  id: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  rel: ClaimRelationEnum,
  provenance: EdgeProvenanceEnum,
  status: z.enum(['active', 'anchor_lost', 'archived']),
  reason: PrunedEdgeReasonEnum
})
export type PrunedEdgeDetail = z.infer<typeof PrunedEdgeDetailSchema>

export const PruneLedgerInputSchema = z
  .object({
    edgeId: z.string().optional().describe('Specific ledger edge UUID to remove.'),
    edgeIds: z
      .array(z.string())
      .optional()
      .describe('List of specific ledger edge UUIDs to remove.'),
    entityId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Entity/document name whose incident edges (both source and target) should be removed.'
      ),
    entityIds: z
      .array(z.string().min(1))
      .optional()
      .describe('List of entity/document names whose incident edges should be removed.'),
    sourceEntityId: z.string().optional().describe('Source document/entity name filter.'),
    targetEntityId: z.string().optional().describe('Target document/entity name filter.'),
    rel: ClaimRelationEnum.optional().describe('Relation predicate filter.'),
    provenance: EdgeProvenanceEnum.optional().describe(
      'Edge provenance filter (document_claim or canvas_relational).'
    ),
    pruneAllDegraded: z
      .boolean()
      .optional()
      .describe('If true, purges all edges with status: "anchor_lost".'),
    pruneUnresolved: z
      .boolean()
      .optional()
      .describe(
        'If true, purges all edges whose source or target document does not exist in the workspace.'
      ),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, simulates pruning and returns matched edges without mutating the ledger.'
      ),
    workspacePath: z.string().optional().describe('Optional workspace directory path.')
  })
  .refine(
    (data) =>
      Boolean(
        data.edgeId ||
        (data.edgeIds && data.edgeIds.length > 0) ||
        data.entityId ||
        (data.entityIds && data.entityIds.length > 0) ||
        data.sourceEntityId ||
        data.targetEntityId ||
        data.rel ||
        data.provenance ||
        data.pruneUnresolved ||
        data.pruneAllDegraded
      ),
    {
      message:
        'Must specify at least one pruning criterion (e.g. edgeId, edgeIds, entityId, entityIds, pruneUnresolved, or pruneAllDegraded).'
    }
  )

export type PruneLedgerInput = z.infer<typeof PruneLedgerInputSchema>

export const PruneLedgerResultSchema = z.object({
  status: z.enum(['success', 'error']),
  action: z.string(),
  dryRun: z.boolean(),
  edgesPruned: z.number(),
  prunedEdgeIds: z.array(z.string()),
  prunedEdges: z.array(PrunedEdgeDetailSchema),
  remainingEdgesCount: z.number(),
  report: z.string()
})

export type PruneLedgerResult = z.infer<typeof PruneLedgerResultSchema>
