import { SyncClient } from "./SyncClient";
import { canvasStateReducer } from "../canvas/domain/canvasStateReducer";
import { CanvasSnapshot } from "@workspace/canvas/domain/types";
import { CanvasCommand, EditorCommand } from "@shared/commands";
import WebSocket from "ws";

export { SyncClientPool, syncClientPool, withCanvasClient, withEditorClient } from "./SyncClientPool";

/**
 * Ensures that WebSocket is available in Node environments.
 */
if (typeof WebSocket === "undefined") {
  (global as any).WebSocket = WebSocket;
}

/**
 * connectToCanvas establishes a SyncClient connection to a canvas instance.
 */
export async function connectToCanvas(
  instanceId: string, 
  options?: { host?: string; port?: number }
): Promise<SyncClient<CanvasCommand, CanvasSnapshot>> {
    const host = options?.host || process.env.WS_HOST || "localhost";
    const port = options?.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined);
    if (!port) {
        throw new Error("No WebSocket port provided for connectToCanvas");
    }
    
    const client = new SyncClient<CanvasCommand, CanvasSnapshot>({
        host: `${host}:${port}`,
        secure: false,
        path: 'ws/canvas',
        stateReducer: canvasStateReducer,
        clientIdPrefix: 'agent-'
    });

    await client.connect(instanceId);
    await client.waitForReady();
    
    return client;
}

/**
 * connectToEditor establishes a SyncClient connection to an editor instance.
 */
export async function connectToEditor(
  instanceId: string,
  options?: { host?: string; port?: number }
): Promise<SyncClient<EditorCommand, any>> {
    const host = options?.host || process.env.WS_HOST || "localhost";
    const port = options?.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined);
    if (!port) {
        throw new Error("No WebSocket port provided for connectToEditor");
    }
    
    const client = new SyncClient<EditorCommand, any>({
        host: `${host}:${port}`,
        secure: false,
        path: 'ws/editor',
        clientIdPrefix: 'agent-'
    });

    await client.connect(instanceId);
    await client.waitForReady();
    
    return client;
}

/**
 * ConnectionOverrides identifies properties used to customize the WebSocket connection.
 */
export type ConnectionOverrides = {
  host?: string;
  port?: number;
  instanceId?: string;
  clientId?: string;
};

/**
 * createSocket creates a raw WebSocket connection for the editor-content endpoint.
 * This is a legacy/interim utility until the Editor is fully migrated to SyncClient.
 */
export function createSocket(overrides: ConnectionOverrides = {}) {
  const host = overrides.host || process.env.WS_HOST || "localhost";
  const port = overrides.port || (process.env.WS_PORT ? Number(process.env.WS_PORT) : undefined);
  const instanceId = overrides.instanceId || "default";
  const clientId = overrides.clientId || `agent-${Math.random().toString(36).slice(2)}`;

  // Connect to the /ws/editor-content endpoint that the server expects
  const url = `ws://${host}:${port}/ws/editor-content`;
  const ws = new WebSocket(url);

  const waitForOpen = () => new Promise<void>((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
          resolve();
      } else {
          ws.once("open", () => resolve());
          ws.once("error", (err) => reject(err));
      }
  });

  const waitForClose = () => new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
  });

  return {
    ws,
    connection: { instanceId, clientId },
    waitForOpen,
    waitForClose
  };
}
