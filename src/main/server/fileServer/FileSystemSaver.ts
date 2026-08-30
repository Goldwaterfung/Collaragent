import { 
  BaseCheckpointSaver, 
  Checkpoint, 
  CheckpointMetadata, 
  CheckpointTuple, 
  SerializerProtocol,
  PendingWrite
} from "@langchain/langgraph-checkpoint";
import { CheckpointStore } from "./CheckpointStore";
import { CheckpointRecord, CheckpointBlobRecord, CheckpointWriteRecord } from "./storageEngine";

export class FileSystemSaver extends BaseCheckpointSaver {
  private store: CheckpointStore;

  constructor(store: CheckpointStore, serde?: SerializerProtocol) {
    super(serde);
    this.store = store;
  }

  async setRestoreHead(threadId: string, checkpointId: string, checkpointNs: string = ""): Promise<void> {
    if (!threadId || !checkpointId) return;
    await this.store.setRestoreHead(threadId, checkpointId, checkpointNs);
  }

  async getRestoreHead(threadId: string, checkpointNs: string = ""): Promise<string | undefined> {
    if (!threadId) return undefined;
    return this.store.getRestoreHead(threadId, checkpointNs);
  }

  async clearRestoreHead(threadId: string, checkpointNs: string = ""): Promise<void> {
    if (!threadId) return;
    await this.store.clearRestoreHead(threadId, checkpointNs);
  }

