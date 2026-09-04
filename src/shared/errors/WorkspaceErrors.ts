import { CollarError, type CollarErrorOptions } from './CollarError'

/**
 * Centralized, typed const enum error codes scoped by WORKSPACE_ subsystem prefix.
 * Conforms to .agents/rules/coding-rules.md Section 6.
 */
export const enum WorkspaceErrorCode {
  WORKSPACE_CLUSTER_EXECUTION_FAILED = 'WORKSPACE_CLUSTER_EXECUTION_FAILED',
  WORKSPACE_INVALID_CLUSTER_SPEC = 'WORKSPACE_INVALID_CLUSTER_SPEC',
  WORKSPACE_LAYOUT_COMPUTATION_FAILED = 'WORKSPACE_LAYOUT_COMPUTATION_FAILED',
  WORKSPACE_CLUSTER_ABORTED = 'WORKSPACE_CLUSTER_ABORTED',
  WORKSPACE_GRAPH_NOT_FOUND = 'WORKSPACE_GRAPH_NOT_FOUND',
  WORKSPACE_SYNC_DISCONNECTED = 'WORKSPACE_SYNC_DISCONNECTED'
}

export interface WorkspaceErrorOptions extends CollarErrorOptions {}

/**
 * Structured domain error for Canvas, Workspace, and Clustering operations.
 * Preserves upstream causes and provides deterministic wire-safe translation.
 */
export class WorkspaceError extends CollarError {
  public override readonly code: WorkspaceErrorCode
  public override readonly subsystem = 'WORKSPACE' as const

  constructor(code: WorkspaceErrorCode, message: string, options?: WorkspaceErrorOptions)
  constructor(code: WorkspaceErrorCode, message: string, details?: unknown, cause?: Error)
  constructor(
    code: WorkspaceErrorCode,
    message: string,
    optionsOrDetails?: WorkspaceErrorOptions | unknown,
    maybeCause?: Error
  ) {
    let options: WorkspaceErrorOptions | undefined
    if (
      optionsOrDetails &&
      typeof optionsOrDetails === 'object' &&
      ('details' in optionsOrDetails ||
        'recoverable' in optionsOrDetails ||
        'cause' in optionsOrDetails)
    ) {
      options = optionsOrDetails as WorkspaceErrorOptions
    } else {
      options = {
        details: optionsOrDetails,
        cause: maybeCause
      }
    }

    super(message, options)
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Type guard for WorkspaceError.
 */
export function isWorkspaceError(err: unknown): err is WorkspaceError {
  return err instanceof WorkspaceError
}
