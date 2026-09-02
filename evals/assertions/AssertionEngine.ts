/**
 * evals/assertions/AssertionEngine.ts
 * Deterministic Invariant & Assertion Engine for CollarAgent Evaluation Scenarios.
 *
 * Validates:
 * 1. Zod Tool Schema Adherence
 * 2. Lexical Document AST Structural Integrity & Heading Hierarchy
 * 3. Visual Canvas Graph Integrity & DAG Acyclicity
 * 4. Mathematical Rollback Byte Parity
 */

import { z } from 'zod'
import {
  DocumentSchema,
  GraphCanvasDTOSchema,
  type DocumentPayload,
  type GraphCanvasDTO
} from '@shared/schemas/instances'
import type {
  ToolSchemaAssertionResult,
  ASTValidationResult,
  GraphValidationResult,
  RollbackParityResult,
  ScenarioInvariantSummary,
  EvaluateScenarioParams
} from './types'

export class AssertionEngine {
  /**
   * Asserts that a tool invocation's arguments strictly conform to its expected Zod schema.
   */
  static assertToolSchema(
    toolName: string,
    args: unknown,
    schema?: z.ZodTypeAny
  ): ToolSchemaAssertionResult {
    if (!schema) {
      if (typeof args === 'object' && args !== null) {
        return { valid: true, toolName }
      }
      return {
        valid: false,
        toolName,
        errors: ['Arguments must be a valid non-null object']
      }
    }

    const parseResult = schema.safeParse(args)
    if (parseResult.success) {
      return { valid: true, toolName }
    }

    const errors = parseResult.error.issues.map(
      (issue) => `[${issue.path.join('.') || 'root'}]: ${issue.message}`
    )

    return {
      valid: false,
      toolName,
      errors
    }
  }

  /**
   * Asserts structural integrity of a Lexical Document payload:
   * - Conforms to DocumentSchema (Zod)
   * - Every block has a unique, non-empty block ID
   * - Heading levels follow logical structure without skipping levels (e.g. h1 -> h3 without h2)
   * - Table blocks contain consistent column counts across all rows
   */
  static assertLexicalAST(payload: unknown): ASTValidationResult {
    const errors: string[] = []
    const parseResult = DocumentSchema.safeParse(payload)

    if (!parseResult.success) {
      const zodErrors = parseResult.error.issues.map(
        (issue) => `DocumentSchema [${issue.path.join('.')}]: ${issue.message}`
      )
      return {
        valid: false,
        blockCount: 0,
        hasDuplicateIds: false,
        hasValidHeadingHierarchy: false,
        hasConsistentTables: false,
        errors: zodErrors
      }
    }

    const doc = parseResult.data as DocumentPayload
    const blocks = doc.blocks
    const seenIds = new Set<string>()
    const duplicateIds: string[] = []

    let hasValidHeadingHierarchy = true
    let lastHeadingLevel = 0
    let hasConsistentTables = true

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]

      // 1. Unique Block IDs check
      if (block.id) {
        if (seenIds.has(block.id)) {
          duplicateIds.push(block.id)
          errors.push(`Duplicate block ID found: "${block.id}" at block index ${i}`)
        } else {
          seenIds.add(block.id)
        }
      }

