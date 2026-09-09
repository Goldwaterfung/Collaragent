import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncClient } from '../SyncClient'
import { SyncErrorCode, isSyncError } from '@shared/errors/SyncErrors'

class MockWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  public readonly OPEN = 1
  public readonly CLOSED = 3
  public readyState: number = MockWebSocket.OPEN
  public onopen: (() => void) | null = null
  public onclose: (() => void) | null = null
  public onerror: ((err: unknown) => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public sentMessages: string[] = []

  constructor(public url: string) {}

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose()
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    if (this.onopen) this.onopen()
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  simulateError(err: unknown): void {
    if (this.onerror) {
      this.onerror(err)
    }
  }
}

const originalWebSocket = globalThis.WebSocket
let lastCreatedSocket: MockWebSocket | null = null

function installMockWebSocket(): void {
  lastCreatedSocket = null
  const MockWSConstructor = function (url: string) {
    const socket = new MockWebSocket(url)
    lastCreatedSocket = socket
    return socket
  } as unknown as typeof WebSocket
  ;(MockWSConstructor as unknown as { OPEN: number; CLOSED: number }).OPEN = 1
  ;(MockWSConstructor as unknown as { OPEN: number; CLOSED: number }).CLOSED = 3
  globalThis.WebSocket = MockWSConstructor
}

function restoreWebSocket(): void {
  globalThis.WebSocket = originalWebSocket
}

