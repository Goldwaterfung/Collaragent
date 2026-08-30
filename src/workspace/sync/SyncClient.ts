
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
  | { type: 'sync-command'; command: TCommand; clientId: string; version: number }
  | { type: 'sync-ack'; version: number; clientVersion?: number; instanceId?: string }
  | { type: 'accept-changes'; instanceId: string; clientId: string }
  | { type: 'reject-changes'; instanceId: string; clientId: string }
  | { type: 'sync-changes'; instanceId: string; commands: TCommand[] }
  | { type: 'error'; code: string; message: string }
  | { type: 'system:reload' }
  | { type: 'hello'; clientId: string; [key: string]: unknown };

export type MessageHandler<TCommand, TSnapshot> = (message: WSMessage<TCommand, TSnapshot>) => void;
export type CommandHandler<TCommand> = (command: TCommand, meta: { clientId: string; version: number }) => void;

export interface SyncClientConfig<TCommand, TSnapshot> {
  host?: string;
  secure?: boolean;
  /**
   * Base path for the WebSocket endpoint (e.g., "ws/canvas" or "ws/editor").
   * Combined with instanceId: ws://host/path/instanceId
   */
  path?: string;
  /**
   * Optional reducer to maintain current state locally.
   */
  stateReducer?: (state: TSnapshot, command: TCommand) => TSnapshot;
  /**
   * Prefix for the generated clientId (e.g., "agent-" or "ui-").
   */
  clientIdPrefix?: string;
}

export interface SendOptions {
  version?: number;
  timeoutMs?: number;
}

export class SyncClient<TCommand = unknown, TSnapshot = unknown> {
  private socket: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler<TCommand, TSnapshot>> = new Set();
  private commandHandlers: Set<CommandHandler<TCommand>> = new Set();
  private clientId: string;
  private isConnected: boolean = false;
  private config: SyncClientConfig<TCommand, TSnapshot>;
  private instanceId: string | null = null;
  private currentState: TSnapshot | null = null;
  private readyResolver: (() => void) | null = null;
  private readyRejecter: ((reason: Error) => void) | null = null;
  private readyPromise: Promise<void> = new Promise((resolve, reject) => {
    this.readyResolver = resolve;
    this.readyRejecter = reject;
  });
  private clientVersionCounter: number = 0;
  private pendingAcks: Map<number, {
    resolve: (serverSeq: number) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(config: SyncClientConfig<TCommand, TSnapshot> = {}) {
    this.config = {
      host: 'localhost:3000', // Default, should be overridden
      secure: false,
      path: 'ws/canvas', // Default for backward compatibility
      ...config
    };
    this.clientId = this.generateClientId();
  }

  private generateClientId(): string {
    const prefix = this.config.clientIdPrefix || 'client-';
    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).slice(2);
    return `${prefix}${uuid}`;
  }

  /**
   * Connects to the WebSocket server for a specific instance.
   * @param instanceId The ID of the document/canvas to join
   */
  async connect(instanceId: string): Promise<void> {
    this.instanceId = instanceId;
    const protocol = this.config.secure ? 'wss' : 'ws';
    const url = `${protocol}://${this.config.host}/${this.config.path}/${instanceId}`;

    if (!this.readyResolver) {
      this.readyPromise = new Promise((resolve, reject) => {
        this.readyResolver = resolve;
        this.readyRejecter = reject;
      });
    }

    return new Promise((resolve, reject) => {
      // Isomorphic WebSocket check
      const globalObject: Record<string, unknown> = typeof globalThis !== 'undefined' ? (globalThis as Record<string, unknown>) : (global as Record<string, unknown>);
      const WS = typeof WebSocket !== 'undefined' 
        ? WebSocket 
        : (globalObject.WebSocket as (new (url: string) => WebSocket) | undefined);
      if (!WS) {
        throw new Error('WebSocket is not defined in this environment. Polyfill required.');
      }

      this.socket = new WS(url);

      this.socket!.onopen = () => {
        this.isConnected = true;
        this.sendHandshake();
        resolve();
      };

      this.socket!.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data as string) as WSMessage<TCommand, TSnapshot>;
            this.handleMessage(data);
        } catch (err) {
            console.error('Failed to parse WS message', err);
        }
      };

      this.socket!.onclose = () => {
        this.isConnected = false;
        const closeError = new Error('WebSocket closed');
        if (this.readyRejecter) {
          this.readyRejecter(closeError);
          this.readyRejecter = null;
          this.readyResolver = null;
        }
        this.drainPendingAcks(closeError);
      };

