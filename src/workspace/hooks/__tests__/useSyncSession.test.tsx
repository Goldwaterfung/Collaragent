// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSyncSession } from '../useSyncSession'
import { setSyncPaused } from '../../sync/syncPause'

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
}

interface TestSnapshot {
  blocks: string[]
}

interface TestCommand {
  type: string
  payload?: unknown
}

let activeSocket: MockWebSocket | null = null
const originalWebSocket = globalThis.WebSocket

function installMockWebSocket(): void {
  activeSocket = null
  const MockWSConstructor = function (url: string) {
    const socket = new MockWebSocket(url)
    activeSocket = socket
    return socket
  } as unknown as typeof WebSocket
  ;(MockWSConstructor as unknown as { OPEN: number; CLOSED: number }).OPEN = 1
  ;(MockWSConstructor as unknown as { OPEN: number; CLOSED: number }).CLOSED = 3
  globalThis.WebSocket = MockWSConstructor
}

describe('useSyncSession', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    installMockWebSocket()
    setSyncPaused(false)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    setSyncPaused(false)
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    if (container) {
      container.remove()
      container = null
    }
    globalThis.WebSocket = originalWebSocket
    activeSocket = null
  })

  function setupHook(options: {
    onSnapshot: (snap: TestSnapshot) => void
    onRemoteCommand: (cmd: TestCommand) => void
    localHandlerRef?: { current: ((cmd: TestCommand) => void) | null }
  }) {
    let hookResult: ReturnType<
      typeof useSyncSession<TestCommand, TestSnapshot, TestCommand>
    > | null = null

    function TestComponent() {
      const res = useSyncSession<TestCommand, TestSnapshot, TestCommand>({
        instanceId: 'test-instance',
        path: 'ws/test',
        host: 'localhost:1234',
        onSnapshot: options.onSnapshot,
        onRemoteCommand: options.onRemoteCommand,
        subscribeToLocal: (handler) => {
          if (options.localHandlerRef) {
            options.localHandlerRef.current = handler
          }
          return () => {
            if (options.localHandlerRef) {
              options.localHandlerRef.current = null
            }
          }
        },
        mapLocalToShared: (cmd) => cmd
      })
      hookResult = res
      return <div>Hook Mounted</div>
    }

    act(() => {
      root?.render(<TestComponent />)
    })

    if (activeSocket) {
      act(() => {
        activeSocket?.simulateOpen()
      })
    }

    return {
      getHookResult: () => hookResult,
      getSocket: () => activeSocket
    }
  }

  it('delivers sync-snapshot immediately when unpaused', () => {
    const onSnapshot = vi.fn()
    const onRemoteCommand = vi.fn()
    const { getSocket } = setupHook({ onSnapshot, onRemoteCommand })

    const socket = getSocket()
    expect(socket).not.toBeNull()

    act(() => {
      socket?.simulateMessage({
        type: 'sync-snapshot',
        version: 1,
        blocks: ['block-1']
      })
    })

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot).toHaveBeenCalledWith({ blocks: ['block-1'] })
  })

  it('buffers sync-snapshot while paused and applies upon resume', () => {
    const onSnapshot = vi.fn()
    const onRemoteCommand = vi.fn()
    const { getSocket } = setupHook({ onSnapshot, onRemoteCommand })

    const socket = getSocket()
    expect(socket).not.toBeNull()

    // 1. Quiesce pause begins
    act(() => {
      setSyncPaused(true)
    })

    // 2. Snapshot arrives during quiesce
    act(() => {
      socket?.simulateMessage({
        type: 'sync-snapshot',
        version: 5,
        blocks: ['restored-block']
      })
    })

    // Must NOT be applied yet
    expect(onSnapshot).not.toHaveBeenCalled()

    // 3. Resume lifts the pause
    act(() => {
      setSyncPaused(false)
    })

    // Must be applied immediately upon resume
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot).toHaveBeenCalledWith({ blocks: ['restored-block'] })

    // And requestSync was invoked to confirm latest server version
    const sent = socket?.sentMessages ?? []
    const hasSyncRequest = sent.some((msg) => {
      try {
        const parsed = JSON.parse(msg) as { type?: string }
        return parsed.type === 'sync-request'
      } catch {
        return false
      }
    })
    expect(hasSyncRequest).toBe(true)
  })

  it('drops incoming commands and suppresses outbound commands while paused', () => {
    const onSnapshot = vi.fn()
    const onRemoteCommand = vi.fn()
    const localHandlerRef: { current: ((cmd: TestCommand) => void) | null } = { current: null }
    const { getSocket } = setupHook({ onSnapshot, onRemoteCommand, localHandlerRef })

    const socket = getSocket()
    expect(socket).not.toBeNull()

    // Pause sync
    act(() => {
      setSyncPaused(true)
    })

    // Incoming remote command
    act(() => {
      socket?.simulateMessage({
        type: 'sync-command',
        command: { type: 'test:remote' },
        clientId: 'remote-1',
        version: 2
      })
    })
    expect(onRemoteCommand).not.toHaveBeenCalled()

    // Outbound local command
    const sentCountBefore = socket?.sentMessages.length ?? 0
    act(() => {
      localHandlerRef.current?.({ type: 'test:local' })
    })
    expect(socket?.sentMessages.length).toBe(sentCountBefore)

    // Unpause
    act(() => {
      setSyncPaused(false)
    })

    // Outbound command should now be sent
    act(() => {
      localHandlerRef.current?.({ type: 'test:local-after-resume' })
    })
    expect(socket?.sentMessages.length).toBeGreaterThan(sentCountBefore)
  })
})
