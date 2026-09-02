/**
 * evals/cli.ts
 * Headless Command-Line Interface (CLI) for CollarAgent Evaluation & Benchmark Harness.
 *
 * Usage:
 *   yarn eval:traces [--session <id>] [--tag <tag>] [--limit <n>]
 *   yarn eval [--tier <tier1_doc|...>] [--scenario <id>] [--report <path>]
 */

import * as path from 'node:path'
import { EvalRunner } from './runner/EvalRunner'
import { TraceEvalRunner } from './runner/TraceEvalRunner'
import { MarkdownReporter } from './reporter/MarkdownReporter'
import type { ScenarioTier } from './scenarios/types'
import type { EvalSuiteResult, TraceEvalSuiteResult } from './runner/types'

interface ParsedCliArgs {
  tracesMode: boolean
  sessionId?: string
  tag?: string
  limit?: number
  tier?: ScenarioTier
  scenarioId?: string
  reportPath: string
  skipReport: boolean
  timeoutMs: number
  help: boolean
}

const VALID_TIERS: readonly ScenarioTier[] = [
  'tier1_doc',
  'tier2_graph',
  'tier3_errors',
  'tier4_rollback',
  'tier5_subagents'
] as const

function printHelp(): void {
  console.log(`
CollarAgent Evaluation CLI Runner

Usage:
  yarn eval:traces                     Evaluate real application traces stored in Langfuse DB
  yarn eval:traces --session <id>      Evaluate traces for a specific user session
  yarn eval:traces --tag <tag>         Evaluate traces matching a specific tag (e.g. desktop-chat)
  yarn eval:traces --limit 50          Limit number of traces evaluated (default: 20)

  yarn eval                            Run live evaluation suite across benchmark scenarios
  yarn eval --tier tier1_doc           Run live evaluations for a specific tier
  yarn eval --scenario SCN-DOC-01      Run a single live evaluation scenario

Options:
  --traces                             Run in Real-Trace Evaluation mode (evaluates Langfuse traces)
  --session <id>                       Filter traces by session ID
  --tag <tag>                          Filter traces by tag
  --limit <n>                          Maximum number of traces to evaluate (default: 20)
  --tier <tier_name>                   Filter by tier (tier1_doc, tier2_graph, tier3_errors, tier4_rollback, tier5_subagents)
  --scenario <id>                      Run a single scenario by ID (e.g. SCN-DOC-01)
  --report <path>                      Output path for Markdown benchmark report (default: EVALS.md)
  --no-report                          Skip writing Markdown report to disk
  --timeout <ms>                       Per-scenario execution timeout in ms (default: 30000)
  -h, --help                           Display this help message
`)
}

function parseArgs(argv: readonly string[]): ParsedCliArgs {
  let tracesMode = false
  let sessionId: string | undefined
  let tag: string | undefined
  let limit: number | undefined
  let tier: ScenarioTier | undefined
  let scenarioId: string | undefined
  let reportPath = path.resolve(process.cwd(), 'EVALS.md')
  let skipReport = false
  let timeoutMs = 30000
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--traces') {
      tracesMode = true
    } else if (arg === '--session' && i + 1 < argv.length) {
      sessionId = argv[++i]
    } else if (arg === '--tag' && i + 1 < argv.length) {
      tag = argv[++i]
    } else if (arg === '--limit' && i + 1 < argv.length) {
      const parsed = parseInt(argv[++i], 10)
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed
      }
    } else if (arg === '--tier' && i + 1 < argv.length) {
      const val = argv[++i] as ScenarioTier
      if (VALID_TIERS.includes(val)) {
        tier = val
      } else {
        console.error(`Unknown tier: "${val}". Valid tiers: ${VALID_TIERS.join(', ')}`)
        process.exit(1)
      }
    } else if (arg === '--scenario' && i + 1 < argv.length) {
      scenarioId = argv[++i]
    } else if (arg === '--report' && i + 1 < argv.length) {
      reportPath = path.resolve(process.cwd(), argv[++i])
    } else if (arg === '--no-report') {
      skipReport = true
    } else if (arg === '--timeout' && i + 1 < argv.length) {
      const parsed = parseInt(argv[++i], 10)
      if (!isNaN(parsed) && parsed > 0) {
        timeoutMs = parsed
      }
    }
  }

  return {
    tracesMode,
    sessionId,
    tag,
    limit,
    tier,
    scenarioId,
    reportPath,
    skipReport,
    timeoutMs,
    help
  }
}

