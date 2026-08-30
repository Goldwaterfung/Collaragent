import fs from 'node:fs';
import path from 'node:path';
import { CheckpointRecord } from './storageEngine';

export async function collectOrphanedBlobs(baseDir: string): Promise<number> {
    const checkpointsDir = path.join(baseDir, 'checkpoints', 'threads');
    const blobsDir = path.join(baseDir, 'checkpoints', 'blobs');
    
    if (!fs.existsSync(blobsDir) || !fs.existsSync(checkpointsDir)) {
        return 0;
    }

    const referencedKeys = new Set<string>();
    
    const threads = await fs.promises.readdir(checkpointsDir);
    for (const thread of threads) {
        const cpDir = path.join(checkpointsDir, thread, 'checkpoints');
        if (!fs.existsSync(cpDir)) continue;
        
        const files = await fs.promises.readdir(cpDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const data = await fs.promises.readFile(path.join(cpDir, file), 'utf-8');
                    const record = JSON.parse(data) as CheckpointRecord;
                    
                    if (record.checkpoint.channel_versions) {
                        for (const [channel, version] of Object.entries(record.checkpoint.channel_versions)) {
                            const blobKey = `${record.thread_id}:${channel}:${version}`;
                            referencedKeys.add(blobKey);
                        }
                    }
                } catch (err) {
                    console.error("Failed to parse", file, err);
                }
            }
        }
    }

    let deletedCount = 0;
    const blobFiles = await fs.promises.readdir(blobsDir);
    for (const file of blobFiles) {
        if (file.endsWith('.json')) {
            const encoded = file.replace('.json', '');
            const key = Buffer.from(encoded, 'base64url').toString('utf8');
            
            if (!referencedKeys.has(key)) {
                try {
                    await fs.promises.unlink(path.join(blobsDir, file));
                    deletedCount++;
                } catch(err) {
                    console.error("Failed to delete orphaned blob", file, err);
                }
            }
        }
    }
    
    return deletedCount;
}
