import { tool } from '@langchain/core/tools'
import {
  LintWorkspaceInputSchema,
  type LintWorkspaceInput,
  type L1AuditResult,
  type L2AuditResult
} from '@shared/wiki'
import { runL1Audit } from '@workspace/wiki/L1StructuralLinter'
import { runL2SemanticAudit, formatL2AuditReport } from '@workspace/wiki/L2SemanticLinter'
import { compileWorkspace } from '@workspace/wiki/GraphCompiler'
import { type WikiWorkspaceAdapter, LiveWikiWorkspaceAdapter } from './adapters'
import { type ToolConnectionContext, extractErrorInfo } from '../WorkspaceTools'

/**
 * Formats an L1AuditResult into a structured Markdown diagnostic report.
 */
export function formatL1AuditReport(result: L1AuditResult): string {
  const lines: string[] = [
    '# Workspace L1 Structural Audit Report',
    '',
    `**Status**: ${result.valid ? '✅ PASSED (Graph Structurally Valid)' : '❌ FAILED (Integrity Violations Detected)'}`,
    `**Errors**: ${result.errors.length} | **Warnings**: ${result.warnings.length} | **Compiled At**: ${result.compiledAt}`,
    ''
  ]

  if (result.errors.length > 0) {
    lines.push('## 🛑 Integrity Errors')
    lines.push('')
    for (const [idx, err] of result.errors.entries()) {
      lines.push(`### ${idx + 1}. [${err.code}] Entity: \`${err.entityId}\``)
      lines.push(`- **Message**: ${err.message}`)
      if (err.edgeId) {
        lines.push(`- **Edge ID**: \`${err.edgeId}\``)
      }
      if (err.anchorBlockId) {
        lines.push(`- **Anchor Block ID**: \`${err.anchorBlockId}\``)
      }
      lines.push('')
    }
  }

  if (result.warnings.length > 0) {
    lines.push('## ⚠️ Warnings & Maintenance Suggestions')
    lines.push('')
    for (const [idx, warn] of result.warnings.entries()) {
      lines.push(`### ${idx + 1}. [${warn.code}] Entity: \`${warn.entityId}\``)
      lines.push(`- **Message**: ${warn.message}`)
      if (warn.edgeId) {
        lines.push(`- **Edge ID**: \`${warn.edgeId}\``)
      }
      lines.push('')
    }
  }

  if (result.valid && result.warnings.length === 0) {
    lines.push(
      'All wiki documents, claim anchors, and relational ledger edges are fully consistent and synchronized.'
    )
  }

  return lines.join('\n')
}

/**
 * Core implementation of lintWorkspace audit (supporting L1 structural and L2 semantic audits).
 */
export async function executeLintWorkspace(
  input: LintWorkspaceInput,
  adapter: WikiWorkspaceAdapter,
  invokeModel?: (prompt: string) => Promise<string>
): Promise<{ audit: L1AuditResult; l2Audit?: L2AuditResult; report: string }> {
  const runL2 = input.level === 'l2' || input.level === 'both' || Boolean(input.semantic)
  const runL1 = input.level === 'l1' || input.level === 'both' || input.level !== 'l2'

  const reportParts: string[] = []
  let audit: L1AuditResult = {
    valid: true,
    errors: [],
    warnings: [],
    compiledAt: new Date().toISOString()
  }
  let l2Audit: L2AuditResult | undefined

  if (runL1) {
    audit = input.workspacePath ? await runL1Audit(input.workspacePath) : await runL1Audit(adapter)
    reportParts.push(formatL1AuditReport(audit))
  }

  if (runL2) {
    l2Audit = input.workspacePath
      ? await runL2SemanticAudit({ workspace: input.workspacePath, invokeModel })
      : await runL2SemanticAudit({ workspace: adapter, invokeModel })
    reportParts.push(formatL2AuditReport(l2Audit))
  }

  if (input.compileToCanvas) {
    if (audit.valid) {
      const canvasName = input.canvasName?.trim() || 'concept-canvas'
      const compiled = await compileWorkspace(input.workspacePath ?? adapter, undefined, canvasName)
      let savedId: string | undefined
      if (adapter.saveCanvas) {
        savedId = await adapter.saveCanvas(canvasName, compiled)
      }
      const nodeCount = Object.keys(compiled.graph.nodes).length
      const edgeCount = Object.keys(compiled.graph.relationships).length
      reportParts.push(
        [
          '## 🗺️ Canvas Graph Materialization',
          '',
          `✅ Successfully compiled and persisted graph to canvas \`${canvasName}\`${savedId ? ` (ID: \`${savedId}\`)` : ''}.`,
          `- **Nodes**: ${nodeCount}`,
          `- **Relationships**: ${edgeCount}`,
          `- **Inspection**: Call \`readGraph({ instanceName: "${canvasName}" })\` to inspect.`
        ].join('\n')
      )
    } else {
      reportParts.push(
        '## 🗺️ Canvas Graph Materialization\n\n⚠️ Skipped canvas compilation due to structural integrity errors.'
      )
    }
  }

  return {
    audit,
    l2Audit,
    report: reportParts.join('\n\n---\n\n')
  }
}

/**
 * LangChain tool wrapper for lintWorkspace.
 */
export const lintWorkspace = tool(
  async (input, config) => {
    const context = config.configurable as
      | (ToolConnectionContext & {
          adapter?: WikiWorkspaceAdapter
          invokeModel?: (prompt: string) => Promise<string>
        })
      | undefined
    try {
      const adapter = context?.adapter ?? new LiveWikiWorkspaceAdapter(context)
      const result = await executeLintWorkspace(input, adapter, context?.invokeModel)
      return {
        status: (result.audit.valid ? 'success' : 'error') as 'success' | 'error',
        action: 'Linted Workspace',
        valid: result.audit.valid,
        errorCount: result.audit.errors.length,
        warningCount: result.audit.warnings.length,
        errors: result.audit.errors,
        warnings: result.audit.warnings,
        report: result.report
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to lint workspace',
        code,
        message,
        recommendFix,
        report: `# 🛑 Workspace Lint Error\n\n[${code}] ${message}\n\n${recommendFix ? `**Recommendation**: ${recommendFix}` : ''}`
      }
    }
  },
  {
    name: 'lintWorkspace',
    description: `Executes compilation audits across the workspace. L1 verifies deterministic structural integrity (unresolved wikilinks, broken claim badges, circular supersedes cycles, title collisions). L2 checks semantic consistency (unresolved contradictions, stale dependencies on superseded models, implicit mentions, research gaps).`,
    schema: LintWorkspaceInputSchema
  }
)