describe('SyncClient', () => {
  beforeEach(() => {
    installMockWebSocket()
  })

  afterEach(() => {
    restoreWebSocket()
    vi.restoreAllMocks()
  })

  it('sendBatch advances baseVersion with each returned server sequence', async () => {
    const client = new SyncClient<{ type: string }, Record<string, unknown>>({
      host: 'localhost:1234'
    })

    const capturedOptions: Array<{ baseVersion?: number; threadId?: string } | undefined> = []

    let simulatedServerSeq = 10
    vi.spyOn(client, 'send').mockImplementation(async (_cmd, options) => {
      capturedOptions.push(typeof options === 'object' ? { ...options } : undefined)
      simulatedServerSeq += 1
      return simulatedServerSeq
    })

    const commands = [{ type: 'test:cmd_1' }, { type: 'test:cmd_2' }, { type: 'test:cmd_3' }]

    const seqs = await client.sendBatch(commands, { threadId: 'thread-1', baseVersion: 10 })

    expect(seqs).toEqual([11, 12, 13])
    expect(capturedOptions).toEqual([
      { threadId: 'thread-1', baseVersion: 10 },
      { threadId: 'thread-1', baseVersion: 11 },
      { threadId: 'thread-1', baseVersion: 12 }
    ])
  })

  it('sendBatch preserves undefined baseVersion when none provided', async () => {
    const client = new SyncClient<{ type: string }, Record<string, unknown>>({
      host: 'localhost:1234'
    })

    const capturedOptions: Array<{ baseVersion?: number } | undefined> = []

    vi.spyOn(client, 'send').mockImplementation(async (_cmd, options) => {
      capturedOptions.push(typeof options === 'object' ? { ...options } : undefined)
      return 1
    })

    await client.sendBatch([{ type: 'test:cmd_1' }, { type: 'test:cmd_2' }])

    expect(capturedOptions).toEqual([undefined, undefined])
  })

  it('1. send() with pre-aborted AbortSignal rejects immediately with SYNC_DRAIN_ABORTED and does not dispatch message', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller = new AbortController()
    controller.abort(new Error('Pre-aborted reason'))

    const initialSentCount = lastCreatedSocket!.sentMessages.length

    await expect(
      client.send({ type: 'test:cmd' }, { signal: controller.signal, version: 1 })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message === 'Send operation aborted before dispatch'
      )
    })

    expect(lastCreatedSocket!.sentMessages.length).toBe(initialSentCount)
    expect(client.getPendingAcksCount()).toBe(0)
  })

  it('2. send() with active AbortSignal aborts during wait for sync-ack, removes from pendingAcks, and cleans up listener', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller = new AbortController()
    let abortListenersCount = 0
    const originalAdd = controller.signal.addEventListener.bind(controller.signal)
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)

    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'abort') abortListenersCount++
        return originalAdd(type, listener, options)
      }
    )
    vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'abort') abortListenersCount--
        return originalRemove(type, listener, options)
      }
    )

    const sendPromise = client.send(
      { type: 'test:cmd' },
      { signal: controller.signal, version: 10 }
    )

    expect(client.getPendingAcksCount()).toBe(1)
    expect(abortListenersCount).toBe(1)

    controller.abort(new Error('Turn aborted'))

    await expect(sendPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message.includes('Command send aborted on clientVersion 10')
      )
    })

    expect(client.getPendingAcksCount()).toBe(0)
    expect(abortListenersCount).toBe(0)
  })

  it('3. normal sync-ack receipt resolves promise and cleans up abort listener', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller = new AbortController()
    let abortListenersCount = 0
    const originalAdd = controller.signal.addEventListener.bind(controller.signal)
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)

    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'abort') abortListenersCount++
        return originalAdd(type, listener, options)
      }
    )
    vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
      (type, listener, options) => {
        if (type === 'abort') abortListenersCount--
        return originalRemove(type, listener, options)
      }
    )

    const sendPromise = client.send(
      { type: 'test:cmd' },
      { signal: controller.signal, version: 42 }
    )

    expect(client.getPendingAcksCount()).toBe(1)
    expect(abortListenersCount).toBe(1)

    lastCreatedSocket!.simulateMessage({
      type: 'sync-ack',
      version: 100,
      clientVersion: 42
    })

    const seq = await sendPromise
    expect(seq).toBe(100)
    expect(client.getPendingAcksCount()).toBe(0)
    expect(abortListenersCount).toBe(0)
  })

  it('4. timeoutMs combined with signal rejects on timeout with SYNC_DRAIN_BARRIER_TIMEOUT', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller = new AbortController()

    await expect(
      client.send({ type: 'test:cmd' }, { signal: controller.signal, timeoutMs: 1, version: 77 })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT &&
        err.message.includes('Timed out waiting for sync-ack on clientVersion 77')
      )
    })

    expect(client.getPendingAcksCount()).toBe(0)
  })

  it('5. sendBatch() cancels mid-batch if aborted between commands, rejecting immediately', async () => {
    const client = new SyncClient<{ type: string }, Record<string, unknown>>({
      host: 'localhost:1234'
    })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller = new AbortController()

    let sendCount = 0
    const originalSend = client.send.bind(client)
    vi.spyOn(client, 'send').mockImplementation(async (cmd, opts) => {
      sendCount++
      if (sendCount === 1) {
        controller.abort(new Error('Aborted mid-batch'))
        return 101
      }
      return originalSend(cmd, opts)
    })

    const batchPromise = client.sendBatch(
      [{ type: 'cmd_1' }, { type: 'cmd_2' }, { type: 'cmd_3' }],
      { signal: controller.signal }
    )

    await expect(batchPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message === 'Send operation aborted before dispatch'
      )
    })

    expect(sendCount).toBe(2)
  })

  it('6. connect() and waitForReady() reject immediately on caller abort signal', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })

    // 1. connect() with pre-aborted signal
    const preAborted = AbortSignal.abort(new Error('Pre-aborted connect'))
    await expect(client.connect('test-inst', { signal: preAborted })).rejects.toSatisfy(
      (err: unknown) => {
        return (
          isSyncError(err) &&
          err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
          err.message === 'Connection aborted before dispatch'
        )
      }
    )

    // 2. connect() aborted during handshake
    const controllerConnect = new AbortController()
    const activeConnectPromise = client.connect('test-inst', { signal: controllerConnect.signal })
    controllerConnect.abort(new Error('Connect aborted in-flight'))
    await expect(activeConnectPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message === 'Connection aborted'
      )
    })

    // 3. waitForReady() with pre-aborted signal
    const client2 = new SyncClient({ host: 'localhost:1234' })
    await expect(client2.waitForReady({ signal: preAborted })).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message === 'Wait for initial sync snapshot aborted'
      )
    })

    // 4. waitForReady() aborted while waiting for snapshot
    const controllerReady = new AbortController()
    const waitPromise = client2.waitForReady({ signal: controllerReady.signal })
    controllerReady.abort(new Error('Ready aborted in-flight'))
    await expect(waitPromise).rejects.toSatisfy((err: unknown) => {
      return (
        isSyncError(err) &&
        err.code === SyncErrorCode.SYNC_DRAIN_ABORTED &&
        err.message === 'Wait for initial sync snapshot aborted'
      )
    })
  })

  it('7. disconnect() drains pending acks and cleans up all listeners cleanly', async () => {
    const client = new SyncClient({ host: 'localhost:1234' })
    const connectPromise = client.connect('test-inst')
    lastCreatedSocket!.simulateOpen()
    await connectPromise

    const controller1 = new AbortController()
    const controller2 = new AbortController()

    let cleanedUpCount = 0
    const trackCleanup = (controller: AbortController) => {
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal)
      vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(
        (type, listener, opts) => {
          if (type === 'abort') cleanedUpCount++
          return originalRemove(type, listener, opts)
        }
      )
    }

    trackCleanup(controller1)
    trackCleanup(controller2)

    const p1 = client.send({ type: 'cmd_1' }, { signal: controller1.signal, version: 1 })
    const p2 = client.send({ type: 'cmd_2' }, { signal: controller2.signal, version: 2 })

    expect(client.getPendingAcksCount()).toBe(2)

    client.disconnect()

    await expect(p1).rejects.toThrow('SyncClient disconnected')
    await expect(p2).rejects.toThrow('SyncClient disconnected')

    expect(client.getPendingAcksCount()).toBe(0)
    expect(cleanedUpCount).toBe(2)
  })
})
