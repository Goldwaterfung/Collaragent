import { CollarError, type CollarErrorOptions } from './CollarError'

/**
 * Centralized, typed const enum error codes scoped by SESSION_ subsystem prefix.
 * Conforms to .agents/rules/coding-rules.md Section 6.
 */
export const enum SessionErrorCode {
  SESSION_RESTORE_FAILED = 'SESSION_RESTORE_FAILED',
  SESSION_BUNDLE_NOT_FOUND = 'SESSION_BUNDLE_NOT_FOUND',
  SESSION_BRANCH_DIVERGED = 'SESSION_BRANCH_DIVERGED',
  SESSION_STREAM_PAYLOAD_UNCONSUMED = 'SESSION_STREAM_PAYLOAD_UNCONSUMED'
}

export interface SessionErrorOptions extends CollarErrorOptions {}

/**
 * Structured domain error for Chat Session and Branch/Checkpoint Restore operations.
 * Preserves upstream causes and provides deterministic wire-safe translation.
 */
export class SessionError extends CollarError {
  public override readonly code: SessionErrorCode
  public override readonly subsystem = 'SESSION' as const

  constructor(code: SessionErrorCode, message: string, options?: SessionErrorOptions)
  constructor(code: SessionErrorCode, message: string, details?: unknown, cause?: Error)
  constructor(
    code: SessionErrorCode,
    message: string,
    optionsOrDetails?: SessionErrorOptions | unknown,
    maybeCause?: Error
  ) {
    let options: SessionErrorOptions | undefined
    if (
      optionsOrDetails &&
      typeof optionsOrDetails === 'object' &&
      ('details' in optionsOrDetails ||
        'recoverable' in optionsOrDetails ||
        'cause' in optionsOrDetails)
    ) {
      options = optionsOrDetails as SessionErrorOptions
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
 * Type guard for SessionError.
 */
export function isSessionError(err: unknown): err is SessionError {
  return err instanceof SessionError
}
