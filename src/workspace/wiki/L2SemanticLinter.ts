import {
  type L2SemanticDiagnostic,
  type L2AuditResult,
  type RelationalLedgerEntry
} from '@shared/wiki'
import { type WikiWorkspaceAdapter, MemoryWikiWorkspaceAdapter } from './adapter'
import { createFsWikiWorkspaceAdapter, normalizeEntityTitle } from './L1StructuralLinter'
import type { DocumentPayload } from '@workspace/persistence/editorContent'

export interface L2AuditOptions {
  workspace: WikiWorkspaceAdapter | string
  invokeModel?: (prompt: string) => Promise<string>
}

const MIN_MENTION_TOKEN_LENGTH = 3
const SYSTEM_META_DOCS = new Set(['index', 'index.md', 'log', 'log.md'])

/**
 * Extracts plain text from document blocks for text matching.
 */
function extractDocumentPlainText(doc: DocumentPayload | null): string {
  if (!doc?.blocks || !Array.isArray(doc.blocks)) return ''
  const parts: string[] = []

  for (const block of doc.blocks) {
    if (typeof block !== 'object' || block === null) continue
    if (block.children && Array.isArray(block.children)) {
      for (const run of block.children) {
        if (typeof run.text === 'string') parts.push(run.text)
        if (typeof run.claimBadge?.justification === 'string') {
          parts.push(run.claimBadge.justification)
        }
      }
    }
    if (typeof block.content === 'string') {
      parts.push(block.content)
    }
  }

  return parts.join(' ')
}

/**
 * Gathers existing claim targets referenced in a document AST.
 */
function extractReferencedEntitiesFromDoc(doc: DocumentPayload | null): Set<string> {
  const referenced = new Set<string>()
  if (!doc?.blocks || !Array.isArray(doc.blocks)) return referenced

  for (const block of doc.blocks) {
    if (typeof block !== 'object' || block === null) continue
    if (block.children && Array.isArray(block.children)) {
      for (const run of block.children) {
        if (run.claimBadge?.targetEntityId) {
          referenced.add(normalizeEntityTitle(run.claimBadge.targetEntityId))
        }
      }
    }
  }

  return referenced
}

/**
 * 1. Audits contradictions (rel === 'contradicts').
 * Analyzes opposing claims and optionally invokes an LLM for nuanced scholarly resolution.
 */
async function auditContradictions(
  edges: RelationalLedgerEntry[],
  adapter: WikiWorkspaceAdapter,
  invokeModel?: (prompt: string) => Promise<string>
): Promise<L2SemanticDiagnostic[]> {
  const diagnostics: L2SemanticDiagnostic[] = []
  const contradictionEdges = edges.filter((e) => e.rel === 'contradicts' && e.status !== 'archived')

  for (const edge of contradictionEdges) {
    const sourceDoc = await adapter.getDocument(edge.sourceEntityId)
    const targetDoc = await adapter.getDocument(edge.targetEntityId)

    const justification = edge.anchor?.justification || 'Direct tension asserted.'
    let analysis = `Edge "${edge.id}" declares "${edge.sourceEntityId}" contradicts "${edge.targetEntityId}". Rationale: "${justification}".`
    let suggestedAction =
      'Review claim evidence and evaluate if findings are context-dependent or represent divergent methodologies.'

    if (invokeModel) {
      try {
        const sourceText = extractDocumentPlainText(sourceDoc).slice(0, 500)
        const targetText = extractDocumentPlainText(targetDoc).slice(0, 500)

        const prompt = [
          'You are a scholarly consistency auditor analyzing an academic knowledge graph.',
          `Source Entity: "${edge.sourceEntityId}"`,
          `Target Entity: "${edge.targetEntityId}"`,
          `Stated Contradiction Rationale: "${justification}"`,
          `Source Context: "${sourceText}"`,
          `Target Context: "${targetText}"`,
          'Analyze whether this contradiction is an intended theoretical debate (e.g. paradigm divergence) or an unresolved factual error.',
          'Provide a 2-sentence assessment and 1 recommended action.'
        ].join('\n')

        const llmResponse = await invokeModel(prompt)
        if (llmResponse.trim().length > 0) {
          analysis = llmResponse.trim()
          suggestedAction =
            'Synthesize comparative literature review or conduct empirical validation to address the debate.'
        }
      } catch (err: unknown) {
        console.warn(
          `[L2SemanticLinter] LLM contradiction audit failed for edge "${edge.id}":`,
          err
        )
      }
    }

    diagnostics.push({
      category: 'contradiction',
      severity: 'warning',
      entityId: edge.sourceEntityId,
      targetEntityId: edge.targetEntityId,
      edgeId: edge.id,
      title: `Contradiction: ${edge.sourceEntityId} vs. ${edge.targetEntityId}`,
      analysis,
      suggestedAction
    })
  }

  return diagnostics
}

