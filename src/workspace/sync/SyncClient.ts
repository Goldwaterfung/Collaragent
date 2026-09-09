import { SyncError, SyncErrorCode } from '@shared/errors/SyncErrors'

// --- Protocol Definitions ---

/**
 * Generic WebSocket message envelope for synchronization.
 * TCommand: The type of incremental updates.
 * TSnapshot: The type of the full state snapshot.
 */
export type WSMessage<TCommand = unknown, TSnapshot = unknown> =
  | { type: 'join'; clientId: string }
  | { type: 'sync-request'; version?: number }
  | ({ type: 'sync-snapshot'; version: number } & TSnapshot)
  | {
      type: 'sync-command'
      command: TCommand
      clientId: string
      version: number
      threadId?: string
      baseVersion?: number
    }
  | { type: 'sync-ack'; version: number; clientVersion?: number; instanceId?: string }
  | { type: 'accept-changes'; instanceId: string; clientId: string; threadId?: string }
  | { type: 'reject-changes'; instanceId: string; clientId: string; threadId?: string }
  | { type: 'sync-changes'; instanceId: string; threadId?: string; commands: TCommand[] }
  | { type: 'error'; code: string; message: string; currentVersion?: number }
  | { type: 'system:reload' }
  | { type: 'hello'; clientId: string; [key: string]: unknown }

export type MessageHandler<TCommand, TSnapshot> = (message: WSMessage<TCommand, TSnapshot>) => void
export type CommandHandler<TCommand> = (
  command: TCommand,
  meta: { clientId: string; version: number }
) => void

export interface SyncClientConfig<TCommand, TSnapshot> {
  host?: string
  secure?: boolean
  /**
   * Base path for the WebSocket endpoint (e.g., "ws/canvas" or "ws/editor").
   * Combined with instanceId: ws://host/path/instanceId
   */
  path?: string
  /**
   * Optional reducer to maintain current state locally.
   */
  stateReducer?: (state: TSnapshot, command: TCommand) => TSnapshot
  /**
   * Prefix for the generated clientId (e.g., "agent-" or "ui-").
   */
  clientIdPrefix?: string
}

export interface SendOptions {
  version?: number
  timeoutMs?: number
  threadId?: string
  baseVersion?: number
  signal?: AbortSignal
}

export interface ConnectOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

interface PendingAck {
  resolve: (serverSeq: number) => void
  reject: (err: Error) => void
  cleanup: () => void
}

export class SyncClient<TCommand = unknown, TSnapshot = unknown> {
  private socket: WebSocket | null = null
  private messageHandlers: Set<MessageHandler<TCommand, TSnapshot>> = new Set()
  private commandHandlers: Set<CommandHandler<TCommand>> = new Set()
  private clientId: string
  private isConnected: boolean = false
  private config: SyncClientConfig<TCommand, TSnapshot>
  private instanceId: string | null = null
  private currentState: TSnapshot | null = null
  private serverVersion: number | null = null
  private readyResolver: (() => void) | null = null
  private readyRejecter: ((reason: Error) => void) | null = null
  private readyPromise: Promise<void> | null = null
  private clientVersionCounter: number = 0
  private pendingAcks: Map<number, PendingAck> = new Map()

  constructor(config: SyncClientConfig<TCommand, TSnapshot> = {}) {
    this.config = {
      host: 'localhost:3000', // Default, should be overridden
      secure: false,
      path: 'ws/canvas', // Default for backward compatibility
      ...config
    }
    this.clientId = this.generateClientId()
    this.ensureReadyPromise()
  }

  private generateClientId(): string {
    const prefix = this.config.clientIdPrefix || 'client-'
    const uuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    return `${prefix}${uuid}`
  }

