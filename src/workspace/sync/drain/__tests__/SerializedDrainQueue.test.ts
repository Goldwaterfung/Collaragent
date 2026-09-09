import { describe, it, expect, vi } from 'vitest'
import { SerializedDrainQueue } from '../SerializedDrainQueue'
import { SyncErrorCode, isSyncError } from '../errors'
import type {
  DocumentEditTrigger,
  CanvasSnapshotTrigger,
  DrainLifecycleEvent,
  InstancePersistenceAdapter,
  InstancePersistenceResult,
  DocumentPayload
} from '../types'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createDocTrigger = (instanceId: string, text: string): DocumentEditTrigger => ({
  type: 'trigger:document_edit',
  instanceId,
  timestamp: Date.now(),
  triggerId: crypto.randomUUID(),
  payload: {
    blocks: [
      {
        id: 'block-1',
        type: 'paragraph',
        content: text
      }
    ]
  }
})

const createCanvasTrigger = (instanceId: string): CanvasSnapshotTrigger => ({
  type: 'trigger:canvas_snapshot',
  instanceId,
  timestamp: Date.now(),
  triggerId: crypto.randomUUID(),
  payload: {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: {
      nodes: {
        node1: { id: 'node1', type: 'card', name: 'Card 1' }
      },
      relationships: {}
    },
    layout: {
      layoutByNodeId: {
        node1: { x: 0, y: 0, width: 100, height: 100 }
      }
    }
  }
})