      this.socket!.onerror = (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('WebSocket error', error);
        if (!this.isConnected) {
            reject(error);
        }
        if (this.readyRejecter) {
          this.readyRejecter(error);
          this.readyRejecter = null;
          this.readyResolver = null;
        }
      };
    });
  }

  private sendHandshake() {
    this.sendRaw({
        type: 'join',
        clientId: this.clientId
    } as WSMessage<TCommand, TSnapshot>);
    
    // Immediately request sync
    this.requestSync();
  }

  requestSync() {
    this.sendRaw({
        type: 'sync-request'
    } as WSMessage<TCommand, TSnapshot>);
  }

  private sendRaw(message: WSMessage<TCommand, TSnapshot>) {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
        this.socket.send(JSON.stringify(message));
    } else {
        console.warn('Socket not open, cannot send', message);
    }
  }

  /**
   * Sends a command to the server and returns a promise that resolves
   * with the server's sequence number upon receiving a matching sync-ack.
   */
  send(command: TCommand, versionOrOptions?: number | SendOptions): Promise<number> {
    const version = typeof versionOrOptions === 'number'
      ? (versionOrOptions > 0 ? versionOrOptions : ++this.clientVersionCounter)
      : (versionOrOptions?.version ?? ++this.clientVersionCounter);

    const timeoutMs = typeof versionOrOptions === 'object' ? versionOrOptions?.timeoutMs : undefined;

    return new Promise<number>((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
        reject(new Error('Socket not open, cannot send command'));
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingAcks.delete(version);
          reject(new Error(`Timed out waiting for sync-ack on clientVersion ${version}`));
        }, timeoutMs);
      }

      this.pendingAcks.set(version, { resolve, reject, timer });

      this.sendRaw({
        type: 'sync-command',
        command,
        clientId: this.clientId,
        version
      } as WSMessage<TCommand, TSnapshot>);
    });
  }

  /**
   * Sends a batch of commands sequentially and resolves with all server sequence numbers.
   */
  async sendBatch(commands: TCommand[], options?: SendOptions): Promise<number[]> {
    const serverSeqs: number[] = [];
    for (const cmd of commands) {
      const seq = await this.send(cmd, options);
      serverSeqs.push(seq);
    }
    return serverSeqs;
  }

  /**
   * Accepts all pending staged changes for the current instance.
   */
  acceptChanges() {
    if (!this.instanceId) return;
    this.sendRaw({
      type: 'accept-changes',
      instanceId: this.instanceId,
      clientId: this.clientId
    } as WSMessage<TCommand, TSnapshot>);
  }

  /**
   * Rejects all pending staged changes for the current instance.
   */
  rejectChanges() {
    if (!this.instanceId) return;
    this.sendRaw({
      type: 'reject-changes',
      instanceId: this.instanceId,
      clientId: this.clientId
    } as WSMessage<TCommand, TSnapshot>);
  }

  private drainPendingAcks(error: Error) {
    for (const [, pending] of this.pendingAcks) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingAcks.clear();
  }

  /**
   * Disconnects the socket
   */
  disconnect() {
    const disconnectError = new Error('SyncClient disconnected');
    if (this.readyRejecter) {
      this.readyRejecter(disconnectError);
      this.readyRejecter = null;
      this.readyResolver = null;
    }
    this.drainPendingAcks(disconnectError);
    if (this.socket) {
        this.socket.close();
        this.socket = null;
    }
    this.isConnected = false;
  }

  /**
   * Subscribe to incoming commands
   */
  onCommand(handler: CommandHandler<TCommand>) {
    this.commandHandlers.add(handler);
    return () => this.commandHandlers.delete(handler);
  }

  /**
   * Subscribe to all protocol messages (e.g. sync-snapshot)
   */
  onMessage(handler: MessageHandler<TCommand, TSnapshot>) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  private handleMessage(message: WSMessage<TCommand, TSnapshot>) {
    // Notify general listeners
    this.messageHandlers.forEach(h => h(message));

    // Specific handling
    switch (message.type) {
        case 'sync-snapshot': {
            const snapshotCopy = { ...message } as Record<string, unknown>;
            delete snapshotCopy.type;
            delete snapshotCopy.version;
            this.currentState = snapshotCopy as TSnapshot;
            
            if (this.readyResolver) {
                this.readyResolver();
                this.readyResolver = null; // Fire once
                this.readyRejecter = null;
            }
            break;
        }
            
        case 'sync-command':
            // Update local state if reducer exists
            if (this.currentState && this.config.stateReducer) {
                this.currentState = this.config.stateReducer(this.currentState, message.command);
            }
            
            // Emit to handlers (exclude self)
            if (message.clientId !== this.clientId) {
                this.commandHandlers.forEach(h => h(message.command, { 
                    clientId: message.clientId, 
                    version: message.version 
                }));
            }
            break;
            
        case 'hello':
            // Can be used to confirm server-assigned clientId if needed
            break;

        case 'error': {
            const err = new Error(`[${message.code}] ${message.message}`);
            if (this.readyRejecter) {
                this.readyRejecter(err);
                this.readyRejecter = null;
                this.readyResolver = null;
            }
            this.drainPendingAcks(err);
            break;
        }

        case 'sync-ack': {
            const clientVersion = message.clientVersion;
            if (clientVersion !== undefined && this.pendingAcks.has(clientVersion)) {
                const pending = this.pendingAcks.get(clientVersion)!;
                if (pending.timer) clearTimeout(pending.timer);
                this.pendingAcks.delete(clientVersion);
                pending.resolve(message.version);
            }
            break;
        }
    }
  }

  /**
   * Gets the current cached state
   */
  getSnapshot(): TSnapshot | null {
    return this.currentState;
  }

  /**
   * Returns the client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Waits for the initial sync-snapshot to arrive
   */
  async waitForReady(): Promise<void> {
    if (this.currentState) return;
    return this.readyPromise;
  }
}
