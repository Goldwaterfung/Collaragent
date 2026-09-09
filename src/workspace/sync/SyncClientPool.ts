import { SyncClient, type SyncClientConfig } from './SyncClient'
import { canvasStateReducer } from '../canvas/domain/canvasStateReducer'
import type { CanvasSnapshot } from '@workspace/canvas/domain/types'
import type { CanvasCommand, EditorCommand } from '@shared/commands'
import { SyncError, SyncErrorCode } from '@shared/errors/SyncErrors'

export interface PoolConnectionOptions {
  instanceId: string
  host?: string
  port?: number
  path?: string
  clientIdPrefix?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export class SyncClientPool {
  private static instance: SyncClientPool
  private pool = new Map<string, SyncClient<unknown, unknown>>()

  public static getInstance(): SyncClientPool {
    if (!SyncClientPool.instance) {
      SyncClientPool.instance = new SyncClientPool()
    }
    return SyncClientPool.instance
  }

  private buildKey(path: string, instanceId: string, host: string, port: number): string {
    return `${path}:${instanceId}@${host}:${port}`
  }

  /**
   * Retrieves an active connected client from the pool, or creates and connects a new one.
   */
  async getClient<TCommand = unknown, TSnapshot = unknown>(
    options: PoolConnectionOptions & {
      stateReducer?: (state: TSnapshot, command: TCommand) => TSnapshot
    }
  ): Promise<SyncClient<TCommand, TSnapshot>> {
    const host = options.host || process.env.WS_HOST || 'localhost'
    const port = options.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined)
    if (!port) {
      throw new Error(
        `No WebSocket port provided for SyncClientPool connection on instance '${options.instanceId}'`
      )
    }

    const path = options.path || 'ws/canvas'
    const key = this.buildKey(path, options.instanceId, host, port)

    let client = this.pool.get(key) as unknown as SyncClient<TCommand, TSnapshot> | undefined

    if (client) {
      if (options.signal?.aborted) {
        throw new SyncError(
          SyncErrorCode.SYNC_DRAIN_ABORTED,
          'Operation aborted before acquiring client',
          { details: { reason: options.signal.reason } }
        )
      }
      return client
    }

    const config: SyncClientConfig<TCommand, TSnapshot> = {
      host: `${host}:${port}`,
      secure: false,
      path,
      stateReducer: options.stateReducer,
      clientIdPrefix: options.clientIdPrefix || 'agent-'
    }

    client = new SyncClient<TCommand, TSnapshot>(config)
    const connectOptions = {
      signal: options.signal,
      timeoutMs: options.timeoutMs
    }
    await client.connect(options.instanceId, connectOptions)
    await client.waitForReady(connectOptions)

    this.pool.set(key, client as unknown as SyncClient<unknown, unknown>)
    return client
  }

  /**
   * Executes an operation against a pooled client without tearing down the connection afterwards.
   */
  async withClient<TCommand, TSnapshot, R>(
    options: PoolConnectionOptions & {
      stateReducer?: (state: TSnapshot, command: TCommand) => TSnapshot
    },
    operation: (client: SyncClient<TCommand, TSnapshot>) => Promise<R>
  ): Promise<R> {
    const client = await this.getClient<TCommand, TSnapshot>(options)
    return await operation(client)
  }

  /**
   * Disposes a specific instance connection from the pool.
   */
  disposeInstance(instanceId: string): void {
    for (const [key, client] of this.pool.entries()) {
      if (key.includes(`:${instanceId}@`)) {
        client.disconnect()
        this.pool.delete(key)
      }
    }
  }

  /**
   * Disposes all pooled client connections.
   */
  disposeAll(): void {
    for (const [, client] of this.pool.entries()) {
      client.disconnect()
    }
    this.pool.clear()
  }
}

export const syncClientPool = SyncClientPool.getInstance()

/**
 * Executes an operation with a warm Canvas SyncClient connection.
 */
export async function withCanvasClient<R>(
  instanceId: string,
  options: { host?: string; port?: number; signal?: AbortSignal; timeoutMs?: number },
  operation: (client: SyncClient<CanvasCommand, CanvasSnapshot>) => Promise<R>
): Promise<R> {
  return syncClientPool.withClient<CanvasCommand, CanvasSnapshot, R>(
    {
      instanceId,
      path: 'ws/canvas',
      host: options.host,
      port: options.port,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      stateReducer: canvasStateReducer,
      clientIdPrefix: 'agent-'
    },
    operation
  )
}

/**
 * Executes an operation with a warm Editor SyncClient connection.
 */
export async function withEditorClient<R>(
  instanceId: string,
  options: { host?: string; port?: number; signal?: AbortSignal; timeoutMs?: number },
  operation: (client: SyncClient<EditorCommand, unknown>) => Promise<R>
): Promise<R> {
  return syncClientPool.withClient<EditorCommand, unknown, R>(
    {
      instanceId,
      path: 'ws/editor',
      host: options.host,
      port: options.port,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      clientIdPrefix: 'agent-'
    },
    operation
  )
}