describe('SerializedDrainQueue', () => {
  it('1. single mutation writes immediately with zero delay', async () => {
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => ({
      status: 'saved',
      bytesWritten: 128
    }))

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    const events: DrainLifecycleEvent[] = []
    queue.on((e) => events.push(e))

    queue.enqueue(createDocTrigger('doc-1', 'Immediate Write'))

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'doc-1'
      })
    )

    await queue.flush('doc-1')

    expect(queue.getState('doc-1')).toBe('IDLE')
    expect(events.map((e) => e.type)).toEqual(['drain:started', 'drain:completed', 'drain:idle'])
  })

  it('2. rapid sequential mutations coalesce into exactly one active write + one coalesced write', async () => {
    const deferredWrite1 = createDeferred<InstancePersistenceResult>()
    const deferredWrite2 = createDeferred<InstancePersistenceResult>()

    let callCount = 0
    const saveMock = vi.fn(
      async (_params: { payload: unknown }): Promise<InstancePersistenceResult> => {
        callCount++
        if (callCount === 1) {
          return deferredWrite1.promise
        }
        return deferredWrite2.promise
      }
    )

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    const events: DrainLifecycleEvent[] = []
    queue.on((e) => events.push(e))

    const secondWriteDispatched = new Promise<void>((resolve) => {
      let startedCount = 0
      queue.on((e) => {
        if (e.type === 'drain:started') {
          startedCount++
          if (startedCount === 2) {
            resolve()
          }
        }
      })
    })

    // Mutation 1 starts active write 1
    queue.enqueue(createDocTrigger('doc-1', 'Initial'))
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(queue.getState('doc-1')).toBe('DRAINING')

    // Rapid mutations 2 through 100 arrive while write 1 is in-flight
    for (let i = 2; i <= 100; i++) {
      queue.enqueue(createDocTrigger('doc-1', `Keystroke-${i}`))
    }

    expect(queue.getState('doc-1')).toBe('COALESCING')
    expect(saveMock).toHaveBeenCalledTimes(1) // Still only 1 write dispatched

    // Settle write 1; second write fires immediately via event-driven loop
    deferredWrite1.resolve({ status: 'saved', bytesWritten: 50 })
    await secondWriteDispatched

    // Immediately fired write 2 with the latest coalesced payload
    expect(saveMock).toHaveBeenCalledTimes(2)
    const secondCallPayload = saveMock.mock.calls[1][0].payload as DocumentPayload
    expect(secondCallPayload.blocks[0].content).toBe('Keystroke-100')

    // Settle write 2
    deferredWrite2.resolve({ status: 'saved', bytesWritten: 80 })
    await queue.flush('doc-1')

    expect(queue.getState('doc-1')).toBe('IDLE')
    expect(saveMock).toHaveBeenCalledTimes(2) // Exactly 2 writes executed for 100 edits
  })

  it('3. concurrent flush() awaits both active and coalesced writes and resolves upon disk settlement', async () => {
    const deferredWrite1 = createDeferred<InstancePersistenceResult>()
    const deferredWrite2 = createDeferred<InstancePersistenceResult>()

    let callCount = 0
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => {
      callCount++
      return callCount === 1 ? deferredWrite1.promise : deferredWrite2.promise
    })

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    queue.enqueue(createDocTrigger('doc-1', 'A'))
    queue.enqueue(createDocTrigger('doc-1', 'B'))

    let flush1Settled = false
    let flush2Settled = false
    let flush3Settled = false

    const p1 = queue.flush('doc-1').then(() => {
      flush1Settled = true
    })
    const p2 = queue.flush('doc-1').then(() => {
      flush2Settled = true
    })
    const p3 = queue.flush('doc-1').then(() => {
      flush3Settled = true
    })

    expect(flush1Settled).toBe(false)
    expect(flush2Settled).toBe(false)
    expect(flush3Settled).toBe(false)

    // Complete write 1; barriers must remain unsettled because write 2 is pending
    deferredWrite1.resolve({ status: 'saved' })
    await Promise.resolve()

    expect(flush1Settled).toBe(false)
    expect(flush2Settled).toBe(false)
    expect(flush3Settled).toBe(false)

    // Complete write 2; all barriers settle together
    deferredWrite2.resolve({ status: 'saved' })
    await Promise.all([p1, p2, p3])

    expect(flush1Settled).toBe(true)
    expect(flush2Settled).toBe(true)
    expect(flush3Settled).toBe(true)
    expect(queue.getState('doc-1')).toBe('IDLE')
  })

  it('4. AbortSignal aborts waiting barrier immediately with SYNC_DRAIN_ABORTED without corrupting worker', async () => {
    const deferredWrite = createDeferred<InstancePersistenceResult>()
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => deferredWrite.promise)

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    queue.enqueue(createDocTrigger('doc-1', 'AbortMe'))

    const abortController = new AbortController()
    const abortedFlushPromise = queue.flush('doc-1', { signal: abortController.signal })

    // Abort the barrier
    abortController.abort(new Error('Caller cancelled flush'))

    await expect(abortedFlushPromise).rejects.toSatisfy((err: unknown) => {
      return isSyncError(err) && err.code === SyncErrorCode.SYNC_DRAIN_ABORTED
    })

    // Active worker write finishes cleanly
    deferredWrite.resolve({ status: 'saved', bytesWritten: 100 })
    await queue.flush('doc-1')

    expect(queue.getState('doc-1')).toBe('IDLE')
  })

  it('5. transient failure triggers retry and resolves barrier upon recovery', async () => {
    let attempts = 0
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => {
      attempts++
      if (attempts === 1) {
        throw new Error('Transient SQLite locked error')
      }
      return { status: 'saved', bytesWritten: 99 }
    })

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({
      persistenceAdapter: adapter,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
      maxRetries: 3
    })

    const events: DrainLifecycleEvent[] = []
    queue.on((e) => events.push(e))

    queue.enqueue(createDocTrigger('doc-1', 'RetryData'))
    const flushPromise = queue.flush('doc-1')

    await flushPromise

    expect(attempts).toBe(2)
    expect(queue.getState('doc-1')).toBe('IDLE')

    const failedEvent = events.find((e) => e.type === 'drain:failed')
    const retryingEvent = events.find((e) => e.type === 'drain:retrying')
    const completedEvent = events.find((e) => e.type === 'drain:completed')

    expect(failedEvent).toBeDefined()
    if (failedEvent && failedEvent.type === 'drain:failed') {
      expect(failedEvent.willRetry).toBe(true)
      expect(failedEvent.retryCount).toBe(1)
    }

    expect(retryingEvent).toBeDefined()
    expect(completedEvent).toBeDefined()
  })

  it('6. persistent failure exhausts retries, transitions to FAULTED, and rejects barrier with SYNC_DRAIN_PERSIST_FAILED', async () => {
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => {
      throw new Error('EACCES: permission denied')
    })

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({
      persistenceAdapter: adapter,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
      maxRetries: 2
    })

    queue.enqueue(createDocTrigger('doc-1', 'FailData'))
    const flushPromise = queue.flush('doc-1')

    await expect(flushPromise).rejects.toSatisfy((err: unknown) => {
      return isSyncError(err) && err.code === SyncErrorCode.SYNC_DRAIN_PERSIST_FAILED
    })

    expect(queue.getState('doc-1')).toBe('FAULTED')
    // 1 initial attempt + 2 retries = 3 calls
    expect(saveMock).toHaveBeenCalledTimes(3)
  })

  it('7. instance deletion eviction disposes worker cleanly', async () => {
    const deferredWrite = createDeferred<InstancePersistenceResult>()
    const saveMock = vi.fn(async (): Promise<InstancePersistenceResult> => deferredWrite.promise)

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    queue.enqueue(createDocTrigger('doc-1', 'DeleteMe'))
    const flushPromise = queue.flush('doc-1')

    // Evict via trigger:instance_deleted
    queue.enqueue({
      type: 'trigger:instance_deleted',
      instanceId: 'doc-1',
      timestamp: Date.now(),
      triggerId: 'evict-1'
    })

    await expect(flushPromise).rejects.toSatisfy((err: unknown) => {
      return isSyncError(err) && err.code === SyncErrorCode.SYNC_DRAIN_QUEUE_DISPOSED
    })

    // State of evicted worker returns IDLE (untracked)
    expect(queue.getState('doc-1')).toBe('IDLE')
  })

  it('8. multi-instance global flush() awaits all instances in parallel', async () => {
    const deferredDoc = createDeferred<InstancePersistenceResult>()
    const deferredCanvas = createDeferred<InstancePersistenceResult>()

    const saveMock = vi.fn(
      async (params: { instanceId: string }): Promise<InstancePersistenceResult> => {
        if (params.instanceId === 'doc-1') {
          return deferredDoc.promise
        }
        return deferredCanvas.promise
      }
    )

    const adapter: InstancePersistenceAdapter = { saveInstance: saveMock }
    const queue = new SerializedDrainQueue({ persistenceAdapter: adapter })

    queue.enqueue(createDocTrigger('doc-1', 'Doc Payload'))
    queue.enqueue(createCanvasTrigger('canvas-1'))

    let globalFlushSettled = false
    const globalFlushPromise = queue.flush().then(() => {
      globalFlushSettled = true
    })

    expect(globalFlushSettled).toBe(false)

    // Complete doc-1; global flush still pending because canvas-1 is in-flight
    deferredDoc.resolve({ status: 'saved' })
    await Promise.resolve()
    expect(globalFlushSettled).toBe(false)

    // Complete canvas-1; global flush settles
    deferredCanvas.resolve({ status: 'saved' })
    await globalFlushPromise

    expect(globalFlushSettled).toBe(true)
    expect(queue.getState('doc-1')).toBe('IDLE')
    expect(queue.getState('canvas-1')).toBe('IDLE')
  })
})
