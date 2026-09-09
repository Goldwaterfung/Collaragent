/**
 * Centralized constants for the Event-Driven Serialized Drain Subsystem.
 * Enforces Coding Rule 2.1 (Hardcoded values or parameters are forbidden).
 */

export const DRAIN_QUEUE_CONSTANTS = {
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_BASE_BACKOFF_MS: 50,
  DEFAULT_MAX_BACKOFF_MS: 1000,
  INITIAL_RETRY_COUNT: 0,
  INITIAL_DURATION_MS: 0,
  DEFAULT_BYTES_WRITTEN: 0,
  EXPONENTIAL_BASE: 2
} as const