async function runRealTraceEvaluation(args: ParsedCliArgs): Promise<void> {
  console.log('='.repeat(80))
  console.log('🔬 CollarAgent Real-Trace Evaluation & Auto-Annotation Engine')
  console.log(`- Target:    Self-Hosted Langfuse DB`)
  if (args.sessionId) console.log(`- Session:   ${args.sessionId}`)
  if (args.tag) console.log(`- Tag:       ${args.tag}`)
  console.log(`- Limit:     ${args.limit ?? 20} traces`)
  console.log(`- Started:   ${new Date().toISOString()}`)
  console.log('='.repeat(80))

  const runner = new TraceEvalRunner({
    sessionId: args.sessionId,
    tag: args.tag,
    limit: args.limit,
    onTraceStart: (traceId, index, total) => {
      process.stdout.write(`[${index + 1}/${total}] Trace ${traceId.slice(0, 18).padEnd(20)} `)
    },
    onTraceComplete: (result) => {
      const badge = result.passed ? '✅ PASS' : '❌ FAIL'
      const duration = `${result.durationMs}ms`.padStart(8)
      const tokens = `${result.tokens.totalTokens} tok`.padStart(10)
      const tools = `${result.toolCallsCount} tools`.padStart(9)
      console.log(`${badge} (${duration}, ${tokens}, ${tools})`)
      if (!result.passed && result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(`   ↳ ⚠️ ${err}`)
        }
      }
    }
  })

  let suiteResult: TraceEvalSuiteResult
  try {
    suiteResult = await runner.runSuite()
  } catch (error: unknown) {
    console.error(
      `\n❌ Fatal error running trace evaluation: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  }

  console.log('='.repeat(80))
  console.log('📊 Real Trace Evaluation Summary')
  console.log(`- Total Traces:     ${suiteResult.totalTraces}`)
  console.log(`- Passed:           ${suiteResult.passedTraces}`)
  console.log(`- Failed:           ${suiteResult.failedTraces}`)
  console.log(`- Pass Rate:        ${(suiteResult.passRate * 100).toFixed(1)}%`)
  console.log(`- Total Duration:   ${(suiteResult.totalDurationMs / 1000).toFixed(2)}s`)
  console.log(`- Total Tokens:     ${suiteResult.totalTokens.totalTokens.toLocaleString()}`)
  console.log(`- Annotations:      Automatically synchronized to Langfuse DB`)
  console.log('='.repeat(80))

  if (suiteResult.failedTraces > 0) {
    process.exit(1)
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)

  if (args.help) {
    printHelp()
    return
  }

  if (args.tracesMode) {
    await runRealTraceEvaluation(args)
    return
  }

  console.log('='.repeat(80))
  console.log('🔬 CollarAgent Live Evaluation Harness')
  console.log(`- Mode:      LIVE`)
  if (args.tier) console.log(`- Tier:      ${args.tier}`)
  if (args.scenarioId) console.log(`- Scenario:  ${args.scenarioId}`)
  console.log(`- Started:   ${new Date().toISOString()}`)
  console.log('='.repeat(80))

  const runner = new EvalRunner({
    tier: args.tier,
    scenarioId: args.scenarioId,
    timeoutMs: args.timeoutMs,
    onScenarioStart: (scenario, index, total) => {
      process.stdout.write(
        `[${index + 1}/${total}] ${scenario.id.padEnd(12)} ${scenario.name.slice(0, 45).padEnd(45)} `
      )
    },
    onScenarioComplete: (_scenario, result) => {
      const badge = result.passed ? '✅ PASS' : '❌ FAIL'
      const duration = `${result.durationMs}ms`.padStart(8)
      const tokens = `${result.tokens.totalTokens} tok`.padStart(10)
      console.log(`${badge} (${duration}, ${tokens})`)
      if (!result.passed && result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(`   ↳ ⚠️ ${err}`)
        }
      }
    }
  })

  let suiteResult: EvalSuiteResult
  try {
    suiteResult = await runner.runSuite()
  } catch (error: unknown) {
    console.error(
      `\n❌ Fatal error running evaluation suite: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exit(1)
  }

  console.log('='.repeat(80))
  console.log('📊 Benchmark Run Summary')
  console.log(`- Total Scenarios:  ${suiteResult.totalScenarios}`)
  console.log(`- Passed:           ${suiteResult.passedScenarios}`)
  console.log(`- Failed:           ${suiteResult.failedScenarios}`)
  console.log(`- Pass Rate:        ${(suiteResult.passRate * 100).toFixed(1)}%`)
  console.log(`- Total Duration:   ${(suiteResult.totalDurationMs / 1000).toFixed(2)}s`)
  console.log(`- Total Tokens:     ${suiteResult.totalTokens.totalTokens.toLocaleString()}`)
  console.log('='.repeat(80))

  if (!args.skipReport) {
    const reporter = new MarkdownReporter({ outputPath: args.reportPath })
    const writtenPath = await reporter.writeReport(suiteResult)
    console.log(`📝 Generated benchmark report at: ${writtenPath}`)
  }

  if (suiteResult.failedScenarios > 0) {
    process.exit(1)
  }
}

// Auto-run if invoked directly
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('Unhandled CLI exception:', err)
    process.exit(1)
  })
}