  async getTuple(config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns || "";
    const checkpoint_id = config.configurable?.checkpoint_id;

    if (!thread_id) return undefined;

    const threadCheckpoints = await this.store.getCheckpoints(thread_id);
    
    let record: CheckpointRecord | undefined;

    if (checkpoint_id) {
      record = threadCheckpoints.find(
        (cp) => cp.checkpoint_id === checkpoint_id && cp.checkpoint_ns === checkpoint_ns
      );
    } else {
      const restoreHeadId = await this.getRestoreHead(thread_id, checkpoint_ns);
      if (restoreHeadId) {
        record = threadCheckpoints.find(
          (cp) => cp.checkpoint_id === restoreHeadId && cp.checkpoint_ns === checkpoint_ns,
        );
      }

      if (!record) {
        const nsCheckpoints = threadCheckpoints.filter(cp => cp.checkpoint_ns === checkpoint_ns);
        if (nsCheckpoints.length > 0) {
          record = nsCheckpoints[nsCheckpoints.length - 1];
        }
      }
    }

    if (!record) return undefined;

    const channel_values: Record<string, any> = {};
    if (record.checkpoint.channel_versions) {
      for (const [channel, version] of Object.entries(record.checkpoint.channel_versions)) {
        const blobKey = `${thread_id}:${channel}:${version}`;
        const blobRecord = await this.store.getBlob(blobKey);
        if (blobRecord && blobRecord.type !== 'empty') {
          if (blobRecord.type && blobRecord.blob !== undefined) {
            try {
              if (blobRecord.serialized) {
                const blobData = typeof blobRecord.blob === 'string' 
                  ? new TextEncoder().encode(blobRecord.blob)
                  : blobRecord.blob;
                channel_values[channel] = await this.serde.loadsTyped(blobRecord.type, blobData);
              } else {
                channel_values[channel] = blobRecord.blob;
              }
            } catch (e) {
              console.error(`[FileSystemSaver] Failed to deserialize blob for ${channel}:`, e);
              throw e;
            }
          }
        }
      }
    }

    const pendingWrites: [string, string, any][] = [];
    const threadWrites = await this.store.getWrites(thread_id, record.checkpoint_id);
    const matchingWrites = threadWrites.filter(w => w.checkpoint_ns === checkpoint_ns); // Just to verify
    
    matchingWrites.forEach(w => {
       pendingWrites.push([w.task_id, w.channel, w.blob]); 
    });

    const finalCheckpoint: Checkpoint = {
        ...record.checkpoint,
        channel_values
    };
    
    const finalConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: record.checkpoint_id,
      },
    };
    
    const parentConfig = record.parent_checkpoint_id
      ? {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: record.parent_checkpoint_id,
          },
        }
      : undefined;

    return {
      config: finalConfig,
      checkpoint: finalCheckpoint,
      metadata: record.metadata,
      parentConfig,
      pendingWrites
    };
  }

  async getRawTuple(config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }): Promise<any | undefined> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns || "";
    const checkpoint_id = config.configurable?.checkpoint_id;

    if (!thread_id) return undefined;

    const threadCheckpoints = await this.store.getCheckpoints(thread_id);
    
    let record: CheckpointRecord | undefined;

    if (checkpoint_id) {
      record = threadCheckpoints.find(
        (cp) => cp.checkpoint_id === checkpoint_id && cp.checkpoint_ns === checkpoint_ns
      );
    } else {
      const restoreHeadId = await this.getRestoreHead(thread_id, checkpoint_ns);
      if (restoreHeadId) {
        record = threadCheckpoints.find(
          (cp) => cp.checkpoint_id === restoreHeadId && cp.checkpoint_ns === checkpoint_ns,
        );
      }

      if (!record) {
        const nsCheckpoints = threadCheckpoints.filter(cp => cp.checkpoint_ns === checkpoint_ns);
        if (nsCheckpoints.length > 0) {
          record = nsCheckpoints[nsCheckpoints.length - 1];
        }
      }
    }

    if (!record) return undefined;

    const channel_values: Record<string, any> = {};
    if (record.checkpoint.channel_versions) {
      for (const [channel, version] of Object.entries(record.checkpoint.channel_versions)) {
        const blobKey = `${thread_id}:${channel}:${version}`;
        const blobRecord = await this.store.getBlob(blobKey);
        if (blobRecord) {
             channel_values[channel] = {
                 type: blobRecord.type,
                 blob: blobRecord.blob,
                 serialized: blobRecord.serialized
             };
        }
      }
    }

    const pendingWrites: [string, string, any][] = [];
    const matchingWrites = await this.store.getWrites(thread_id, record.checkpoint_id);
    
    matchingWrites.forEach(w => {
       pendingWrites.push([w.task_id, w.channel, w.blob]); 
    });

    const finalCheckpoint = {
        ...record.checkpoint,
        channel_values
    };
    
    const finalConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: record.checkpoint_id,
      },
    };
    
    const parentConfig = record.parent_checkpoint_id
      ? {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: record.parent_checkpoint_id,
          },
        }
      : undefined;

    return {
      config: finalConfig,
      checkpoint: finalCheckpoint,
      metadata: record.metadata,
      parentConfig,
      pendingWrites
    };
  }

  async deleteThread(threadId: string): Promise<void> {
      if (!threadId) return;
      await this.store.deleteThread(threadId);
  }

  async *list(
    config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } }, 
    options?: { before?: { configurable?: { checkpoint_id?: string } }; limit?: number; filter?: Record<string, any> }
  ): AsyncGenerator<CheckpointTuple> {
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;
    
    if (!thread_id) return;

    let records = await this.store.getCheckpoints(thread_id);

    if (checkpoint_ns !== undefined) {
        records = records.filter(r => r.checkpoint_ns === checkpoint_ns);
    }

    if (options?.before?.configurable?.checkpoint_id) {
        const beforeId = options.before.configurable.checkpoint_id;
        const idx = records.findIndex(r => r.checkpoint_id === beforeId);
        if (idx !== -1) {
            records = records.slice(0, idx);
        }
    }
    
    const reversed = [...records].reverse();

    let count = 0;
    for (const record of reversed) {
        if (options?.limit && count >= options.limit) break;
        
        if (options?.filter) {
            let match = true;
            for (const [k, v] of Object.entries(options.filter)) {
                if (record.metadata[k] !== v) {
                    match = false;
                    break;
                }
            }
            if (!match) continue;
        }

        const channel_values: Record<string, any> = {};
        if (record.checkpoint.channel_versions) {
             for (const [channel, version] of Object.entries(record.checkpoint.channel_versions)) {
                const blobKey = `${thread_id}:${channel}:${version}`;
                const blobRecord = await this.store.getBlob(blobKey);
                if (blobRecord) {
                    channel_values[channel] = blobRecord.blob;
                }
             }
        }
        
        const finalCheckpoint: Checkpoint = {
            ...record.checkpoint,
            channel_values
        };

        yield {
            config: { configurable: { thread_id, checkpoint_ns: record.checkpoint_ns, checkpoint_id: record.checkpoint_id } },
            checkpoint: finalCheckpoint,
            metadata: record.metadata,
            parentConfig: record.parent_checkpoint_id ? { configurable: { thread_id, checkpoint_ns: record.checkpoint_ns, checkpoint_id: record.parent_checkpoint_id } } : undefined,
            pendingWrites: []
        };
        
        count++;
    }
  }

  async put(
    config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Record<string, string | number>,
    preCalculatedBlobs?: Record<string, any>
  ): Promise<{ configurable: { thread_id: string; checkpoint_ns: string; checkpoint_id: string } }> {
      const thread_id = config.configurable?.thread_id;
      const checkpoint_ns = config.configurable?.checkpoint_ns || "";
      
      if (!thread_id) throw new Error("Missing thread_id in config");

      const { channel_values, ...lightweightCheckpoint } = checkpoint;
      
      const record: CheckpointRecord = {
          thread_id,
          checkpoint_ns,
          checkpoint_id: checkpoint.id,
          parent_checkpoint_id: config.configurable?.checkpoint_id,
          checkpoint: lightweightCheckpoint,
          metadata
      };

      if (channel_values && newVersions) {
          for (const [channel, version] of Object.entries(newVersions)) {
              const val = channel_values[channel];
              const blobKey = `${thread_id}:${channel}:${version}`;
              
              const existingBlob = await this.store.getBlob(blobKey);
              if (!existingBlob) {
                  let blobRecord: CheckpointBlobRecord;

                  if (preCalculatedBlobs && preCalculatedBlobs[channel]) {
                      const pre = preCalculatedBlobs[channel];
                      blobRecord = {
                          thread_id,
                          checkpoint_ns,
                          channel,
                          version: String(version),
                          type: pre.type,
                          blob: pre.blob,
                          serialized: pre.serialized
                      };
                  } else {
                      let blobType = 'empty';
                      let blobData: any = null;
                      let serialized = false;
                      
                      if (val !== undefined) {
                          try {
                              const [type, serializedValue] = await this.serde.dumpsTyped(val);
                              blobType = type;
                              blobData = new TextDecoder().decode(serializedValue);
                              serialized = true;
                          } catch (e) {
                              console.error(`[FileSystemSaver] Failed to serialize blob for ${channel}:`, e);
                              throw e;
                          }
                      }
                      
                      blobRecord = {
                          thread_id,
                          checkpoint_ns,
                          channel,
                          version: String(version),
                          type: blobType,
                          blob: blobData,
                          serialized
                      };
                  }
                  await this.store.putBlob(blobKey, blobRecord);
              }
          }
      }

      await this.store.putCheckpoint(record);

      if (await this.getRestoreHead(thread_id, checkpoint_ns)) {
        await this.setRestoreHead(thread_id, checkpoint.id, checkpoint_ns);
      }

      return {
          configurable: {
              thread_id,
              checkpoint_ns,
              checkpoint_id: checkpoint.id
          }
      };
  }

  async putWrites(
    config: { configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string } },
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
      const thread_id = config.configurable?.thread_id;
      const checkpoint_ns = config.configurable?.checkpoint_ns || "";
      const checkpoint_id = config.configurable?.checkpoint_id;
      
      if (!thread_id || !checkpoint_id) return;
      
      const newWrites: CheckpointWriteRecord[] = writes.map((w, idx) => {
          const [channel, value] = w;
          return {
              thread_id,
              checkpoint_ns,
              checkpoint_id,
              task_id: taskId,
              idx,
              channel,
              type: 'json',
              blob: value
          };
      });
      await this.store.putWrites(thread_id, newWrites);
  }
}