/**
 * 2. Audits staleness and supersedence dependencies (rel === 'supersedes').
 * Detects downstream documents that still rely on older superseded claims.
 */
function auditStaleness(edges: RelationalLedgerEntry[]): L2SemanticDiagnostic[] {
  const diagnostics: L2SemanticDiagnostic[] = []
  const supersedesEdges = edges.filter((e) => e.rel === 'supersedes' && e.status !== 'archived')

  for (const supEdge of supersedesEdges) {
    const newerEntity = supEdge.sourceEntityId
    const olderEntity = supEdge.targetEntityId

    // Find other edges that still depend on the older entity
    const dependentEdges = edges.filter(
      (e) =>
        e.targetEntityId === olderEntity &&
        e.sourceEntityId !== newerEntity &&
        e.rel !== 'supersedes' &&
        e.status === 'active'
    )

    for (const dep of dependentEdges) {
      // Check if the dependent also cites the newer entity
      const citesNewer = edges.some(
        (e) =>
          e.sourceEntityId === dep.sourceEntityId &&
          e.targetEntityId === newerEntity &&
          e.status === 'active'
      )

      if (!citesNewer) {
        diagnostics.push({
          category: 'staleness',
          severity: 'warning',
          entityId: dep.sourceEntityId,
          targetEntityId: olderEntity,
          edgeId: dep.id,
          title: `Stale Dependency: "${dep.sourceEntityId}" cites superseded entity "${olderEntity}"`,
          analysis: `"${dep.sourceEntityId}" links to "${olderEntity}" via ${dep.rel}, but "${olderEntity}" was superseded by "${newerEntity}".`,
          suggestedAction: `Verify whether "${dep.sourceEntityId}" should be updated to cite "${newerEntity}" instead.`
        })
      }
    }
  }

  return diagnostics
}

/**
 * 3. Audits implicit entity mentions.
 * Scans document prose for mentions of known entities that lack an explicit claim badge or link.
 */
async function auditImplicitMentions(
  adapter: WikiWorkspaceAdapter,
  docList: Array<{ name: string; instanceId: string }>
): Promise<L2SemanticDiagnostic[]> {
  const diagnostics: L2SemanticDiagnostic[] = []

  const entityTitles = docList
    .map((d) => d.name)
    .filter((name) => !SYSTEM_META_DOCS.has(name) && name.length >= MIN_MENTION_TOKEN_LENGTH)

  for (const { name: docName } of docList) {
    if (SYSTEM_META_DOCS.has(docName)) continue

    const doc = await adapter.getDocument(docName)
    if (!doc) continue

    const plainText = extractDocumentPlainText(doc).toLowerCase()
    const referencedEntities = extractReferencedEntitiesFromDoc(doc)
    const normalizedDocName = normalizeEntityTitle(docName)

    for (const targetName of entityTitles) {
      const normalizedTarget = normalizeEntityTitle(targetName)
      if (normalizedTarget === normalizedDocName) continue
      if (referencedEntities.has(normalizedTarget)) continue

      // Regex matching whole word / phrase
      const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(`\\b${escaped}\\b`, 'i')

      if (pattern.test(plainText)) {
        diagnostics.push({
          category: 'implicit_mention',
          severity: 'info',
          entityId: docName,
          targetEntityId: targetName,
          title: `Implicit Mention: "${docName}" mentions "${targetName}" without explicit link`,
          analysis: `"${docName}" refers to "${targetName}" in text, but no inline claim badge or wikilink is anchored to it.`,
          suggestedAction: `Consider adding an inline claim badge [[relates_to:${targetName}]] to formalize the association.`
        })
      }
    }
  }

  return diagnostics
}

/**
 * 4. Audits proactive research gaps.
 * Identifies concept documents that have sparse or missing connections across the graph.
 */
function auditResearchGaps(
  edges: RelationalLedgerEntry[],
  docList: Array<{ name: string; instanceId: string }>
): L2SemanticDiagnostic[] {
  const diagnostics: L2SemanticDiagnostic[] = []
  const activeEdges = edges.filter((e) => e.status !== 'archived')

  // Calculate degrees
  const degrees = new Map<string, number>()
  for (const doc of docList) {
    if (!SYSTEM_META_DOCS.has(doc.name) && !doc.name.startsWith('sources/')) {
      degrees.set(doc.name, 0)
    }
  }

  for (const edge of activeEdges) {
    degrees.set(edge.sourceEntityId, (degrees.get(edge.sourceEntityId) ?? 0) + 1)
    degrees.set(edge.targetEntityId, (degrees.get(edge.targetEntityId) ?? 0) + 1)
  }

  for (const [entityName, degree] of degrees.entries()) {
    if (degree === 0) {
      diagnostics.push({
        category: 'research_gap',
        severity: 'info',
        entityId: entityName,
        title: `Isolated Concept: "${entityName}" has zero active connections`,
        analysis: `"${entityName}" is isolated in the graph with degree 0. It lacks supporting literature or relational ties.`,
        suggestedAction: `Ground "${entityName}" by linking to literature sources or integrating it with parent constructs.`
      })
    }
  }

  return diagnostics
}

