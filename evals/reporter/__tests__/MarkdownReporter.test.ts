/**
 * evals/reporter/__tests__/MarkdownReporter.test.ts
 * Unit tests for Markdown benchmark reporting and report formatting.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import { MarkdownReporter } from '../MarkdownReporter'
import type { EvalSuiteResult } from '../../runner/types'

describe('MarkdownReporter', () => {
  const createMockSuiteResult = (overrides?: Partial<EvalSuiteResult>): EvalSuiteResult => ({
    runName: 'test-eval-run-001',
    mode: 'live',
    totalScenarios: 2,
    passedScenarios: 2,
    failedScenarios: 0,
    passRate: 1.0,
    totalDurationMs: 1250,
    totalTokens: {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700
    },
    scenarioResults: [
      {
        scenarioId: 'SCN-DOC-01',
        tier: 'tier1_doc',
        name: 'Create Lexical Document with Title & Headings',
        passed: true,
        durationMs: 650,
        tokens: { promptTokens: 250, completionTokens: 100, totalTokens: 350 },
        summary: {
          passed: true,
          toolSelectionAccuracy: 1.0,
          schemaAdherence: 1.0,
          invariantIntegrity: 1.0,
          rollbackInvariantPassed: true,
          errorRecoverySuccess: true,
          errors: [],
          details: {}
        },
        errors: [],
        traceId: 'trace-doc-01'
      },
      {
        scenarioId: 'SCN-GRP-01',
        tier: 'tier2_graph',
        name: 'Create Visual Canvas & Root Concept Node',
        passed: true,
        durationMs: 600,
        tokens: { promptTokens: 250, completionTokens: 100, totalTokens: 350 },
        summary: {
          passed: true,
          toolSelectionAccuracy: 1.0,
          schemaAdherence: 1.0,
          invariantIntegrity: 1.0,
          rollbackInvariantPassed: true,
          errorRecoverySuccess: true,
          errors: [],
          details: {}
        },
        errors: [],
        traceId: 'trace-grp-01'
      }
    ],
    tierSummaries: {
      tier1_doc: { tier: 'tier1_doc', total: 1, passed: 1, failed: 0, passRate: 1.0 },
      tier2_graph: { tier: 'tier2_graph', total: 1, passed: 1, failed: 0, passRate: 1.0 },
      tier3_errors: { tier: 'tier3_errors', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier4_rollback: { tier: 'tier4_rollback', total: 0, passed: 0, failed: 0, passRate: 0 },
      tier5_subagents: { tier: 'tier5_subagents', total: 0, passed: 0, failed: 0, passRate: 0 }
    },
    ...overrides
  })

  describe('generateReport', () => {
    it('generates a formatted markdown report for passed scenarios', () => {
      const reporter = new MarkdownReporter()
      const suiteResult = createMockSuiteResult()
      const markdown = reporter.generateReport(suiteResult)

      expect(markdown).toContain('# CollarAgent Evaluation & Benchmark Report')
      expect(markdown).toContain('test-eval-run-001')
      expect(markdown).toContain('`live`')
      expect(markdown).toContain('100.0%')
      expect(markdown).toContain('Tier 1: Document Mutations & Lexical AST')
      expect(markdown).toContain('Tier 2: Visual Canvas & Graph Topology')
      expect(markdown).toContain('SCN-DOC-01')
      expect(markdown).toContain('SCN-GRP-01')
      expect(markdown).toContain('✅ Pass')
      expect(markdown).not.toContain('Failure Diagnostics & Error Traces')
    })

    it('includes deep links to Langfuse traces when configured', () => {
      const reporter = new MarkdownReporter({
        includeDeepLinks: true,
        langfuseBaseUrl: 'http://localhost:3000'
      })
      const suiteResult = createMockSuiteResult()
      const markdown = reporter.generateReport(suiteResult)

      expect(markdown).toContain('[SCN-DOC-01](http://localhost:3000/trace/trace-doc-01)')
      expect(markdown).toContain('[SCN-GRP-01](http://localhost:3000/trace/trace-grp-01)')
    })

    it('generates failure diagnostic details when scenarios fail', () => {
      const reporter = new MarkdownReporter()
      const failedSuiteResult = createMockSuiteResult({
        totalScenarios: 2,
        passedScenarios: 1,
        failedScenarios: 1,
        passRate: 0.5,
        scenarioResults: [
          {
            scenarioId: 'SCN-DOC-01',
            tier: 'tier1_doc',
            name: 'Create Lexical Document with Title & Headings',
            passed: true,
            durationMs: 500,
            tokens: { promptTokens: 250, completionTokens: 100, totalTokens: 350 },
            summary: {
              passed: true,
              toolSelectionAccuracy: 1.0,
              schemaAdherence: 1.0,
              invariantIntegrity: 1.0,
              rollbackInvariantPassed: true,
              errorRecoverySuccess: true,
              errors: [],
              details: {}
            },
            errors: []
          },
          {
            scenarioId: 'SCN-ERR-01',
            tier: 'tier3_errors',
            name: 'Self-Heal Malformed Tool Arguments',
            passed: false,
            durationMs: 1200,
            tokens: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
            summary: {
              passed: false,
              toolSelectionAccuracy: 0.0,
              schemaAdherence: 0.0,
              invariantIntegrity: 1.0,
              rollbackInvariantPassed: true,
              errorRecoverySuccess: false,
              errors: ['Tool selection mismatch: expected editDocument', 'Zod validation error'],
              details: {}
            },
            errors: ['Tool selection mismatch: expected editDocument', 'Zod validation error']
          }
        ]
      })

      const markdown = reporter.generateReport(failedSuiteResult)

      expect(markdown).toContain('50.0%')
      expect(markdown).toContain('❌ Fail')
      expect(markdown).toContain('## 5. Failure Diagnostics & Error Traces')
      expect(markdown).toContain('### ❌ Scenario `SCN-ERR-01`')
      expect(markdown).toContain('Tool selection mismatch: expected editDocument')
      expect(markdown).toContain('Zod validation error')
    })
  })

  describe('writeReport', () => {
    it('writes the markdown report to disk', async () => {
      const testFilePath = `/tmp/test-evals-report-${Date.now()}.md`
      const reporter = new MarkdownReporter({ outputPath: testFilePath })
      const suiteResult = createMockSuiteResult()

      const writtenPath = await reporter.writeReport(suiteResult)
      expect(writtenPath).toBe(testFilePath)

      const content = await fs.readFile(testFilePath, 'utf8')
      expect(content).toContain('# CollarAgent Evaluation & Benchmark Report')
      expect(content).toContain('test-eval-run-001')

      // Cleanup
      await fs.unlink(testFilePath)
    })
  })
})
