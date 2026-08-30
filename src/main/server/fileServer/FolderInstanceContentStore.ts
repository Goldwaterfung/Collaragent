import fs from 'node:fs';
import path from 'node:path';
import { pack, unpack } from 'msgpackr';
import { InstanceContentStore } from './InstanceContentStore';

export class FolderInstanceContentStore implements InstanceContentStore {
    private instancesDir: string;

    constructor(instancesDir: string) {
        this.instancesDir = instancesDir;
        if (!fs.existsSync(this.instancesDir)) {
            fs.mkdirSync(this.instancesDir, { recursive: true });
        }
    }

    private getInstanceDir(instanceId: string): string {
        return path.join(this.instancesDir, instanceId);
    }

    private getContentPath(instanceId: string): string {
        return path.join(this.getInstanceDir(instanceId), 'content.msgpack');
    }

    async readContent(instanceId: string): Promise<any> {
        const contentPath = this.getContentPath(instanceId);
        if (!fs.existsSync(contentPath)) {
            return null;
        }
        const buffer = await fs.promises.readFile(contentPath);
        return unpack(buffer);
    }

    async writeContent(instanceId: string, content: any): Promise<void> {
        const instanceDir = this.getInstanceDir(instanceId);
        if (!fs.existsSync(instanceDir)) {
            await fs.promises.mkdir(instanceDir, { recursive: true });
        }
        const contentPath = this.getContentPath(instanceId);
        const tempPath = `${contentPath}.tmp`;
        
        const buffer = pack(content);
        await fs.promises.writeFile(tempPath, buffer);
        await fs.promises.rename(tempPath, contentPath);
    }

    async deleteContent(instanceId: string): Promise<void> {
        const instanceDir = this.getInstanceDir(instanceId);
        if (fs.existsSync(instanceDir)) {
            await fs.promises.rm(instanceDir, { recursive: true, force: true });
        }
    }
}
