/**
 * evals/reporter/MarkdownReporter.ts
 * Aggregates benchmark evaluation metrics, latencies, token consumption, and assertion scores into Markdown reports.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { EvalSuiteResult, TierSummary } from '../runner/types'
import type { ScenarioTier } from '../scenarios/types'
import type { MarkdownReporterOptions } from './types'

const DEFAULT_REPORT_FILENAME = 'EVALS.md'
const DEFAULT_TITLE = 'CollarAgent Evaluation & Benchmark Report'
const DEFAULT_LANGFUSE_URL = 'http://localhost:3000'

const TIER_DISPLAY_NAMES: Readonly<Record<ScenarioTier, string>> = {
  tier1_doc: 'Tier 1: Document Mutations & Lexical AST',
  tier2_graph: 'Tier 2: Visual Canvas & Graph Topology',
  tier3_errors: 'Tier 3: Error Recovery & Autonomous Healing',
  tier4_rollback: 'Tier 4: Mathematical Rollback Parity',
  tier5_subagents: 'Tier 5: Subagent Delegation & Synthesis'
}

const ALL_TIERS_ORDER: readonly ScenarioTier[] = [
  'tier1_doc',
  'tier2_graph',
  'tier3_errors',
  'tier4_rollback',
  'tier5_subagents'
] as const

/**
 * Markdown benchmark report generator.
 */
export class MarkdownReporter {
  private readonly outputPath: string
  private readonly title: string
  private readonly includeDeepLinks: boolean
  private readonly includeFailureDetails: boolean
  private readonly langfuseBaseUrl: string

  public constructor(options?: MarkdownReporterOptions) {
    this.outputPath = options?.outputPath ?? path.resolve(process.cwd(), DEFAULT_REPORT_FILENAME)
    this.title = options?.title ?? DEFAULT_TITLE
    this.includeDeepLinks = options?.includeDeepLinks ?? true
    this.includeFailureDetails = options?.includeFailureDetails ?? true
    this.langfuseBaseUrl =
      options?.langfuseBaseUrl ??
      process.env.LANGFUSE_BASE_URL ??
      process.env.LANGFUSE_HOST ??
      DEFAULT_LANGFUSE_URL
  }

