import { describe, it, expect } from 'vitest'
import { COLLAR_CHECKPOINT_RESTORED_EVENT, type CheckpointRestoredDetail } from '../events'

describe('checkpoint events contract', () => {
  it('defines COLLAR_CHECKPOINT_RESTORED_EVENT constant', () => {
    expect(COLLAR_CHECKPOINT_RESTORED_EVENT).toBe('collar:checkpoint-restored')
  })

  it('adheres to CheckpointRestoredDetail structure', () => {
    const detail: CheckpointRestoredDetail = {
      threadId: 'thread-123',
      bundleId: 'bundle-456',
      timestamp: 1725888000000
    }
    expect(detail.threadId).toBe('thread-123')
    expect(detail.bundleId).toBe('bundle-456')
    expect(detail.timestamp).toBeGreaterThan(0)
  })
})
