import { tool } from '@langchain/core/tools'
import {
  CompileGraphInputSchema,
  type CompileGraphInput,
  type CompileGraphResult,
  type L1AuditResult,
  type L2AuditResult
} from '@shared/wiki'
import { runL1Audit } from '@workspace/wiki/L1StructuralLinter'
import { runL2SemanticAudit, formatL2AuditReport } from '@workspace/wiki/L2SemanticLinter'
import { compileWorkspace } from '@workspace/wiki/GraphCompiler'
import { formatL1AuditReport } from './lintWorkspace'
import { type WikiWorkspaceAdapter, LiveWikiWorkspaceAdapter } from './adapters'
import {
  type ToolConnectionContext,
  extractErrorInfo,
  getCodeRecommendFix
} from '../WorkspaceTools'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

/**
 * Executes a lint-gated graph compilation, projecting the workspace ledger and documents into a Concept Canvas.
 * The resulting graph is persisted to the workspace database and readable via `readGraph`.
 */
export async function executeCompileGraph(
  input: CompileGraphInput,
  adapter: WikiWorkspaceAdapter,
  invokeModel?: (prompt: string) => Promise<string>
): Promise<CompileGraphResult> {
  const canvasName = input.canvasName?.trim() || 'concept-canvas'
  const failOnError = input.failOnError !== false
  const runL1 = input.level === 'l1' || input.level === 'both' || input.level !== 'l2'
  const runL2 = input.level === 'l2' || input.level === 'both'

  let audit: L1AuditResult = {
    valid: true,
    errors: [],
    warnings: [],
    compiledAt: new Date().toISOString()
  }
  let l2Audit: L2AuditResult | undefined

  // 1. Run L1 structural audit
  if (runL1) {
    audit = input.workspacePath ? await runL1Audit(input.workspacePath) : await runL1Audit(adapter)
  }

  // 2. Run optional L2 semantic audit
  if (runL2) {
    l2Audit = input.workspacePath
      ? await runL2SemanticAudit({ workspace: input.workspacePath, invokeModel })
      : await runL2SemanticAudit({ workspace: adapter, invokeModel })
  }

  const lintReports = [
    runL1 ? formatL1AuditReport(audit) : '',
    l2Audit ? formatL2AuditReport(l2Audit) : ''
  ]
    .filter(Boolean)
    .join('\n\n---\n\n')

  // 3. Lint Gate: Fail fast if structural errors exist and failOnError is true
  if (!audit.valid && failOnError) {
    const errorMsg = `Compilation aborted due to ${audit.errors.length} structural integrity error(s). Please resolve the errors below before compiling to canvas, or set failOnError: false to force compilation.`
    return {
      status: 'error',
      valid: false,
      instanceName: canvasName,
      projectName: input.projectName,
      nodeCount: 0,
      edgeCount: 0,
      relationsBreakdown: {},
      lintReport: lintReports,
      report: `# 🛑 Graph Compilation Aborted\n\n${errorMsg}\n\n---\n\n${lintReports}`
    }
  }

  // 4. Compile workspace to GraphCanvasDTO (preserving existing canvas layout if present)
  const compiledGraph = await compileWorkspace(
    input.workspacePath ?? adapter,
    undefined,
    canvasName
  )

  // 5. Persist to SQLite via adapter
  let savedInstanceId: string | undefined
  if (adapter.saveCanvas) {
    savedInstanceId = await adapter.saveCanvas(canvasName, compiledGraph)
  }

  // 6. Calculate statistics
  const nodeCount = Object.keys(compiledGraph.graph.nodes).length
  const relationships = Object.values(compiledGraph.graph.relationships)
  const edgeCount = relationships.length

  const relationsBreakdown: Record<string, number> = {}
  for (const rel of relationships) {
    const relType = typeof rel.attrs?.rel === 'string' ? rel.attrs.rel : 'relates_to'
    relationsBreakdown[relType] = (relationsBreakdown[relType] ?? 0) + 1
  }

  const breakdownLines = Object.entries(relationsBreakdown)
    .map(([rel, count]) => `- **${rel}**: ${count}`)
    .join('\n')

  const reportLines = [
    '# 🗺️ Workspace Knowledge Graph Compiled Successfully',
    '',
    `**Canvas Instance**: \`${canvasName}\`${savedInstanceId ? ` (ID: \`${savedInstanceId}\`)` : ''}`,
    `**Total Nodes**: ${nodeCount} | **Total Relationships**: ${edgeCount}`,
    '',
    '### 📊 Relational Breakdown',
    breakdownLines || '_No relationships recorded in ledger._',
    '',
    '### 🔍 Visual Inspection',
    `The compiled graph is stored in the workspace database under canvas instance \`${canvasName}\`.`,
    `You can immediately inspect or query the nodes and edges using \`readGraph({ instanceName: "${canvasName}" })\`.`,
    '',
    '---',
    '',
    '## 📋 Lint Pre-check Results',
    lintReports
  ]

  return {
    status: 'success',
    valid: audit.valid,
    instanceId: savedInstanceId,
    instanceName: canvasName,
    projectName: input.projectName,
    nodeCount,
    edgeCount,
    relationsBreakdown,
    lintReport: lintReports,
    report: reportLines.join('\n')
  }
}

/**
 * LangChain tool wrapper for compileGraph.
 */
export const compileGraph = tool(
  async (input, config) => {
    const context = config.configurable as
      | (ToolConnectionContext & {
          adapter?: WikiWorkspaceAdapter
          invokeModel?: (prompt: string) => Promise<string>
        })
      | undefined
    const canvasName = input.canvasName?.trim() || 'concept-canvas'
    try {
      const adapter = context?.adapter ?? new LiveWikiWorkspaceAdapter(context)
      const result = await executeCompileGraph(input, adapter, context?.invokeModel)

      if (!result.valid && result.status === 'error') {
        return {
          status: 'error' as const,
          action: 'Failed to compile graph',
          instanceName: canvasName,
          projectName: input.projectName,
          code: WorkspaceErrorCode.WORKSPACE_WIKI_COMPILATION_FAILED,
          message: 'Compilation aborted due to structural integrity error(s).',
          recommendFix: getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_WIKI_COMPILATION_FAILED),
          lintReport: result.lintReport,
          report: result.report
        }
      }

      return {
        status: 'success' as const,
        action: 'Compiled Graph',
        instanceId: result.instanceId,
        instanceName: result.instanceName,
        projectName: result.projectName,
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
        relationsBreakdown: result.relationsBreakdown,
        lintReport: result.lintReport,
        report: result.report
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to compile graph',
        instanceName: canvasName,
        projectName: input.projectName,
        code,
        message,
        recommendFix,
        report: `# 🛑 Graph Compilation Error\n\n[${code}] ${message}\n\n${recommendFix ? `**Recommendation**: ${recommendFix}` : ''}`
      }
    }
  },
  {
    name: 'compileGraph',
    description: `Lints document linkages and compiles the Relational Ledger and documents into a Concept Canvas graph stored in SQLite (readable via readGraph). Runs structural linting first to prevent compiling corrupted linkages.`,
    schema: CompileGraphInputSchema
  }
)
