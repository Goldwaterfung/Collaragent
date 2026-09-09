import { z } from 'zod'
import {
  ClaimRelationEnum,
  EdgeProvenanceEnum,
  EntityTypeEnum,
  ClaimBadgeSchema,
  RelationalLedgerEntrySchema,
  WorkspaceEntitySchema,
  IngestSourceInputSchema,
  QueryAndFileBackInputSchema,
  LintWorkspaceInputSchema,
  CompileGraphInputSchema,
  CompileGraphResultSchema,
  L2CategoryEnum,
  L2SemanticDiagnosticSchema,
  L2AuditResultSchema
} from './schemas'
import type { WorkspaceErrorCode } from '../errors/WorkspaceErrors'

export type ClaimRelation = z.infer<typeof ClaimRelationEnum>
export type EdgeProvenance = z.infer<typeof EdgeProvenanceEnum>
export type EntityType = z.infer<typeof EntityTypeEnum>
export type ClaimBadge = z.infer<typeof ClaimBadgeSchema>
export type RelationalLedgerEntry = z.infer<typeof RelationalLedgerEntrySchema>
export type WorkspaceEntity = z.infer<typeof WorkspaceEntitySchema>
export type IngestSourceInput = z.infer<typeof IngestSourceInputSchema>
export type QueryAndFileBackInput = z.infer<typeof QueryAndFileBackInputSchema>
export type LintWorkspaceInput = z.infer<typeof LintWorkspaceInputSchema>
export type CompileGraphInput = z.infer<typeof CompileGraphInputSchema>
export type CompileGraphResult = z.infer<typeof CompileGraphResultSchema>
export type L2Category = z.infer<typeof L2CategoryEnum>
export type L2SemanticDiagnostic = z.infer<typeof L2SemanticDiagnosticSchema>
export type L2AuditResult = z.infer<typeof L2AuditResultSchema>

export interface CompiledGraphProjection {
  workspaceId: string
  entities: Record<string, { id: string; title: string; type: EntityType }>
  nodes: Array<{
    id: string
    entity: string
    group?: string
    layout: { x: number; y: number; width: number; height: number }
    memo?: string
    hasMemo: boolean
  }>
  edges: Array<{
    id: string
    from: string
    to: string
    rel: ClaimRelation
    label?: string
    provenance: EdgeProvenance
    anchorBlockId?: string
    status: 'active' | 'anchor_lost'
  }>
  unresolvedSymbols: Array<{ fromEntity: string; targetEntity: string; edgeId: string }>
  compiledAt: string
}

export interface L1Diagnostic {
  code: WorkspaceErrorCode
  severity: 'error' | 'warning'
  message: string
  entityId: string
  edgeId?: string
  anchorBlockId?: string
}

export interface L1AuditResult {
  valid: boolean
  errors: L1Diagnostic[]
  warnings: L1Diagnostic[]
  compiledAt: string
}
