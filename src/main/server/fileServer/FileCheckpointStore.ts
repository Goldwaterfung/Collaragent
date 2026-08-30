import fs from 'node:fs';
import path from 'node:path';
import { CheckpointStore } from './CheckpointStore';
import { CheckpointRecord, CheckpointBlobRecord, CheckpointWriteRecord } from './storageEngine';

export class FileCheckpointStore implements CheckpointStore {
    private baseDir: string;

    constructor(baseDir: string) {
        this.baseDir = path.join(baseDir, 'checkpoints');
    }

    private getThreadDir(threadId: string): string {
        return path.join(this.baseDir, 'threads', threadId);
    }

    private getCheckpointsDir(threadId: string): string {
        return path.join(this.getThreadDir(threadId), 'checkpoints');
    }

    private getWritesDir(threadId: string): string {
        return path.join(this.getThreadDir(threadId), 'writes');
    }

    private getBlobsDir(): string {
        return path.join(this.baseDir, 'blobs');
    }

    private getManifestsDir(): string {
        return path.join(this.baseDir, 'manifests');
    }

    private getRestoreHeadsPath(): string {
        return path.join(this.getManifestsDir(), 'restore-heads.json');
    }

    private async ensureDir(dirPath: string): Promise<void> {
        if (!fs.existsSync(dirPath)) {
            await fs.promises.mkdir(dirPath, { recursive: true });
        }
    }

    private async readJsonFile<T>(filePath: string): Promise<T | undefined> {
        try {
            if (!fs.existsSync(filePath)) return undefined;
            const data = await fs.promises.readFile(filePath, 'utf-8');
            return JSON.parse(data) as T;
        } catch (err) {
            console.error(`Error reading ${filePath}:`, err);
            return undefined;
        }
    }

    private async writeJsonFile(filePath: string, data: any): Promise<void> {
        await this.ensureDir(path.dirname(filePath));
        const tmpPath = `${filePath}.tmp`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2));
        await fs.promises.rename(tmpPath, filePath);
    }

    private encodeBlobKey(key: string): string {
        return Buffer.from(key).toString('base64url');
    }

    private decodeBlobKey(encoded: string): string {
        return Buffer.from(encoded, 'base64url').toString('utf8');
    }

    async getCheckpoints(threadId: string): Promise<CheckpointRecord[]> {
        const dir = this.getCheckpointsDir(threadId);
        if (!fs.existsSync(dir)) return [];
        
        const files = await fs.promises.readdir(dir);
        const records: CheckpointRecord[] = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const record = await this.readJsonFile<CheckpointRecord>(path.join(dir, file));
                if (record) records.push(record);
            }
        }
        
        return records;
    }

    async putCheckpoint(record: CheckpointRecord): Promise<void> {
        const filePath = path.join(this.getCheckpointsDir(record.thread_id), `${record.checkpoint_id}.json`);
        await this.writeJsonFile(filePath, record);
    }

    async getBlob(key: string): Promise<CheckpointBlobRecord | undefined> {
        const filePath = path.join(this.getBlobsDir(), `${this.encodeBlobKey(key)}.json`);
        return this.readJsonFile<CheckpointBlobRecord>(filePath);
    }

    async getBlobsByPrefix(prefix: string): Promise<CheckpointBlobRecord[]> {
        const dir = this.getBlobsDir();
        if (!fs.existsSync(dir)) return [];
        
        const files = await fs.promises.readdir(dir);
        const records: CheckpointBlobRecord[] = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const encoded = file.replace('.json', '');
                const key = this.decodeBlobKey(encoded);
                if (key.startsWith(prefix)) {
                    const record = await this.readJsonFile<CheckpointBlobRecord>(path.join(dir, file));
                    if (record) records.push(record);
                }
            }
        }
        return records;
    }

    async putBlob(key: string, record: CheckpointBlobRecord): Promise<void> {
        const filePath = path.join(this.getBlobsDir(), `${this.encodeBlobKey(key)}.json`);
        await this.writeJsonFile(filePath, record);
    }

    async deleteBlobs(keys: string[]): Promise<void> {
        for (const key of keys) {
            const filePath = path.join(this.getBlobsDir(), `${this.encodeBlobKey(key)}.json`);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath).catch(err => console.error("Failed to delete blob", key, err));
            }
        }
    }

    async getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]> {
        const dir = this.getWritesDir(threadId);
        if (!fs.existsSync(dir)) return [];
        
        const files = await fs.promises.readdir(dir);
        const records: CheckpointWriteRecord[] = [];
        
        const prefix = `${checkpointId}_`;
        for (const file of files) {
            if (file.startsWith(prefix) && file.endsWith('.json')) {
                const record = await this.readJsonFile<CheckpointWriteRecord>(path.join(dir, file));
                if (record) records.push(record);
            }
        }
        return records;
    }

    async putWrites(threadId: string, writes: CheckpointWriteRecord[]): Promise<void> {
        for (const write of writes) {
            const filePath = path.join(this.getWritesDir(threadId), `${write.checkpoint_id}_${write.task_id}_${write.idx}.json`);
            await this.writeJsonFile(filePath, write);
        }
    }

    private async readRestoreHeads(): Promise<Record<string, string>> {
        const filePath = this.getRestoreHeadsPath();
        const data = await this.readJsonFile<Record<string, string>>(filePath);
        return data || {};
    }

    private buildRestoreHeadKey(threadId: string, checkpointNs: string): string {
        return `${threadId}:${checkpointNs}`;
    }

    async getRestoreHead(threadId: string, checkpointNs: string): Promise<string | undefined> {
        if (!threadId) return undefined;
        const heads = await this.readRestoreHeads();
        return heads[this.buildRestoreHeadKey(threadId, checkpointNs)];
    }

    async setRestoreHead(threadId: string, checkpointId: string, checkpointNs: string): Promise<void> {
        if (!threadId || !checkpointId) return;
        const heads = await this.readRestoreHeads();
        heads[this.buildRestoreHeadKey(threadId, checkpointNs)] = checkpointId;
        await this.writeJsonFile(this.getRestoreHeadsPath(), heads);
    }

    async clearRestoreHead(threadId: string, checkpointNs: string): Promise<void> {
        if (!threadId) return;
        const heads = await this.readRestoreHeads();
        const key = this.buildRestoreHeadKey(threadId, checkpointNs);
        if (heads[key]) {
            delete heads[key];
            await this.writeJsonFile(this.getRestoreHeadsPath(), heads);
        }
    }

    async deleteThread(threadId: string): Promise<void> {
        if (!threadId) return;
        
        const threadDir = this.getThreadDir(threadId);
        if (fs.existsSync(threadDir)) {
            await fs.promises.rm(threadDir, { recursive: true, force: true }).catch(err => console.error(err));
        }

        const blobsDir = this.getBlobsDir();
        if (fs.existsSync(blobsDir)) {
             const files = await fs.promises.readdir(blobsDir);
             for (const file of files) {
                  if (file.endsWith('.json')) {
                      const key = this.decodeBlobKey(file.replace('.json', ''));
                      if (key.startsWith(`${threadId}:`)) {
                           const fp = path.join(blobsDir, file);
                           await fs.promises.unlink(fp).catch(err => console.error(err));
                      }
                  }
             }
        }
        
        const heads = await this.readRestoreHeads();
        let changed = false;
        for (const key of Object.keys(heads)) {
            if (key.startsWith(`${threadId}:`)) {
                delete heads[key];
                changed = true;
            }
        }
        if (changed) {
            await this.writeJsonFile(this.getRestoreHeadsPath(), heads);
        }
    }
}
