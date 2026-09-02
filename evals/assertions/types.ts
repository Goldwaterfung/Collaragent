/**
 * evals/assertions/types.ts
 * Strongly-typed contracts for deterministic evaluation assertions and invariant verifications.
 */

/**
 * Record of a single tool invocation during agent execution.
 */
export interface ToolCallRecord {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  readonly output?: unknown
  readonly status?: 'success' | 'error'
  readonly error?: string
}

/**
 * Result of asserting tool schema adherence against a Zod schema.
 */
export interface ToolSchemaAssertionResult {
  readonly valid: boolean
  readonly toolName: string
  readonly errors?: readonly string[]
}

/**
 * Result of asserting Lexical document AST integrity.
 */
export interface ASTValidationResult {
  readonly valid: boolean
  readonly blockCount: number
  readonly hasDuplicateIds: boolean
  readonly duplicateIds?: readonly string[]
  readonly hasValidHeadingHierarchy: boolean
  readonly hasConsistentTables: boolean
  readonly errors: readonly string[]
}

/**
 * Result of asserting Visual Canvas graph structure and DAG invariants.
 */
export interface GraphValidationResult {
  readonly valid: boolean
  readonly nodeCount: number
  readonly relationshipCount: number
  readonly isAcyclic: boolean
  readonly hasDanglingEndpoints: boolean
  readonly danglingEndpoints?: readonly string[]
  readonly cyclePath?: readonly string[]
  readonly errors: readonly string[]
}

/**
 * Result of asserting mathematical rollback byte parity against a baseline snapshot.
 */
export interface RollbackParityResult {
  readonly matches: boolean
  readonly byteParity: boolean
  readonly diffSummary?: string
  readonly errors: readonly string[]
}

/**
 * Normalized summary of all invariant checks for a single evaluation scenario.
 */
export interface ScenarioInvariantSummary {
  readonly passed: boolean
  readonly toolSelectionAccuracy: number // 0.0 or 1.0
  readonly schemaAdherence: number // 0.0 or 1.0
  readonly invariantIntegrity: number // 0.0 or 1.0
  readonly rollbackInvariantPassed: boolean
  readonly errorRecoverySuccess: boolean
  readonly errors: readonly string[]
  readonly details: Readonly<Record<string, unknown>>
}

/**
 * Input parameters for comprehensive scenario invariant evaluation.
 */
export interface EvaluateScenarioParams {
  /** Expected tool sequence or starting tool name */
  readonly expectedTools?: readonly string[]
  /** Actual recorded tool calls during execution */
  readonly toolCalls?: readonly ToolCallRecord[]
  /** Document payload to validate for AST integrity */
  readonly documentPayload?: unknown
  /** Graph canvas payload to validate for DAG and structural integrity */
  readonly graphCanvas?: unknown
  /** Initial baseline snapshot before execution */
  readonly initialSnapshot?: unknown
  /** Restored snapshot after applying inverse commands */
  readonly restoredSnapshot?: unknown
  /** Whether the graph must strictly be an acyclic DAG */
  readonly requireAcyclicGraph?: boolean
  /** Whether error recovery was expected and achieved */
  readonly errorRecoveryAchieved?: boolean
}
