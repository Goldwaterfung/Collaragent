import { describe, it, expect } from 'vitest'
import { BackoffPolicyEngine } from '../BackoffPolicyEngine'
import { DRAIN_QUEUE_CONSTANTS } from '../constants'

describe('BackoffPolicyEngine', () => {
  it('uses default configuration constants when none are provided', () => {
    const engine = new BackoffPolicyEngine()

    expect(engine.config.maxRetries).toBe(DRAIN_QUEUE_CONSTANTS.DEFAULT_MAX_RETRIES)
    expect(engine.config.baseBackoffMs).toBe(DRAIN_QUEUE_CONSTANTS.DEFAULT_BASE_BACKOFF_MS)
    expect(engine.config.maxBackoffMs).toBe(DRAIN_QUEUE_CONSTANTS.DEFAULT_MAX_BACKOFF_MS)
  })

  it('calculates pure exponential delay without jitter when random generator returns 1.0', () => {
    const deterministicEngine = new BackoffPolicyEngine(
      { baseBackoffMs: 50, maxBackoffMs: 1000 },
      () => 1.0
    )

    // attempt 0: 50 * 2^0 * 1 = 50
    expect(deterministicEngine.calculateDelay(0)).toBe(50)
    // attempt 1: 50 * 2^1 * 1 = 100
    expect(deterministicEngine.calculateDelay(1)).toBe(100)
    // attempt 2: 50 * 2^2 * 1 = 200
    expect(deterministicEngine.calculateDelay(2)).toBe(200)
    // attempt 3: 50 * 2^3 * 1 = 400
    expect(deterministicEngine.calculateDelay(3)).toBe(400)
    // attempt 4: 50 * 2^4 * 1 = 800
    expect(deterministicEngine.calculateDelay(4)).toBe(800)
  })

  it('clamps calculated delay at maxBackoffMs ceiling', () => {
    const deterministicEngine = new BackoffPolicyEngine(
      { baseBackoffMs: 50, maxBackoffMs: 1000 },
      () => 1.0
    )

    // attempt 5: 50 * 2^5 = 1600 -> clamped to 1000
    expect(deterministicEngine.calculateDelay(5)).toBe(1000)
    // attempt 10: 50 * 2^10 = 51200 -> clamped to 1000
    expect(deterministicEngine.calculateDelay(10)).toBe(1000)
  })

  it('scales delay with injected random generator factor for jitter', () => {
    const halfJitterEngine = new BackoffPolicyEngine(
      { baseBackoffMs: 100, maxBackoffMs: 1000 },
      () => 0.5
    )

    // attempt 1: 100 * 2^1 * 0.5 = 100
    expect(halfJitterEngine.calculateDelay(1)).toBe(100)

    const zeroJitterEngine = new BackoffPolicyEngine(
      { baseBackoffMs: 100, maxBackoffMs: 1000 },
      () => 0.0
    )

    expect(zeroJitterEngine.calculateDelay(1)).toBe(0)
  })

  it('handles negative attempts safely by clamping to 0', () => {
    const engine = new BackoffPolicyEngine({ baseBackoffMs: 50, maxBackoffMs: 1000 }, () => 1.0)

    expect(engine.calculateDelay(-1)).toBe(50)
    expect(engine.calculateDelay(-10)).toBe(50)
  })

  it('correctly evaluates shouldRetry based on 1-indexed attempt number', () => {
    const engine = new BackoffPolicyEngine({ maxRetries: 3 })

    expect(engine.shouldRetry(0)).toBe(false)
    expect(engine.shouldRetry(1)).toBe(true)
    expect(engine.shouldRetry(2)).toBe(true)
    expect(engine.shouldRetry(3)).toBe(true)
    expect(engine.shouldRetry(4)).toBe(false)
    expect(engine.shouldRetry(5)).toBe(false)
    expect(engine.shouldRetry(-1)).toBe(false)
  })
})