  private ensureReadyPromise(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve, reject) => {
        this.readyResolver = resolve
        this.readyRejecter = reject
      })
      // Attach a default no-op catch handler to avoid Uncaught (in promise)
      // if disconnect() rejects before a consumer calls waitForReady()
      this.readyPromise.catch(() => {})
    }
    return this.readyPromise
  }

  /**
   * Connects to the WebSocket server for a specific instance.
   * @param instanceId The ID of the document/canvas to join
   * @param options Connection options including optional AbortSignal and timeoutMs
   */
  async connect(instanceId: string, options?: ConnectOptions): Promise<void> {
    this.instanceId = instanceId
    const protocol = this.config.secure ? 'wss' : 'ws'
    const url = `${protocol}://${this.config.host}/${this.config.path}/${instanceId}`

    this.ensureReadyPromise()

    const signal = options?.signal
    const timeoutMs = options?.timeoutMs
    const effectiveSignal =
      signal && timeoutMs !== undefined
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : (signal ?? (timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined))

    if (effectiveSignal?.aborted) {
      const isTimeout =
        effectiveSignal.reason instanceof DOMException &&
        effectiveSignal.reason.name === 'TimeoutError'
      return Promise.reject(
        new SyncError(
          isTimeout ? SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT : SyncErrorCode.SYNC_DRAIN_ABORTED,
          isTimeout ? 'Connection timed out before dispatch' : 'Connection aborted before dispatch',
          {
            cause: effectiveSignal.reason instanceof Error ? effectiveSignal.reason : undefined,
            details: { reason: effectiveSignal.reason }
          }
        )
      )
    }

    return new Promise((resolve, reject) => {
      // Isomorphic WebSocket check
      const globalObject: Record<string, unknown> =
        typeof globalThis !== 'undefined'
          ? (globalThis as Record<string, unknown>)
          : (global as Record<string, unknown>)
      const WS =
        typeof WebSocket !== 'undefined'
          ? WebSocket
          : (globalObject.WebSocket as (new (url: string) => WebSocket) | undefined)
      if (!WS) {
        throw new Error('WebSocket is not defined in this environment. Polyfill required.')
      }

      this.socket = new WS(url)

      let settled = false
      let cleanedUp = false

      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        if (effectiveSignal) {
          effectiveSignal.removeEventListener('abort', onAbort)
        }
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        if (this.socket) {
          this.socket.close()
          this.socket = null
        }
        this.isConnected = false
        const isTimeout =
          effectiveSignal!.reason instanceof DOMException &&
          effectiveSignal!.reason.name === 'TimeoutError'
        const error = new SyncError(
          isTimeout ? SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT : SyncErrorCode.SYNC_DRAIN_ABORTED,
          isTimeout ? 'Connection timed out' : 'Connection aborted',
          { cause: effectiveSignal!.reason instanceof Error ? effectiveSignal!.reason : undefined }
        )
        if (this.readyRejecter) {
          this.readyRejecter(error)
          this.readyRejecter = null
          this.readyResolver = null
        }
        reject(error)
      }

      if (effectiveSignal) {
        effectiveSignal.addEventListener('abort', onAbort, { once: true })
      }

      this.socket!.onopen = () => {
        if (settled) return
        settled = true
        cleanup()
        this.isConnected = true
        this.sendHandshake()
        resolve()
      }

      this.socket!.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as WSMessage<TCommand, TSnapshot>
          this.handleMessage(data)
        } catch (err) {
          console.error('Failed to parse WS message', err)
        }
      }

      this.socket!.onclose = () => {
        this.isConnected = false
        const closeError = new Error('WebSocket closed')
        if (this.readyRejecter) {
          this.readyRejecter(closeError)
          this.readyRejecter = null
          this.readyResolver = null
        }
        this.drainPendingAcks(closeError)
      }

      this.socket!.onerror = (err) => {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('WebSocket error', error)
        if (!this.isConnected && !settled) {
          settled = true
          cleanup()
          reject(error)
        }
        if (this.readyRejecter) {
          this.readyRejecter(error)
          this.readyRejecter = null
          this.readyResolver = null
        }
      }
    })
  }

  private sendHandshake() {
    this.sendRaw({
      type: 'join',
      clientId: this.clientId
    } as WSMessage<TCommand, TSnapshot>)

    // Immediately request sync
    this.requestSync()
  }

  requestSync() {
    this.sendRaw({
      type: 'sync-request'
    } as WSMessage<TCommand, TSnapshot>)
  }

  private sendRaw(message: WSMessage<TCommand, TSnapshot>) {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message))
    } else {
      console.warn('Socket not open, cannot send', message)
    }
  }

  /**
   * Sends a command to the server and returns a promise that resolves
   * with the server's sequence number upon receiving a matching sync-ack.
   */
  send(command: TCommand, versionOrOptions?: number | SendOptions): Promise<number> {
    const version =
      typeof versionOrOptions === 'number'
        ? versionOrOptions > 0
          ? versionOrOptions
          : ++this.clientVersionCounter
        : (versionOrOptions?.version ?? ++this.clientVersionCounter)

    const timeoutMs = typeof versionOrOptions === 'object' ? versionOrOptions?.timeoutMs : undefined
    const threadId = typeof versionOrOptions === 'object' ? versionOrOptions?.threadId : undefined
    const baseVersion =
      typeof versionOrOptions === 'object' ? versionOrOptions?.baseVersion : undefined
    const signal = typeof versionOrOptions === 'object' ? versionOrOptions?.signal : undefined

    // Pre-flight Check: If signal?.aborted on entry, reject immediately without dispatching
    if (signal?.aborted) {
      return Promise.reject(
        new SyncError(SyncErrorCode.SYNC_DRAIN_ABORTED, 'Send operation aborted before dispatch', {
          details: { version, reason: signal.reason }
        })
      )
    }

    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      return Promise.reject(new Error('Socket not open, cannot send command'))
    }

    const effectiveSignal =
      signal && timeoutMs !== undefined
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : (signal ?? (timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined))

    if (effectiveSignal?.aborted) {
      const isTimeout =
        effectiveSignal.reason instanceof DOMException &&
        effectiveSignal.reason.name === 'TimeoutError'
      return Promise.reject(
        new SyncError(
          isTimeout ? SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT : SyncErrorCode.SYNC_DRAIN_ABORTED,
          isTimeout
            ? `Timed out waiting for sync-ack on clientVersion ${version}`
            : `Command send aborted on clientVersion ${version}`,
          {
            cause: effectiveSignal.reason instanceof Error ? effectiveSignal.reason : undefined
          }
        )
      )
    }

    return new Promise<number>((resolve, reject) => {
      let settled = false
      let cleanedUp = false

      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        if (effectiveSignal) {
          effectiveSignal.removeEventListener('abort', onAbort)
        }
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        this.pendingAcks.delete(version)
        cleanup()
        const isTimeout =
          effectiveSignal!.reason instanceof DOMException &&
          effectiveSignal!.reason.name === 'TimeoutError'
        if (isTimeout) {
          reject(
            new SyncError(
              SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT,
              `Timed out waiting for sync-ack on clientVersion ${version}`,
              {
                cause:
                  effectiveSignal!.reason instanceof Error ? effectiveSignal!.reason : undefined
              }
            )
          )
        } else {
          reject(
            new SyncError(
              SyncErrorCode.SYNC_DRAIN_ABORTED,
              `Command send aborted on clientVersion ${version}`,
              {
                cause:
                  effectiveSignal!.reason instanceof Error ? effectiveSignal!.reason : undefined
              }
            )
          )
        }
      }

      if (effectiveSignal) {
        effectiveSignal.addEventListener('abort', onAbort, { once: true })
      }

      this.pendingAcks.set(version, {
        resolve: (serverSeq: number) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(serverSeq)
        },
        reject: (err: Error) => {
          if (settled) return
          settled = true
          cleanup()
          reject(err)
        },
        cleanup
      })

      this.sendRaw({
        type: 'sync-command',
        command,
        clientId: this.clientId,
        version,
        ...(threadId ? { threadId } : {}),
        ...(baseVersion !== undefined ? { baseVersion } : {})
      } as WSMessage<TCommand, TSnapshot>)
    })
  }

  /**
   * Sends a batch of commands sequentially and resolves with all server sequence numbers.
   */
  async sendBatch(commands: TCommand[], options?: SendOptions): Promise<number[]> {
    if (options?.signal?.aborted) {
      throw new SyncError(
        SyncErrorCode.SYNC_DRAIN_ABORTED,
        'Send operation aborted before dispatch',
        { details: { reason: options.signal.reason } }
      )
    }
    const serverSeqs: number[] = []
    let currentOptions = options
    for (const cmd of commands) {
      const seq = await this.send(cmd, currentOptions)
      serverSeqs.push(seq)
      if (currentOptions?.baseVersion !== undefined) {
        currentOptions = { ...currentOptions, baseVersion: seq }
      }
    }
    return serverSeqs
  }

  /**
   * Accepts all pending staged changes for the current instance (optionally filtered by thread).
   */
  acceptChanges(threadId?: string) {
    if (!this.instanceId) return
    this.sendRaw({
      type: 'accept-changes',
      instanceId: this.instanceId,
      clientId: this.clientId,
      ...(threadId ? { threadId } : {})
    } as WSMessage<TCommand, TSnapshot>)
  }

  /**
   * Rejects all pending staged changes for the current instance (optionally filtered by thread).
   */
  rejectChanges(threadId?: string) {
    if (!this.instanceId) return
    this.sendRaw({
      type: 'reject-changes',
      instanceId: this.instanceId,
      clientId: this.clientId,
      ...(threadId ? { threadId } : {})
    } as WSMessage<TCommand, TSnapshot>)
  }

  private drainPendingAcks(error: Error) {
    for (const [, pending] of this.pendingAcks) {
      pending.cleanup()
      pending.reject(error)
    }
    this.pendingAcks.clear()
  }

  /**
   * Disconnects the socket
   */
  disconnect() {
    const disconnectError = new Error('SyncClient disconnected')
    if (this.readyRejecter) {
      this.readyRejecter(disconnectError)
      this.readyRejecter = null
      this.readyResolver = null
    }
    this.drainPendingAcks(disconnectError)
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    this.isConnected = false
  }

  /**
   * Subscribe to incoming commands
   */
  onCommand(handler: CommandHandler<TCommand>) {
    this.commandHandlers.add(handler)
    return () => this.commandHandlers.delete(handler)
  }

  /**
   * Subscribe to all protocol messages (e.g. sync-snapshot)
   */
  onMessage(handler: MessageHandler<TCommand, TSnapshot>) {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  private handleMessage(message: WSMessage<TCommand, TSnapshot>) {
    // Notify general listeners
    this.messageHandlers.forEach((h) => h(message))

    // Specific handling
    switch (message.type) {
      case 'sync-snapshot': {
        const snapshotCopy = { ...message } as Record<string, unknown>
        delete snapshotCopy.type
        delete snapshotCopy.version
        this.currentState = snapshotCopy as TSnapshot
        this.serverVersion = message.version

        if (this.readyResolver) {
          this.readyResolver()
          this.readyResolver = null // Fire once
          this.readyRejecter = null
        }
        break
      }

      case 'sync-command':
        this.serverVersion = message.version
        // Update local state if reducer exists
        if (this.currentState && this.config.stateReducer) {
          this.currentState = this.config.stateReducer(this.currentState, message.command)
        }

        // Emit to handlers (exclude self)
        if (message.clientId !== this.clientId) {
          this.commandHandlers.forEach((h) =>
            h(message.command, {
              clientId: message.clientId,
              version: message.version
            })
          )
        }
        break

      case 'hello':
        // Can be used to confirm server-assigned clientId if needed
        break

      case 'error': {
        const err = new Error(`[${message.code}] ${message.message}`)
        if (this.readyRejecter) {
          this.readyRejecter(err)
          this.readyRejecter = null
          this.readyResolver = null
        }
        this.drainPendingAcks(err)
        break
      }

      case 'sync-ack': {
        this.serverVersion = message.version
        const clientVersion = message.clientVersion
        if (clientVersion !== undefined && this.pendingAcks.has(clientVersion)) {
          const pending = this.pendingAcks.get(clientVersion)!
          pending.cleanup()
          this.pendingAcks.delete(clientVersion)
          pending.resolve(message.version)
        }
        break
      }
    }
  }

  /**
   * Gets the current cached state
   */
  getSnapshot(): TSnapshot | null {
    return this.currentState
  }

  /**
   * Returns the latest server sequence/version number observed.
   */
  getServerVersion(): number | null {
    return this.serverVersion
  }

  /**
   * Returns the client ID
   */
  getClientId(): string {
    return this.clientId
  }

  /**
   * Returns the count of pending acks currently awaiting server confirmation.
   */
  getPendingAcksCount(): number {
    return this.pendingAcks.size
  }

  /**
   * Waits for the initial sync-snapshot to arrive
   * @param options Connection options including optional AbortSignal and timeoutMs
   */
  async waitForReady(options?: ConnectOptions): Promise<void> {
    if (this.currentState) return
    const signal = options?.signal
    const timeoutMs = options?.timeoutMs

    const effectiveSignal =
      signal && timeoutMs !== undefined
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : (signal ?? (timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined))

    if (effectiveSignal?.aborted) {
      const isTimeout =
        effectiveSignal.reason instanceof DOMException &&
        effectiveSignal.reason.name === 'TimeoutError'
      throw new SyncError(
        isTimeout ? SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT : SyncErrorCode.SYNC_DRAIN_ABORTED,
        isTimeout
          ? 'Timed out waiting for initial sync snapshot'
          : 'Wait for initial sync snapshot aborted',
        {
          cause: effectiveSignal.reason instanceof Error ? effectiveSignal.reason : undefined,
          details: { reason: effectiveSignal.reason }
        }
      )
    }

    if (!effectiveSignal) {
      return this.ensureReadyPromise()
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let cleanedUp = false

      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        effectiveSignal.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        const isTimeout =
          effectiveSignal.reason instanceof DOMException &&
          effectiveSignal.reason.name === 'TimeoutError'
        reject(
          new SyncError(
            isTimeout ? SyncErrorCode.SYNC_DRAIN_BARRIER_TIMEOUT : SyncErrorCode.SYNC_DRAIN_ABORTED,
            isTimeout
              ? 'Timed out waiting for initial sync snapshot'
              : 'Wait for initial sync snapshot aborted',
            {
              cause: effectiveSignal.reason instanceof Error ? effectiveSignal.reason : undefined,
              details: { reason: effectiveSignal.reason }
            }
          )
        )
      }

      effectiveSignal.addEventListener('abort', onAbort, { once: true })

      this.ensureReadyPromise()
        .then(() => {
          if (settled) return
          settled = true
          cleanup()
          resolve()
        })
        .catch((err) => {
          if (settled) return
          settled = true
          cleanup()
          reject(err)
        })
    })
  }
}
