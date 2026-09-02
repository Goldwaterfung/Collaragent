/**
 * evals/reporter/types.ts
 * Strongly-typed contracts for Markdown benchmark reporting and report formatting options.
 */

import type { EvalSuiteResult } from '../runner/types'

/**
 * Options for configuring MarkdownReporter output and layout.
 */
export interface MarkdownReporterOptions {
  /** Target file path for the benchmark report (defaults to root 'EVALS.md') */
  readonly outputPath?: string
  /** Custom report title */
  readonly title?: string
  /** Whether to include deep links to Langfuse traces (default: true) */
  readonly includeDeepLinks?: boolean
  /** Whether to append detailed failure diagnostics and stack traces (default: true) */
  readonly includeFailureDetails?: boolean
  /** Langfuse base host URL for generating trace links */
  readonly langfuseBaseUrl?: string
}

/**
 * Formatted section output from the benchmark reporter.
 */
export interface GeneratedReport {
  readonly markdown: string
  readonly outputPath: string
  readonly suiteResult: EvalSuiteResult
}
