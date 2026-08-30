import { 
    BaseCheckpointSaver, 
    Checkpoint, 
    CheckpointMetadata, 
    CheckpointTuple, 
    SerializerProtocol,
    PendingWrite
} from "@langchain/langgraph-checkpoint";

/**
 * A CheckpointSaver that communicates with the local filesystemAPI via HTTP.
 * This is used by the Main Process to persist agent state into the project's .cagent file.
 */
export class ChatCheckpointSaver extends BaseCheckpointSaver {
    private baseUrl: string;
    private latestCheckpointIds: Map<string, string> = new Map();

    constructor(port: number, serde?: SerializerProtocol) {
        super(serde);
        this.baseUrl = `http://localhost:${port}/api/persistence`;
    }

    private buildCheckpointKey(threadId: string, checkpointNs: string): string {
        return `${threadId}:${checkpointNs}`;
    }

    async getLatestCheckpointId(threadId: string, checkpointNs: string = ""): Promise<string | undefined> {
        const key = this.buildCheckpointKey(threadId, checkpointNs);
        if (this.latestCheckpointIds.has(key)) {
            return this.latestCheckpointIds.get(key);
        }

        const url = `${this.baseUrl}/checkpoints/${threadId}/latest?checkpoint_ns=${encodeURIComponent(checkpointNs)}&raw=true`;

        try {
            const response = await fetch(url);
            if (response.status === 404 || response.status === 204) return undefined;
            if (!response.ok) {
                throw new Error(`Failed to get latest checkpoint: ${response.statusText}`);
            }

            const tuple = await response.json();
            const checkpointId = tuple?.config?.configurable?.checkpoint_id || tuple?.checkpoint?.id;
            if (checkpointId) {
                this.latestCheckpointIds.set(key, checkpointId);
            }
            return checkpointId;
        } catch (error) {
            console.error('[ChatCheckpointSaver] Error getting latest checkpoint id:', error);
            return undefined;
        }
    }

    async getTuple(config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }): Promise<CheckpointTuple | undefined> {
        const thread_id = config.configurable?.thread_id;
        const checkpoint_ns = config.configurable?.checkpoint_ns || "";
        const checkpoint_id = config.configurable?.checkpoint_id;

        if (!thread_id) return undefined;

        let url = `${this.baseUrl}/checkpoints/${thread_id}/latest?checkpoint_ns=${encodeURIComponent(checkpoint_ns)}&raw=true`;
        if (checkpoint_id) {
            url += `&checkpoint_id=${encodeURIComponent(checkpoint_id)}`;
        }

        try {
            const response = await fetch(url);
            if (response.status === 404 || response.status === 204) return undefined;
            
            const text = await response.text();
            if (!text || text.trim() === "") return undefined;
            
            const data = JSON.parse(text);
            if (!data) return undefined;
            
            // Hydrate the channel values from the raw serialized data
            const channel_values: Record<string, any> = {};
            if (data.checkpoint && data.checkpoint.channel_values) {
                for (const [key, value] of Object.entries(data.checkpoint.channel_values)) {
                    // value is { type, blob, serialized }
                    const rawValue = value as any;
                    if (rawValue && rawValue.type) {
                        try {
                             if (rawValue.serialized) {
                                // Convert blob back to Uint8Array if it was stringified
                                const blobData = typeof rawValue.blob === 'string' 
                                    ? new TextEncoder().encode(rawValue.blob)
                                    : rawValue.blob;
                                channel_values[key] = await this.serde.loadsTyped(rawValue.type, blobData);
                             } else {
                                channel_values[key] = rawValue.blob;
                             }
                        } catch (e) {
                             console.error(`[ChatCheckpointSaver] Failed to hydrate channel ${key}:`, e);
                             throw e;
                        }
                    } else {
                        channel_values[key] = rawValue;
                    }
                }
                data.checkpoint.channel_values = channel_values;
            }

            return data as CheckpointTuple;
        } catch (error) {
            console.error('[ChatCheckpointSaver] Error getting tuple:', error);
            return undefined;
        }
    }

    async *list(
        config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }, 
        options?: { before?: { configurable?: { checkpoint_id?: string } }; limit?: number; filter?: Record<string, any> }
    ): AsyncGenerator<CheckpointTuple> {
        const thread_id = config.configurable?.thread_id;
        const checkpoint_ns = config.configurable?.checkpoint_ns || "";
        
        if (!thread_id) return;

        const params = new URLSearchParams();
        params.append('checkpoint_ns', checkpoint_ns);
        if (options?.limit) params.append('limit', String(options.limit));
        if (options?.before?.configurable?.checkpoint_id) params.append('before', options.before.configurable.checkpoint_id);
        
        // Note: Filter object query params implementation isn't standard, usually needs serialization-
        // In this V1 simple implementation, we might skip complex filters over HTTP unless needed.

        try {
            const response = await fetch(`${this.baseUrl}/checkpoints/${thread_id}?${params.toString()}`);
            if (!response.ok) throw new Error(`Failed to list checkpoints: ${response.statusText}`);
            
            const list: CheckpointTuple[] = await response.json();
            for (const item of list) {
                yield item;
            }
        } catch (error) {
            console.error('[ChatCheckpointSaver] Error listing checkpoints:', error);
        }
    }

    async put(
        config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } },
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        newVersions: Record<string, string | number>
    ): Promise<{ configurable: { thread_id: string; checkpoint_ns: string; checkpoint_id: string } }> {
        // Serialize blobs locally to preserve types (e.g. ToolMessage) before sending over JSON
        const blobs: Record<string, any> = {};
        if (checkpoint.channel_values && newVersions) {
            for (const [channel] of Object.entries(newVersions)) {
                const val = checkpoint.channel_values[channel];
                if (val !== undefined) {
                    try {
                        const [type, serializedValue] = await this.serde.dumpsTyped(val);
                        // Convert Uint8Array to string for JSON transport
                        const blobData = new TextDecoder().decode(serializedValue);
                        blobs[channel] = {
                            type,
                            blob: blobData,
                            serialized: true
                        };
                    } catch (e) {
                         console.error(`[ChatCheckpointSaver] Failed to serialize blob for ${channel}:`, e);
                         throw e;
                    }
                }
            }
        }

        const payload = {
            config,
            checkpoint, // send full checkpoint, but server might use blobs priority
            metadata,
            newVersions,
            blobs
        };

        const response = await fetch(`${this.baseUrl}/checkpoints`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to put checkpoint: ${response.statusText}`);
        }

        const result = await response.json();
        const threadId = result?.configurable?.thread_id || config.configurable?.thread_id;
        const checkpointNs = result?.configurable?.checkpoint_ns || config.configurable?.checkpoint_ns || "";
        const checkpointId = result?.configurable?.checkpoint_id || checkpoint.id;
        if (threadId && checkpointId) {
            const key = this.buildCheckpointKey(threadId, checkpointNs);
            this.latestCheckpointIds.set(key, checkpointId);
        }
        return result;
    }

    async putWrites(
        config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }, 
        writes: PendingWrite[], 
        taskId: string
    ): Promise<void> {
        const payload = {
            config,
            writes,
            taskId
        };

        const response = await fetch(`${this.baseUrl}/writes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to put writes: ${response.statusText}`);
        }
    }
    
    async deleteThread(threadId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/threads/${threadId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete thread: ${response.statusText}`);
        }

        const prefix = `${threadId}:`;
        for (const key of this.latestCheckpointIds.keys()) {
            if (key.startsWith(prefix)) {
                this.latestCheckpointIds.delete(key);
            }
        }
    }
}
