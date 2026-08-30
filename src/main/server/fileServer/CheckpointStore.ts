import { CheckpointRecord, CheckpointBlobRecord, CheckpointWriteRecord } from "./storageEngine";

export interface CheckpointStore {
  // Checkpoints
  getCheckpoints(threadId: string): Promise<CheckpointRecord[]>;
  putCheckpoint(record: CheckpointRecord): Promise<void>;

  // Blobs
  getBlob(key: string): Promise<CheckpointBlobRecord | undefined>;
  getBlobsByPrefix(prefix: string): Promise<CheckpointBlobRecord[]>;
  putBlob(key: string, record: CheckpointBlobRecord): Promise<void>;
  deleteBlobs(keys: string[]): Promise<void>;

  // Writes
  getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]>;
  putWrites(threadId: string, writes: CheckpointWriteRecord[]): Promise<void>;

  // Restore heads
  getRestoreHead(threadId: string, checkpointNs: string): Promise<string | undefined>;
  setRestoreHead(threadId: string, checkpointId: string, checkpointNs: string): Promise<void>;
  clearRestoreHead(threadId: string, checkpointNs: string): Promise<void>;

  // Threads
  deleteThread(threadId: string): Promise<void>;
}