  /**
   * Generates a complete Markdown benchmark report string from evaluation suite results.
   *
   * @param suiteResult Aggregated suite results from EvalRunner
   * @returns Formatted Markdown string
   */
  public generateReport(suiteResult: EvalSuiteResult): string {
    const lines: string[] = []

    // 1. Header
    lines.push(`# ${this.title}`)
    lines.push('')
    lines.push(`> Automated evaluation benchmark run: **\`${suiteResult.runName}\`**`)
    lines.push('')

    // 2. Executive Summary KPI Table
    lines.push('## 1. Executive Summary')
    lines.push('')
    lines.push('| Metric | Value |')
    lines.push('| :--- | :--- |')
    lines.push(`| **Execution Mode** | \`${suiteResult.mode}\` |`)
    lines.push(`| **Total Scenarios** | ${suiteResult.totalScenarios} |`)
    lines.push(`| **Passed Scenarios** | ${suiteResult.passedScenarios} |`)
    lines.push(`| **Failed Scenarios** | ${suiteResult.failedScenarios} |`)
    lines.push(`| **Overall Pass Rate** | **${this.formatPercent(suiteResult.passRate)}** |`)
    lines.push(`| **Total Duration** | ${this.formatDuration(suiteResult.totalDurationMs)} |`)
    lines.push(`| **Prompt Tokens** | ${this.formatNumber(suiteResult.totalTokens.promptTokens)} |`)
    lines.push(
      `| **Completion Tokens** | ${this.formatNumber(suiteResult.totalTokens.completionTokens)} |`
    )
    lines.push(`| **Total Tokens** | ${this.formatNumber(suiteResult.totalTokens.totalTokens)} |`)
    lines.push('')

    // 3. Tier Breakdown Table
    lines.push('## 2. Evaluation Tier Breakdown')
    lines.push('')
    lines.push('| Tier | Name | Total | Passed | Failed | Pass Rate |')
    lines.push('| :--- | :--- | :---: | :---: | :---: | :---: |')

    for (const tierKey of ALL_TIERS_ORDER) {
      const summary: TierSummary | undefined = suiteResult.tierSummaries[tierKey]
      if (summary && summary.total > 0) {
        const displayName = TIER_DISPLAY_NAMES[tierKey]
        const statusBadge = summary.failed === 0 ? '✅' : '⚠️'
        lines.push(
          `| \`${tierKey}\` | ${displayName} | ${summary.total} | ${summary.passed} | ${summary.failed} | ${statusBadge} ${this.formatPercent(summary.passRate)} |`
        )
      }
    }
    lines.push('')

    // 4. 30-Scenario Detailed Matrix Table
    lines.push('## 3. Scenario Benchmark Matrix')
    lines.push('')
    lines.push(
      '| Scenario ID | Tier | Name | Status | Tool Acc | Schema Adh | Invariant Int | Rollback Parity | Latency | Tokens |'
    )
    lines.push('| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |')

    for (const result of suiteResult.scenarioResults) {
      const statusIcon = result.passed ? '✅ Pass' : '❌ Fail'
      const toolAcc = result.summary.toolSelectionAccuracy.toFixed(1)
      const schemaAdh = result.summary.schemaAdherence.toFixed(1)
      const invariantInt = result.summary.invariantIntegrity.toFixed(1)
      const rollback = result.summary.rollbackInvariantPassed ? '✅ 100%' : '❌ Drift'
      const latency = `${result.durationMs}ms`
      const tokens = this.formatNumber(result.tokens.totalTokens)

      let scenarioLabel = `\`${result.scenarioId}\``
      if (this.includeDeepLinks && result.traceId) {
        const traceUrl = `${this.langfuseBaseUrl}/trace/${result.traceId}`
        scenarioLabel = `[${result.scenarioId}](${traceUrl})`
      }

      lines.push(
        `| ${scenarioLabel} | \`${result.tier}\` | ${result.name} | ${statusIcon} | ${toolAcc} | ${schemaAdh} | ${invariantInt} | ${rollback} | ${latency} | ${tokens} |`
      )
    }
    lines.push('')

    // 5. Invariant Integrity Overview
    lines.push('## 4. Invariant Verification Taxonomy')
    lines.push('')
    lines.push(
      '1. **Tool Selection Accuracy**: Evaluates whether the primary intent-matching tool is selected.'
    )
    lines.push(
      '2. **Schema Adherence**: Validates all tool arguments strictly conform to Zod schemas.'
    )
    lines.push(
      '3. **Lexical AST Integrity**: Asserts block ID uniqueness, heading hierarchies, and rectangular table dimensions.'
    )
    lines.push(
      '4. **Graph DAG Acyclicity**: Verifies nominal NodeId branding, endpoint resolution, and directed acyclicity.'
    )
    lines.push(
      '5. **Mathematical Rollback Parity**: Confirms 100% byte-identical state restoration via `InverseCommandEngine`.'
    )
    lines.push('')

    // 6. Failure Diagnostics (if any)
    if (this.includeFailureDetails && suiteResult.failedScenarios > 0) {
      lines.push('## 5. Failure Diagnostics & Error Traces')
      lines.push('')
      const failedResults = suiteResult.scenarioResults.filter((r) => !r.passed)

      for (const failed of failedResults) {
        lines.push(`### ❌ Scenario \`${failed.scenarioId}\`: ${failed.name}`)
        lines.push(`- **Tier**: \`${failed.tier}\``)
        lines.push(`- **Duration**: ${failed.durationMs}ms`)
        lines.push('- **Diagnostic Errors**:')
        for (const err of failed.errors) {
          lines.push(`  - \`${err}\``)
        }
        lines.push('')
      }
    }

    // 7. Langfuse Tracing Reference
    lines.push('## 6. Observability & Telemetry Context')
    lines.push('')
    lines.push(`- **Langfuse Host**: \`${this.langfuseBaseUrl}\``)
    lines.push(`- **Evaluation Run**: \`${suiteResult.runName}\``)
    lines.push(`- **Report Timestamp**: \`${new Date().toISOString()}\``)
    lines.push('')

    return lines.join('\n')
  }

  /**
   * Generates the report and writes it to disk.
   *
   * @param suiteResult Evaluation suite results
   * @param customPath Optional custom file path destination
   * @returns Path to written file
   */
  public async writeReport(suiteResult: EvalSuiteResult, customPath?: string): Promise<string> {
    const targetPath = customPath ?? this.outputPath
    const content = this.generateReport(suiteResult)

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf8')

    return targetPath
  }

  private formatPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`
    }
    return `${(ms / 1000).toFixed(2)}s`
  }

  private formatNumber(value: number): string {
    return value.toLocaleString('en-US')
  }
}
