import { CheckpointStore } from "./CheckpointStore";
import { CheckpointRecord, CheckpointBlobRecord, CheckpointWriteRecord, CagentStorage } from "./storageEngine";

export class InMemoryCheckpointStore implements CheckpointStore {
    private storage: CagentStorage;

    constructor(storage: CagentStorage) {
        this.storage = storage;
    }

    private get persistence() {
        if (!this.storage.data.persistence) {
            this.storage.data.persistence = { checkpoints: {}, blobs: {}, writes: {}, restoreHeads: {} };
        }
        if (!this.storage.data.persistence.restoreHeads) {
            this.storage.data.persistence.restoreHeads = {};
        }
        return this.storage.data.persistence!;
    }

    private buildRestoreHeadKey(threadId: string, checkpointNs: string): string {
        return `${threadId}:${checkpointNs}`;
    }

    async getCheckpoints(threadId: string): Promise<CheckpointRecord[]> {
        return this.persistence.checkpoints[threadId] || [];
    }

    async putCheckpoint(record: CheckpointRecord): Promise<void> {
        if (!this.persistence.checkpoints[record.thread_id]) {
            this.persistence.checkpoints[record.thread_id] = [];
        }
        this.persistence.checkpoints[record.thread_id].push(record);
        this.storage.triggerSave();
    }

    async getBlob(key: string): Promise<CheckpointBlobRecord | undefined> {
        return this.persistence.blobs[key];
    }

    async getBlobsByPrefix(prefix: string): Promise<CheckpointBlobRecord[]> {
        return Object.keys(this.persistence.blobs)
            .filter(k => k.startsWith(prefix))
            .map(k => this.persistence.blobs[k]);
    }

    async putBlob(key: string, record: CheckpointBlobRecord): Promise<void> {
        this.persistence.blobs[key] = record;
        this.storage.triggerSave();
    }

    async deleteBlobs(keys: string[]): Promise<void> {
        for (const key of keys) {
            delete this.persistence.blobs[key];
        }
        this.storage.triggerSave();
    }

    async getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]> {
        const threadWrites = this.persistence.writes[threadId] || [];
        return threadWrites.filter(w => w.checkpoint_id === checkpointId);
    }

    async putWrites(threadId: string, writes: CheckpointWriteRecord[]): Promise<void> {
        if (!this.persistence.writes[threadId]) {
            this.persistence.writes[threadId] = [];
        }
        this.persistence.writes[threadId].push(...writes);
        this.storage.triggerSave();
    }

    async getRestoreHead(threadId: string, checkpointNs: string): Promise<string | undefined> {
        if (!threadId) return undefined;
        return this.persistence.restoreHeads[this.buildRestoreHeadKey(threadId, checkpointNs)];
    }

    async setRestoreHead(threadId: string, checkpointId: string, checkpointNs: string): Promise<void> {
        if (!threadId || !checkpointId) return;
        this.persistence.restoreHeads[this.buildRestoreHeadKey(threadId, checkpointNs)] = checkpointId;
        this.storage.triggerSave();
    }

    async clearRestoreHead(threadId: string, checkpointNs: string): Promise<void> {
        if (!threadId) return;
        const key = this.buildRestoreHeadKey(threadId, checkpointNs);
        if (this.persistence.restoreHeads[key]) {
            delete this.persistence.restoreHeads[key];
            this.storage.triggerSave();
        }
    }

    async deleteThread(threadId: string): Promise<void> {
        if (!threadId) return;
        if (this.persistence.checkpoints[threadId]) delete this.persistence.checkpoints[threadId];
        if (this.persistence.writes[threadId]) delete this.persistence.writes[threadId];
        
        const blobPrefix = `${threadId}:`;
        const keysToDelete = Object.keys(this.persistence.blobs).filter(k => k.startsWith(blobPrefix));
        for (const k of keysToDelete) {
            delete this.persistence.blobs[k];
        }
        this.storage.triggerSave();
    }
}
