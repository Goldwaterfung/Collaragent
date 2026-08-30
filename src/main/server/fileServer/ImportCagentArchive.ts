import fs from 'node:fs';
import path from 'node:path';
import { StorageMigration, MigrationReport, ValidationResult } from './migration';
import { unpack } from 'msgpackr';
import { FolderInstanceContentStore } from './FolderInstanceContentStore';
import { FileCheckpointStore } from './FileCheckpointStore';

async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    const json = `${JSON.stringify(data, null, 2)}\n`;

    await fs.promises.writeFile(tempPath, json, 'utf8');
    await fs.promises.rename(tempPath, filePath);
}

export class ImportCagentArchive implements StorageMigration {
    fromVersion = 2;
    toVersion = 3;
    description = "Extracts legacy .cagent archive and migrates monolithic in-memory structure into a sharded V3 folder format.";

    async migrate(workspacePath: string): Promise<MigrationReport> {
        let artifactsMigrated = 0;
        const warnings: string[] = [];
        
        try {
            const cagentJsonPath = path.join(workspacePath, 'cagent.json');
            
            if (!fs.existsSync(cagentJsonPath)) {
                return { success: false, fromVersion: this.fromVersion, toVersion: this.toVersion, migratedAt: new Date().toISOString(), artifactsMigrated, warnings, errors: ["Missing cagent.json in target directory. Not a valid V2 archive."] };
            }

            const buffer = await fs.promises.readFile(cagentJsonPath);
            const decoded = unpack(buffer) as any;

            if (decoded.header?.magic !== "CAGENT") {
                 return { success: false, fromVersion: this.fromVersion, toVersion: this.toVersion, migratedAt: new Date().toISOString(), artifactsMigrated, warnings, errors: ["Invalid file format: Missing magic bytes"] };
            }
            
            if (decoded.header.version === 1 && decoded.project) {
                 decoded.projects = { [decoded.project.id]: decoded.project };
                 delete decoded.project;
                 decoded.header.version = 2;
            }
            
            const state = {
               chat: decoded.chat || { sessions: {} },
               persistence: decoded.persistence || { checkpoints: {}, blobs: {}, writes: {}, restoreHeads: {} },
               checkpointBundles: decoded.checkpointBundles || [],
               fileRevisions: decoded.fileRevisions || [],
               workspaceSnapshots: decoded.workspaceSnapshots || [],
               workspaceLogs: decoded.workspaceLogs || { byInstanceId: {} }
            };
            
            const instancesMeta: Record<string, any> = {};
            const instanceStore = new FolderInstanceContentStore(path.join(workspacePath, "instances"));
            
            for (const [id, inst] of Object.entries(decoded.instances || {})) {
                const { content, ...meta } = inst as any;
                instancesMeta[id] = meta;
                
                if (content) {
                    await instanceStore.writeContent(id, content);
                    artifactsMigrated++;
                }
            }
            
            const manifest = {
               header: { magic: "CAGENT", version: 3 },
               projects: decoded.projects || {},
               instances: instancesMeta,
               updatedAt: decoded.updatedAt || Date.now()
            };

            const checkpointStore = new FileCheckpointStore(workspacePath);
            
            const cpData = state.persistence.checkpoints || {};
            for (const records of Object.values(cpData)) {
                for (const record of (records as any[])) {
                     await checkpointStore.putCheckpoint(record);
                     artifactsMigrated++;
                }
            }
            
            const blobData = state.persistence.blobs || {};
            for (const [blobKey, record] of Object.entries(blobData)) {
                 await checkpointStore.putBlob(blobKey, record as any);
                 artifactsMigrated++;
            }
            
            const writesData = state.persistence.writes || {};
            for (const [threadId, records] of Object.entries(writesData)) {
                 await checkpointStore.putWrites(threadId, records as any[]);
                 artifactsMigrated++;
            }
            
            const headsData = state.persistence.restoreHeads || {};
            for (const [compositeKey, checkpointId] of Object.entries(headsData)) {
                 const headIdx = compositeKey.indexOf(':');
                 if (headIdx !== -1) {
                     const threadId = compositeKey.substring(0, headIdx);
                     const checkpointNs = compositeKey.substring(headIdx + 1);
                     await checkpointStore.setRestoreHead(threadId, checkpointId as string, checkpointNs);
                 }
            }
            
            state.persistence = { checkpoints: {}, blobs: {}, writes: {}, restoreHeads: {} };
            
            await writeJsonFileAtomic(path.join(workspacePath, "manifest.json"), manifest);
            await writeJsonFileAtomic(path.join(workspacePath, "state.json"), state);
            
            await fs.promises.unlink(cagentJsonPath);
            
            return {
                success: true,
                fromVersion: this.fromVersion,
                toVersion: this.toVersion,
                migratedAt: new Date().toISOString(),
                artifactsMigrated,
                warnings: warnings.length > 0 ? warnings : [],
                errors: []
            };

        } catch (err: any) {
            return {
                success: false,
                fromVersion: this.fromVersion,
                toVersion: this.toVersion,
                migratedAt: new Date().toISOString(),
                artifactsMigrated,
                warnings,
                errors: [err.message]
            };
        }
    }

    async validate(workspacePath: string): Promise<ValidationResult> {
        const manifestPath = path.join(workspacePath, "manifest.json");
        return {
           valid: fs.existsSync(manifestPath),
           missingArtifacts: fs.existsSync(manifestPath) ? [] : ["manifest.json"],
           corruptedArtifacts: []
        };
    }
}
