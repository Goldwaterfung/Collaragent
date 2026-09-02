/**
 * Options for configuring the Langfuse LangChain/LangGraph CallbackHandler.
 */
export interface CreateLangfuseHandlerOptions {
  /** Base URL for the Langfuse server (e.g. http://localhost:3000) */
  baseUrl?: string

  /** Public Key for authentication (pk-lf-...) */
  publicKey?: string

  /** Secret Key for authentication (sk-lf-...) */
  secretKey?: string

  /** Session identifier to group traces */
  sessionId?: string

  /** User identifier */
  userId?: string

  /** Tags to associate with the traces */
  tags?: readonly string[] | string[]

  /** Additional metadata key-value pairs */
  metadata?: Record<string, unknown>

  /** Active thread ID if applicable */
  threadId?: string

  /** Scenario identifier if running in evaluation mode */
  scenarioId?: string

  /** Tier category if running evaluation */
  tier?: string

  /** Execution mode (e.g. live, replay, record) */
  executionMode?: string

  /** Custom run name */
  runName?: string

  /** Whether to update the root trace with inputs and outputs of the root chain (defaults to true) */
  updateRoot?: boolean
}

/**
 * Result of a Langfuse server reachability and health check.
 */
export interface LangfuseHealthCheckResult {
  ok: boolean
  status?: number
  message?: string
  error?: string
}
