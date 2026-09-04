/**
 * CollarAgent Base Error Class
 * Conforms to .agents/rules/coding-rules.md Section 6 and ADR-001/002 error standards.
 *
 * This base class is strictly platform-agnostic (no Electron, DOM, or Node.js native module dependencies)
 * so it can be safely used across Main, Renderer, Preload, UtilityProcess, and Shared domains.
 */

export interface CollarErrorOptions {
  details?: unknown
  recoverable?: boolean
  cause?: Error
}

export abstract class CollarError extends Error {
  public abstract readonly code: string
  public abstract readonly subsystem: string
  public readonly details?: unknown
  public readonly recoverable: boolean
  public override readonly cause?: Error

  constructor(message: string, options?: CollarErrorOptions) {
    super(message, options?.cause ? { cause: options.cause } : undefined)
    this.name = this.constructor.name
    this.details = options?.details
    this.recoverable = options?.recoverable ?? false
    this.cause = options?.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
