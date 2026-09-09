import { SyncClient } from './SyncClient'
import { canvasStateReducer } from '../canvas/domain/canvasStateReducer'
import { CanvasSnapshot } from '@workspace/canvas/domain/types'
import { CanvasCommand, EditorCommand } from '@shared/commands'
import WebSocket from 'ws'

export {
  SyncClientPool,
  syncClientPool,
  withCanvasClient,
  withEditorClient
} from './SyncClientPool'

/**
 * Ensures that WebSocket is available in Node environments.
 */
const globalObject = globalThis as unknown as { WebSocket?: unknown }
if (typeof globalObject.WebSocket === 'undefined') {
  globalObject.WebSocket = WebSocket
}

/**
 * connectToCanvas establishes a SyncClient connection to a canvas instance.
 */
export async function connectToCanvas(
  instanceId: string,
  options?: { host?: string; port?: number; signal?: AbortSignal; timeoutMs?: number }
): Promise<SyncClient<CanvasCommand, CanvasSnapshot>> {
  const host = options?.host || process.env.WS_HOST || 'localhost'
  const port = options?.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined)
  if (!port) {
    throw new Error('No WebSocket port provided for connectToCanvas')
  }

  const client = new SyncClient<CanvasCommand, CanvasSnapshot>({
    host: `${host}:${port}`,
    secure: false,
    path: 'ws/canvas',
    stateReducer: canvasStateReducer,
    clientIdPrefix: 'agent-'
  })

  const connectOptions = {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs
  }
  await client.connect(instanceId, connectOptions)
  await client.waitForReady(connectOptions)

  return client
}

/**
 * connectToEditor establishes a SyncClient connection to an editor instance.
 */
export async function connectToEditor(
  instanceId: string,
  options?: { host?: string; port?: number; signal?: AbortSignal; timeoutMs?: number }
): Promise<SyncClient<EditorCommand, unknown>> {
  const host = options?.host || process.env.WS_HOST || 'localhost'
  const port = options?.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined)
  if (!port) {
    throw new Error('No WebSocket port provided for connectToEditor')
  }

  const client = new SyncClient<EditorCommand, unknown>({
    host: `${host}:${port}`,
    secure: false,
    path: 'ws/editor',
    clientIdPrefix: 'agent-'
  })

  const connectOptions = {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs
  }
  await client.connect(instanceId, connectOptions)
  await client.waitForReady(connectOptions)

  return client
}

/**
 * ConnectionOverrides identifies properties used to customize the WebSocket connection.
 */
export type ConnectionOverrides = {
  host?: string
  port?: number
  instanceId?: string
  clientId?: string
  signal?: AbortSignal
  timeoutMs?: number
}