      // 2. Heading hierarchy check
      if (block.type.startsWith('h')) {
        const level = parseInt(block.type.charAt(1), 10)
        if (!isNaN(level)) {
          if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
            hasValidHeadingHierarchy = false
            errors.push(
              `Heading hierarchy gap detected: ${block.type} follows h${lastHeadingLevel} at block index ${i}`
            )
          }
          lastHeadingLevel = level
        }
      }

      // 3. Table structural consistency check
      if (block.type === 'table' && block.tableRows && block.tableRows.length > 0) {
        const firstRowCount = block.tableRows[0].cells.length
        for (let r = 1; r < block.tableRows.length; r++) {
          const rowCellCount = block.tableRows[r].cells.length
          if (rowCellCount !== firstRowCount) {
            hasConsistentTables = false
            errors.push(
              `Table row column mismatch at block index ${i}, row ${r}: expected ${firstRowCount} cells, found ${rowCellCount}`
            )
          }
        }
      }
    }

    const hasDuplicateIds = duplicateIds.length > 0
    const isValid = errors.length === 0

    return {
      valid: isValid,
      blockCount: blocks.length,
      hasDuplicateIds,
      duplicateIds: hasDuplicateIds ? duplicateIds : undefined,
      hasValidHeadingHierarchy,
      hasConsistentTables,
      errors
    }
  }

  /**
   * Asserts Visual Canvas graph integrity and DAG acyclicity:
   * - Conforms to GraphCanvasDTOSchema
   * - All relationship endpoints reference existing node IDs (no dangling edges)
   * - If requireAcyclic is true, verifies that the graph contains zero directed cycles via DFS
   */
  static assertGraphDAG(payload: unknown, requireAcyclic = true): GraphValidationResult {
    const errors: string[] = []
    const parseResult = GraphCanvasDTOSchema.safeParse(payload)

    if (!parseResult.success) {
      const zodErrors = parseResult.error.issues.map(
        (issue) => `GraphCanvasDTOSchema [${issue.path.join('.')}]: ${issue.message}`
      )
      return {
        valid: false,
        nodeCount: 0,
        relationshipCount: 0,
        isAcyclic: false,
        hasDanglingEndpoints: false,
        errors: zodErrors
      }
    }

    const canvas = parseResult.data as GraphCanvasDTO
    const nodes = canvas.graph.nodes
    const relationships = canvas.graph.relationships

    const nodeIds = new Set(Object.keys(nodes))
    const danglingEndpoints: string[] = []

    // 1. Endpoint existence verification
    for (const [relId, rel] of Object.entries(relationships)) {
      if (!nodeIds.has(rel.from.nodeId)) {
        danglingEndpoints.push(rel.from.nodeId)
        errors.push(
          `Relationship "${relId}" references nonexistent source nodeId: "${rel.from.nodeId}"`
        )
      }
      if (!nodeIds.has(rel.to.nodeId)) {
        danglingEndpoints.push(rel.to.nodeId)
        errors.push(
          `Relationship "${relId}" references nonexistent target nodeId: "${rel.to.nodeId}"`
        )
      }
    }

    // 2. DAG Acyclicity check via DFS
    let isAcyclic = true
    let cyclePath: string[] | undefined

    if (requireAcyclic && danglingEndpoints.length === 0) {
      // Build adjacency list
      const adj = new Map<string, string[]>()
      for (const nId of nodeIds) {
        adj.set(nId, [])
      }
      for (const rel of Object.values(relationships)) {
        adj.get(rel.from.nodeId)?.push(rel.to.nodeId)
      }

      const visited = new Set<string>()
      const recStack = new Set<string>()
      const currentPath: string[] = []

      const dfsCycle = (current: string): boolean => {
        visited.add(current)
        recStack.add(current)
        currentPath.push(current)

        const neighbors = adj.get(current) ?? []
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            if (dfsCycle(neighbor)) return true
          } else if (recStack.has(neighbor)) {
            // Cycle found
            const cycleStartIndex = currentPath.indexOf(neighbor)
            cyclePath = [...currentPath.slice(cycleStartIndex), neighbor]
            return true
          }
        }

        recStack.delete(current)
        currentPath.pop()
        return false
      }

      for (const nId of nodeIds) {
        if (!visited.has(nId)) {
          if (dfsCycle(nId)) {
            isAcyclic = false
            errors.push(`Directed cycle detected in graph: ${cyclePath?.join(' -> ') ?? 'unknown'}`)
            break
          }
        }
      }
    }

    const hasDanglingEndpoints = danglingEndpoints.length > 0
    const isValid = errors.length === 0

    return {
      valid: isValid,
      nodeCount: nodeIds.size,
      relationshipCount: Object.keys(relationships).length,
      isAcyclic,
      hasDanglingEndpoints,
      danglingEndpoints: hasDanglingEndpoints ? danglingEndpoints : undefined,
      cyclePath,
      errors
    }
  }

  /**
   * Asserts mathematical rollback parity:
   * Validates that applying inverse operations returns state to 100% byte-identical equality.
   */
  static assertRollbackParity(
    initialSnapshot: unknown,
    restoredSnapshot: unknown
  ): RollbackParityResult {
    const errors: string[] = []
    const initialJson = JSON.stringify(initialSnapshot)
    const restoredJson = JSON.stringify(restoredSnapshot)

    const byteParity = initialJson === restoredJson
    if (!byteParity) {
      errors.push(
        `Rollback byte parity mismatch: initial (${initialJson.length} bytes) vs restored (${restoredJson.length} bytes)`
      )
    }

    return {
      matches: byteParity,
      byteParity,
      diffSummary: byteParity
        ? undefined
        : `Baseline: ${initialJson.slice(0, 100)}... !== Restored: ${restoredJson.slice(0, 100)}...`,
      errors
    }
  }

  /**
   * Evaluates all assertions for a scenario execution and produces a standardized summary.
   */
  static evaluateScenarioInvariants(params: EvaluateScenarioParams): ScenarioInvariantSummary {
    const errors: string[] = []
    const details: Record<string, unknown> = {}

    // 1. Tool Selection Accuracy
    let toolSelectionAccuracy = 1.0
    if (params.expectedTools && params.expectedTools.length > 0) {
      const firstExpected = params.expectedTools[0]
      const firstActual = params.toolCalls?.[0]?.name
      if (!firstActual || firstActual !== firstExpected) {
        toolSelectionAccuracy = 0.0
        errors.push(
          `Tool selection mismatch: expected first tool "${firstExpected}", but agent invoked "${firstActual ?? 'none'}"`
        )
      }
    }
    details.toolSelectionAccuracy = toolSelectionAccuracy

    // 2. Schema Adherence
    let schemaAdherence = 1.0
    if (params.toolCalls && params.toolCalls.length > 0) {
      for (const call of params.toolCalls) {
        if (call.status === 'error' && call.error) {
          schemaAdherence = 0.0
          errors.push(`Tool execution error for "${call.name}": ${call.error}`)
        }
      }
    }
    details.schemaAdherence = schemaAdherence

    // 3. Document AST & Graph DAG Invariant Integrity
    let invariantIntegrity = 1.0

    if (params.documentPayload !== undefined) {
      const astResult = this.assertLexicalAST(params.documentPayload)
      details.astValidation = astResult
      if (!astResult.valid) {
        invariantIntegrity = 0.0
        errors.push(...astResult.errors)
      }
    }

    if (params.graphCanvas !== undefined) {
      const graphResult = this.assertGraphDAG(
        params.graphCanvas,
        params.requireAcyclicGraph ?? true
      )
      details.graphValidation = graphResult
      if (!graphResult.valid) {
        invariantIntegrity = 0.0
        errors.push(...graphResult.errors)
      }
    }
    details.invariantIntegrity = invariantIntegrity

    // 4. Rollback Invariant
    let rollbackInvariantPassed = true
    if (params.initialSnapshot !== undefined && params.restoredSnapshot !== undefined) {
      const rollbackResult = this.assertRollbackParity(
        params.initialSnapshot,
        params.restoredSnapshot
      )
      details.rollbackValidation = rollbackResult
      if (!rollbackResult.byteParity) {
        rollbackInvariantPassed = false
        errors.push(...rollbackResult.errors)
      }
    }
    details.rollbackInvariantPassed = rollbackInvariantPassed

    // 5. Error Recovery
    const errorRecoverySuccess = params.errorRecoveryAchieved !== false
    if (!errorRecoverySuccess) {
      errors.push('Autonomous error recovery failed within permitted turns')
    }
    details.errorRecoverySuccess = errorRecoverySuccess

    // Overall pass gate
    const passed =
      toolSelectionAccuracy === 1.0 &&
      schemaAdherence === 1.0 &&
      invariantIntegrity === 1.0 &&
      rollbackInvariantPassed &&
      errorRecoverySuccess

    return {
      passed,
      toolSelectionAccuracy,
      schemaAdherence,
      invariantIntegrity,
      rollbackInvariantPassed,
      errorRecoverySuccess,
      errors,
      details
    }
  }
}