/**
 * Executes a comprehensive L2 semantic audit on top of an existing workspace adapter or directory.
 */
export async function runL2SemanticAudit(options: L2AuditOptions): Promise<L2AuditResult> {
  const adapter: WikiWorkspaceAdapter =
    typeof options.workspace === 'string'
      ? await createFsWikiWorkspaceAdapter(options.workspace)
      : options.workspace

  const ledgerStore = adapter.getLedgerStore()
  const edges = ledgerStore.getAllEdges()

  let docItems: Array<{ name: string; instanceId: string }> = []
  if (adapter.listDocuments) {
    docItems = await adapter.listDocuments()
  } else if (adapter instanceof MemoryWikiWorkspaceAdapter) {
    docItems = adapter.getAllDocumentNames().map((name) => ({ name, instanceId: name }))
  }

  const contradictions = await auditContradictions(edges, adapter, options.invokeModel)
  const staleness = auditStaleness(edges)
  const implicitMentions = await auditImplicitMentions(adapter, docItems)
  const researchGaps = auditResearchGaps(edges, docItems)

  const allDiagnostics = [...contradictions, ...staleness, ...implicitMentions, ...researchGaps]

  return {
    valid: contradictions.length === 0 && staleness.length === 0,
    diagnostics: allDiagnostics,
    contradictionCount: contradictions.length,
    staleClaimsCount: staleness.length,
    implicitMentionsCount: implicitMentions.length,
    researchGapsCount: researchGaps.length,
    auditedAt: new Date().toISOString()
  }
}

/**
 * Formats an L2AuditResult into a structured Markdown report.
 */
export function formatL2AuditReport(result: L2AuditResult): string {
  const lines: string[] = [
    '# Workspace L2 Semantic Audit Report',
    '',
    `**Status**: ${result.valid ? '✅ PASSED (No Unresolved Tensions)' : '⚠️ ATTENTION REQUIRED (Semantic Tensions Detected)'}`,
    `**Contradictions**: ${result.contradictionCount} | **Stale Dependencies**: ${result.staleClaimsCount} | **Implicit Mentions**: ${result.implicitMentionsCount} | **Research Gaps**: ${result.researchGapsCount}`,
    `**Audited At**: ${result.auditedAt}`,
    ''
  ]

  const contradictions = result.diagnostics.filter((d) => d.category === 'contradiction')
  if (contradictions.length > 0) {
    lines.push('## ⚡ Contradictions & Theoretical Tensions')
    lines.push('')
    for (const [idx, d] of contradictions.entries()) {
      lines.push(`### ${idx + 1}. ${d.title}`)
      lines.push(`- **Analysis**: ${d.analysis}`)
      if (d.suggestedAction) {
        lines.push(`- **Recommendation**: ${d.suggestedAction}`)
      }
      lines.push('')
    }
  }

  const staleness = result.diagnostics.filter((d) => d.category === 'staleness')
  if (staleness.length > 0) {
    lines.push('## ⏳ Staleness & Supersedence Dependencies')
    lines.push('')
    for (const [idx, d] of staleness.entries()) {
      lines.push(`### ${idx + 1}. ${d.title}`)
      lines.push(`- **Analysis**: ${d.analysis}`)
      if (d.suggestedAction) {
        lines.push(`- **Recommendation**: ${d.suggestedAction}`)
      }
      lines.push('')
    }
  }

  const implicitMentions = result.diagnostics.filter((d) => d.category === 'implicit_mention')
  if (implicitMentions.length > 0) {
    lines.push('## 🔗 Missing Cross-References (Implicit Mentions)')
    lines.push('')
    for (const [idx, d] of implicitMentions.entries()) {
      lines.push(`### ${idx + 1}. ${d.title}`)
      lines.push(`- **Analysis**: ${d.analysis}`)
      if (d.suggestedAction) {
        lines.push(`- **Recommendation**: ${d.suggestedAction}`)
      }
      lines.push('')
    }
  }

  const researchGaps = result.diagnostics.filter((d) => d.category === 'research_gap')
  if (researchGaps.length > 0) {
    lines.push('## 🧭 Proactive Research Gaps & Isolated Concepts')
    lines.push('')
    for (const [idx, d] of researchGaps.entries()) {
      lines.push(`### ${idx + 1}. ${d.title}`)
      lines.push(`- **Analysis**: ${d.analysis}`)
      if (d.suggestedAction) {
        lines.push(`- **Recommendation**: ${d.suggestedAction}`)
      }
      lines.push('')
    }
  }

  if (result.diagnostics.length === 0) {
    lines.push(
      'No semantic tensions, stale dependencies, or unlinked mentions detected. The wiki is conceptually cohesive.'
    )
  }

  return lines.join('\n')
}
