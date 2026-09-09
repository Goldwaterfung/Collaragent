import { DRAIN_QUEUE_CONSTANTS } from './constants'
import type { BackoffPolicyConfig, IBackoffPolicyEngine } from './types'

/**
 * Pure mathematical exponential backoff engine with full jitter.
 * Complies with Coding Rule 2.1 (no hardcoded constants) and Rule 4.1 (Zero any policy).
 * Zero side-effects, zero thread sleep, zero setTimeout.
 */
export class BackoffPolicyEngine implements IBackoffPolicyEngine {
  public readonly config: Readonly<BackoffPolicyConfig>
  private readonly randomGenerator: () => number

  constructor(config?: Partial<BackoffPolicyConfig>, randomGenerator: () => number = Math.random) {
    this.config = Object.freeze({
      maxRetries: config?.maxRetries ?? DRAIN_QUEUE_CONSTANTS.DEFAULT_MAX_RETRIES,
      baseBackoffMs: config?.baseBackoffMs ?? DRAIN_QUEUE_CONSTANTS.DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: config?.maxBackoffMs ?? DRAIN_QUEUE_CONSTANTS.DEFAULT_MAX_BACKOFF_MS
    })
    this.randomGenerator = randomGenerator
  }

  /**
   * Pure mathematical calculation of exponential backoff delay with full jitter:
   * delay = min(maxBackoffMs, baseBackoffMs * 2^attempt) * random()
   */
  public calculateDelay(attempt: number): number {
    const safeAttempt = Math.max(0, attempt)
    const exponentialMultiplier = Math.pow(DRAIN_QUEUE_CONSTANTS.EXPONENTIAL_BASE, safeAttempt)
    const uncappedDelay = this.config.baseBackoffMs * exponentialMultiplier
    const cappedDelay = Math.min(this.config.maxBackoffMs, uncappedDelay)
    const jitterFactor = Math.max(0, Math.min(1, this.randomGenerator()))

    return Math.round(cappedDelay * jitterFactor)
  }

  /**
   * Determines whether a retry should be attempted for the given 1-indexed attempt number.
   * e.g., for maxRetries = 3: attempt 1, 2, 3 return true; attempt 4 returns false.
   */
  public shouldRetry(attempt: number): boolean {
    return attempt > 0 && attempt <= this.config.maxRetries
  }
}
