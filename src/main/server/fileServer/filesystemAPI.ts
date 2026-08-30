// filesystemAPI.ts

import express from 'express';
import http from 'node:http';
import WebSocket from 'ws';
import cors from 'cors';
import { CagentStorage } from './storageEngine';
import { FileSystemSaver } from './FileSystemSaver';
import { FileCheckpointStore } from './FileCheckpointStore';
import path from 'node:path';
import { z } from 'zod';
import {
    CheckpointBundleSchema,
    WorkspaceCommandLogEntrySchema,
    WorkspaceSnapshotSchema,
} from '@shared/checkpoints/validators';
import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types';
import { applyWorkspaceCommands } from "@workspace/persistence/checkpointRestoreHelpers";
import { InverseCommandEngine } from "@collaragent/runtime/InverseCommandEngine";

/**
 * filesystemAPI.ts
 * 
 * This server replaces the PostgreSQL-backed documentInstanceAPI.
 * It strictly handles RESTful CRUD operations using CagentStorage (.cagent files)
 * and notifies the separate WebSocket server (ws-server.ts) of changes.
 */

export type FilesystemApiHandle = {
    port: number;
    close: () => Promise<void>;
    storage: CagentStorage;
    setWsPort: (port: number) => void;
};

/**
 * Start the server. Each call creates an isolated instance with its own Express app,
 * Storage engine, and notification target.
 */
import os from 'node:os';

/**
 * Start the server. Each call creates an isolated instance with its own Express app,
 * Storage engine, and notification target.
 */
export async function startFilesystemApi(options: { port?: number; filePath?: string; workingDirectory?: string } = {}): Promise<FilesystemApiHandle> {
    const API_PORT = Number(process.env.API_PORT) || 0;
    const port = options.port !== undefined ? options.port : API_PORT;
    const filePath = options.filePath || process.env.CAGENT_FILE_PATH || path.resolve(process.cwd(), 'local-data.cagent');
    const workingDirectory = options.workingDirectory || path.join(os.tmpdir(), "collaragent-dev-fallback");

    // 1. Session-scoped variables
    let currentWsPort = Number(process.env.WS_PORT) || 0;
    const storage = new CagentStorage(filePath, workingDirectory);
    const saver = new FileSystemSaver(new FileCheckpointStore(workingDirectory));

    try {
        await storage.load();
    } catch (e: any) {
        console.warn("[filesystem-api] Storage load warning (initializing if new):", e.message);
    }

    // 2. Notification Helper: Notifies the specific WS server for this session
    let notifyWs: WebSocket | null = null;
    let notifyQueue: any[] = [];
    let isConnectingWs = false;

    const connectNotifyWs = () => {
        if (isConnectingWs || (notifyWs && notifyWs.readyState === WebSocket.OPEN)) return;
        isConnectingWs = true;
        const wsUrl = `ws://localhost:${currentWsPort}/ws/editor-content`;
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
            isConnectingWs = false;
            notifyWs = ws;
            while (notifyQueue.length > 0) {
                const msg = notifyQueue.shift();
                ws.send(JSON.stringify(msg));
            }
        });

        ws.on('error', () => {
            isConnectingWs = false;
        });

        ws.on('close', () => {
            isConnectingWs = false;
            notifyWs = null;
        });
    };

    const notifyWsServer = (message: any): void => {
        if (notifyWs && notifyWs.readyState === WebSocket.OPEN) {
            notifyWs.send(JSON.stringify(message));
        } else {
            notifyQueue.push(message);
            connectNotifyWs();
        }
    };

    connectNotifyWs();

    // 3. Setup Express App for this session
    const app = express();
    app.use(cors({ origin: '*' }));
    app.use(express.json({ limit: '50mb' }));

    // --- REST Endpoints (Capturing local storage and notifyWsServer) ---

    app.get('/api/instances', (_req, res) => {
        try {
            const instances = storage.getAllInstances();
            res.json({ instances });
        } catch (err) {
            console.error("[filesystem-api] Error listing instances:", err);
            res.status(500).json({ error: "Internal Server Error" });
        }
    });

    app.get('/api/instances/:id', (req, res) => {
        try {
            const instance = storage.getInstance(req.params.id);
            if (!instance) return res.status(404).json({ error: "Instance not found" });
            res.json(instance);
        } catch (err) {
            console.error("[filesystem-api] Error getting instance:", err);
            res.status(500).json({ error: "Internal Server Error" });
        }
    });

    app.post('/api/instances', async (req, res) => {
        try {
            if (!req.body.projectId) {
                return res.status(400).json({ error: "projectId is required" });
            }
            const instance = storage.createInstance(req.body.type, req.body);
            res.status(201).json({ status: "created", id: instance.id });
            notifyWsServer({ 
                type: 'internal:instanceCreated', 
                instance: {
                    id: instance.id,
                    name: instance.name,
                    type: instance.type,
                    projectId: instance.projectId,
                    updatedAt: instance.updatedAt,
                    metadata: instance.metadata
                }
            });
        } catch (err: any) {
            if (err.code === "23505") {
                 return res.status(409).json({ error: err.message });
            }
            console.error("[filesystem-api] Error creating instance:", err);
            res.status(500).json({ error: "Failed to create instance" });
        }
    });

    app.patch('/api/instances/:id', async (req, res) => {
        try {
            const changes = { ...req.body };
            if (changes.payload && !changes.content) {
                 changes.content = changes.payload;
                 delete changes.payload;
            }

            const instance = storage.updateInstance(req.params.id, changes);
            if (!instance) return res.status(404).json({ error: "Instance not found" });
            
            res.json({ status: "ok", id: instance.id });

            if (changes.content) {
                notifyWsServer({
                    type: 'update',
                    instanceId: instance.id,
                    payload: instance.content,
                    clientId: 'system-persistence-confirm'
                });
            }

            if (changes.name !== undefined || changes.projectId !== undefined || changes.metadata !== undefined) {
                notifyWsServer({ 
                    type: 'internal:instanceUpdated', 
                    instance: {
                        id: instance.id,
                        name: instance.name,
                        type: instance.type,
                        projectId: instance.projectId,
                        updatedAt: instance.updatedAt,
                        metadata: instance.metadata
                    }
                });
            }
        } catch (err: any) {
             if (err.code === "23505") {
                 return res.status(409).json({ error: err.message });
            }
            console.error("[filesystem-api] Error updating instance:", err);
            res.status(500).json({ error: "Failed to update instance" });
        }
    });

    app.delete('/api/instances/:id', async (req, res) => {
        try {
            const result = storage.deleteInstance(req.params.id);
            if (result.deleted) {
                // Ensure persistence before responding
                await storage.save();
                
                res.json({ status: "deleted", id: req.params.id, deleted: true });
                notifyWsServer({ type: 'delete', instanceId: req.params.id, clientId: 'api-delete' });
                notifyWsServer({ type: 'internal:instanceDeleted', instanceId: req.params.id });
            } else {
                res.status(404).json({ error: "Instance not found", deleted: false });
            }
        } catch (err) {
             console.error("[filesystem-api] Error deleting instance:", err);
             res.status(500).json({ error: "Failed to delete instance" });
        }
    });

    app.get('/api/projects', (_req, res) => {
        res.json({ projects: storage.getAllProjects() });
    });

    app.post('/api/projects', (req, res) => {
         const project = storage.createProject(req.body.name);
         res.status(201).json({ status: "created", id: project.id });
         notifyWsServer({ type: 'instancesUpdated' }); // Projects list changed
    });

    app.patch('/api/projects/:id', (req, res) => {
        const project = storage.updateProject(req.params.id, req.body);
        if (!project) return res.status(404).json({ error: "Project not found" });
        res.json({ status: "ok", id: project.id });
        notifyWsServer({ type: 'instancesUpdated' });
   });

   app.delete('/api/projects/:id', async (req, res) => {
       const result = storage.deleteProject(req.params.id);
       if (!result) return res.status(404).json({ error: "Project not found" });
       
       // Ensure persistence before responding
       await storage.save();
       
       res.json({ status: "deleted", id: req.params.id });
       notifyWsServer({ type: 'instancesUpdated' });
   });

    // --- Chat endpoints ---
    app.get('/api/chat/sessions', (_req, res) => {
        try {
            const sessions = storage.getChatSessions();
            res.json({ sessions });
        } catch (err) {
            console.error('[filesystem-api] Error listing chat sessions:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.get('/api/chat/sessions/:id', (req, res) => {
        try {
            const session = storage.data.chat?.sessions[req.params.id] || null;
            if (!session) return res.status(404).json({ error: 'Session not found' });
            res.json(session);
        } catch (err) {
            console.error('[filesystem-api] Error getting chat session:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    app.post('/api/chat/sessions/:id/messages', async (req, res) => {
        try {
            const sessionId = req.params.id;
            const body = req.body || {};
            // Expect body to be a ChatMessage-like object
            const message = {
                id: body.id,
                role: body.role || 'assistant',
                content: body.content || '',
                toolCalls: body.toolCalls || [],
                blocks: body.blocks || [],
                actions: body.actions || [],
                timestamp: body.timestamp || Date.now(),
                usage: body.usage,
                metadata: body.metadata || {}
            };

            const session = storage.saveChatMessage(sessionId, message as any);
            res.status(201).json({ status: 'created', sessionId: session.id });
            notifyWsServer({ type: 'chat:message', sessionId: session.id, message });
            notifyWsServer({ type: 'chat:sessionsUpdated' });
        } catch (err) {
            console.error('[filesystem-api] Error saving chat message:', err);
            res.status(500).json({ error: 'Failed to save message' });
        }
    });

    app.delete('/api/chat/sessions/:id', (req, res) => {
        try {
            const deleted = storage.deleteChatSession(req.params.id);
            if (!deleted) return res.status(404).json({ error: 'Session not found' });
            res.json({ status: 'deleted', id: req.params.id });
            notifyWsServer({ type: 'chat:sessionsUpdated' });
        } catch (err) {
            console.error('[filesystem-api] Error deleting chat session:', err);
            res.status(500).json({ error: 'Failed to delete session' });
        }
    });

    app.post('/api/chat/sessions/:id/restore', (req, res) => {
        try {
            const sessionId = req.params.id;
            const messageId = req.body?.messageId as string | undefined;
            const blockIndex = req.body?.blockIndex as number | undefined;

            if (!messageId) {
                return res.status(400).json({ error: 'messageId is required' });
            }

            const ok = storage.truncateChatSession(sessionId, messageId, blockIndex);
            if (!ok) return res.status(404).json({ error: 'Session or message not found' });

            res.json({ status: 'restored', sessionId, messageId, blockIndex });
            notifyWsServer({ type: 'chat:sessionsUpdated' });
            notifyWsServer({ type: 'chat:restored', sessionId, messageId, blockIndex });
        } catch (err) {
            console.error('[filesystem-api] Error restoring chat session:', err);
            res.status(500).json({ error: 'Failed to restore chat session' });
        }
    });

    // --- Persistence Endpoints ---

    // Get checkpoints for a thread
    app.get('/api/persistence/checkpoints/:threadId', async (req, res) => {
        try {
            const threadId = req.params.threadId;
            const checkpointNs = req.query.checkpoint_ns as string || ""; // optional namespace
            
            // List checkpoints
            const config = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs } };
            const options: any = {};
            
            // Handle filters/limit if provided
            if (req.query.limit) options.limit = Number(req.query.limit);
            if (req.query.before) options.before = { configurable: { checkpoint_id: req.query.before as string } };
            
            const checkpoints: any[] = [];
            for await (const tuple of saver.list(config, options)) {
                // tuple contains { config, checkpoint, metadata, parentConfig, pendingWrites }
                // We need to serialize it correctly for the client
                checkpoints.push(tuple);
            }
            res.json(checkpoints);
        } catch (err: any) {
            console.error('[filesystem-api] Error listing checkpoints:', err);
            res.status(500).json({ error: 'Failed to list checkpoints', details: err.message });
        }
    });

    // Get a specific checkpoint tuple
    app.get('/api/persistence/checkpoints/:threadId/latest', async (req, res) => {
         try {
            const threadId = req.params.threadId;
            const checkpointNs = req.query.checkpoint_ns as string || "";
            const checkpointId = req.query.checkpoint_id as string | undefined;

            const config = { configurable: { 
                thread_id: threadId, 
                checkpoint_ns: checkpointNs,
                checkpoint_id: checkpointId 
            }};

            let tuple;
            if (req.query.raw === 'true') {
                tuple = await saver.getRawTuple(config);
            } else {
                tuple = await saver.getTuple(config);
            }

            if (!tuple) {
                 return res.status(404).json({ error: "Checkpoint not found" });
            }
            res.json(tuple);
        } catch (err: any) {
            console.error('[filesystem-api] Error getting checkpoint:', err);
            res.status(500).json({ error: 'Failed to get checkpoint', details: err.message });
        }
    });

    // Save a checkpoint (Put)
    app.put('/api/persistence/checkpoints', async (req, res) => {
        try {
            const { config, checkpoint, metadata, newVersions, blobs } = req.body;
            
            if (!config || !checkpoint || !metadata) {
                return res.status(400).json({ error: 'Missing required fields: config, checkpoint, metadata' });
            }

            // We need to deserialize Uint8Array/Buffers if they were JSON serialized as objects with type 'Buffer'
            // But express.json() usually parses them as objects. 
            // FileSystemSaver expects 'checkpoint' object and 'newVersions' map.
            
            const result = await saver.put(config, checkpoint, metadata, newVersions || {}, blobs);
            res.json(result);
            
            // Note: We don't necessarily broadcast WS updates for checkpoints unless UI needs real-time graph updates.
        } catch (err: any) {
             console.error('[filesystem-api] Error saving checkpoint:', err);
             res.status(500).json({ error: 'Failed to save checkpoint', details: err.message });
        }
    });

    // Save writes (PutWrites)
    app.put('/api/persistence/writes', async (req, res) => {
        try {
            const { config, writes, taskId } = req.body;
            
            if (!config || !writes || !taskId) {
                return res.status(400).json({ error: 'Missing required fields: config, writes, taskId' });
            }

            await saver.putWrites(config, writes, taskId);
            res.json({ status: 'ok' });
        } catch (err: any) {
             console.error('[filesystem-api] Error saving writes:', err);
             res.status(500).json({ error: 'Failed to save writes', details: err.message });
        }
    });

    // Delete thread
    app.delete('/api/persistence/threads/:threadId', async (req, res) => {
        try {
             await saver.deleteThread(req.params.threadId);
             res.json({ status: 'deleted' });
        } catch (err: any) {
             console.error('[filesystem-api] Error deleting thread:', err);
             res.status(500).json({ error: 'Failed to delete thread', details: err.message });
        }
    });

    // --- File Revision Endpoints ---

    app.get('/api/checkpoints/revisions', (_req, res) => {
        try {
            const revisions = storage.getFileRevisions();
            res.json({ revisions });
        } catch (err) {
            console.error('[filesystem-api] Error listing file revisions:', err);
            res.status(500).json({ error: 'Failed to list file revisions' });
        }
    });

    app.get('/api/checkpoints/revisions/:id', (req, res) => {
        try {
            const revision = storage.getFileRevision(req.params.id);
            if (!revision) return res.status(404).json({ error: 'Revision not found' });
            res.json(revision);
        } catch (err) {
            console.error('[filesystem-api] Error getting file revision:', err);
            res.status(500).json({ error: 'Failed to get file revision' });
        }
    });

    app.post('/api/checkpoints/revisions', async (req, res) => {
        try {
            const reason = req.body?.reason === 'autosave' ? 'autosave' : 'checkpoint';
            const revision = await storage.createFileRevision(reason);
            res.status(201).json(revision);
        } catch (err) {
            console.error('[filesystem-api] Error creating file revision:', err);
            res.status(500).json({ error: 'Failed to create file revision' });
        }
    });

    app.post('/api/checkpoints/revisions/:id/restore', async (req, res) => {
        try {
            const revision = await storage.restoreFileRevision(req.params.id);
            if (!revision) return res.status(404).json({ error: 'Revision not found' });
            res.json({ status: 'restored', revision });
            // Prevent hard reload by sending granular updates instead of system:reload
            notifyWsServer({ type: 'instancesUpdated' });
            notifyWsServer({ type: 'chat:sessionsUpdated' });
        } catch (err) {
            console.error('[filesystem-api] Error restoring file revision:', err);
            res.status(500).json({ error: 'Failed to restore file revision' });
        }
    });

    // --- Workspace Snapshot Endpoints ---

    app.post('/api/checkpoints/workspace/snapshots', async (req, res) => {
        try {
            const parsed = WorkspaceSnapshotSchema.omit({ id: true, createdAt: true, snapshotRef: true }).extend({
                snapshot: z.any(),
            }).safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid snapshot payload', details: parsed.error.flatten() });
            }

            // Ensure snapshot is treated as required (Zod might infer optional if schema allows)
            const snapshotData = {
                ...parsed.data,
                snapshot: parsed.data.snapshot
            };
            const snapshot = await storage.createWorkspaceSnapshot(snapshotData);
            res.status(201).json(snapshot);
        } catch (err) {
            console.error('[filesystem-api] Error creating workspace snapshot:', err);
            res.status(500).json({ error: 'Failed to create workspace snapshot' });
        }
    });

    app.get('/api/checkpoints/workspace/snapshots/:id', async (req, res) => {
        try {
            const snapshot = storage.getWorkspaceSnapshot(req.params.id);
            if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

            const payload = await storage.loadWorkspaceSnapshot(req.params.id);
            res.json({ snapshot, payload });
        } catch (err) {
            console.error('[filesystem-api] Error loading workspace snapshot:', err);
            res.status(500).json({ error: 'Failed to load workspace snapshot' });
        }
    });

    // --- Workspace Command Log Endpoints ---

    app.post('/api/checkpoints/workspace/logs', (req, res) => {
        try {
            const parsed = WorkspaceCommandLogEntrySchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid log entry', details: parsed.error.flatten() });
            }

            if (!parsed.data.command) {
                return res.status(400).json({ error: 'Command is required' });
            }
            storage.appendWorkspaceLogEntry(parsed.data as any); // Cast because Zod optionality mismatch
            res.status(201).json({ status: 'ok' });
        } catch (err) {
            console.error('[filesystem-api] Error appending workspace log:', err);
            res.status(500).json({ error: 'Failed to append workspace log' });
        }
    });

    app.get('/api/checkpoints/workspace/logs/:instanceId', (req, res) => {
        try {
            const entries = storage.getWorkspaceLogEntries(req.params.instanceId);
            res.json({ entries });
        } catch (err) {
            console.error('[filesystem-api] Error reading workspace logs:', err);
            res.status(500).json({ error: 'Failed to read workspace logs' });
        }
    });

    // --- Checkpoint Bundle Endpoints ---

    app.get('/api/checkpoints/bundles', (req, res) => {
        try {
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
            const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
            const bundles = storage.listCheckpointBundles({ sessionId, threadId });
            res.json({ bundles });
        } catch (err) {
            console.error('[filesystem-api] Error listing checkpoint bundles:', err);
            res.status(500).json({ error: 'Failed to list checkpoint bundles' });
        }
    });

    app.get('/api/checkpoints/bundles/:id', (req, res) => {
        try {
            const bundle = storage.getCheckpointBundle(req.params.id);
            if (!bundle) return res.status(404).json({ error: 'Checkpoint bundle not found' });
            res.json(bundle);
        } catch (err) {
            console.error('[filesystem-api] Error getting checkpoint bundle:', err);
            res.status(500).json({ error: 'Failed to get checkpoint bundle' });
        }
    });

    app.put('/api/checkpoints/bundles', (req, res) => {
        try {
            const parsed = CheckpointBundleSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid checkpoint bundle', details: parsed.error.flatten() });
            }

            const bundle = storage.createCheckpointBundle(parsed.data);
            res.status(201).json(bundle);
        } catch (err) {
            console.error('[filesystem-api] Error creating checkpoint bundle:', err);
            res.status(500).json({ error: 'Failed to create checkpoint bundle' });
        }
    });

    app.post('/api/checkpoints/restore', async (req, res) => {
        try {
            const bundleId = req.body?.bundleId as string | undefined;
            const sessionId = req.body?.sessionId as string | undefined;
            const threadId = req.body?.threadId as string | undefined;

            if (!bundleId) {
                return res.status(400).json({ error: 'bundleId is required' });
            }

            const bundle = storage.getCheckpointBundle(bundleId);
            if (!bundle) return res.status(404).json({ error: 'Checkpoint bundle not found' });

            if (sessionId && bundle.sessionId !== sessionId) {
                return res.status(409).json({ error: 'Checkpoint bundle session mismatch' });
            }

            if (threadId && bundle.threadId !== threadId) {
                return res.status(409).json({ error: 'Checkpoint bundle thread mismatch' });
            }

            if (bundle.agentCheckpointId) {
                const tuple = await saver.getRawTuple({
                    configurable: {
                        thread_id: bundle.threadId,
                        checkpoint_ns: '',
                        checkpoint_id: bundle.agentCheckpointId,
                    },
                });
                if (!tuple) {
                    return res.status(404).json({ error: 'Agent checkpoint not found', checkpointId: bundle.agentCheckpointId });
                }
            }

            // FIRST: capture current live content for all bundle instances
            // because restoreFileRevision will wipe instance content blank
            const instancePayloads = new Map<string, any>();
            for (const instance of bundle.instances) {
                const currentRecord = storage.getInstance(instance.instanceId);
                instancePayloads.set(instance.instanceId, currentRecord?.content);
            }

            if (bundle.fileRevisionId) {
                const revision = await storage.restoreFileRevision(bundle.fileRevisionId);
                if (!revision) return res.status(404).json({ error: 'File revision not found' });
                // Prevent hard reload by sending granular updates instead of system:reload
                notifyWsServer({ type: 'instancesUpdated' });
                notifyWsServer({ type: 'chat:sessionsUpdated' });
            }

            for (const instance of bundle.instances) {
                let restoredPayload: any = undefined;

                // Phase 3: strictly rely on referenced snapshots
                if (instance.snapshotId) {
                    restoredPayload = await storage.loadWorkspaceSnapshot(instance.snapshotId);
                }

                // Fallback purely for safety if the artifact was lost
                if (restoredPayload === undefined) {
                    console.warn(`[filesystem-api] Snapshot ${instance.snapshotId} missing for instance ${instance.instanceId}. Falling back to un-do log tracking...`);
                    const livePayload = instancePayloads.get(instance.instanceId);
                    const logEntries = storage.getWorkspaceLogEntries(instance.instanceId);
                    const targetSeq = instance.targetCursor?.seq ?? -Infinity;
                    
                    const agentEntriesToUndo = (logEntries || []).filter((e) => {
                        return (e as any).source === 'agent' && (e.cursor?.seq ?? -Infinity) > targetSeq;
                    });
                    
                    if (agentEntriesToUndo.length > 0 && livePayload !== undefined) {
                         restoredPayload = livePayload;
                         const sorted = [...agentEntriesToUndo].sort((a, b) => (b.cursor.seq || 0) - (a.cursor.seq || 0));
                         const undoEntries: WorkspaceCommandLogEntry[] = [];
                         for (const entry of sorted) {
                             const undoCommand = InverseCommandEngine.invert(entry);
                             if (undoCommand) {
                                 undoEntries.push({ ...entry, command: undoCommand });
                             }
                         }
                         if (undoEntries.length > 0) {
                             restoredPayload = applyWorkspaceCommands(restoredPayload, instance.instanceType, undoEntries);
                         }
                    } else if (livePayload !== undefined) {
                         restoredPayload = livePayload;
                    }
                }

                if (restoredPayload === undefined) {
                    console.warn(`Checkpoint restore: skipped instance ${instance.instanceId} (no payload)`);
                    continue;
                }

                const updated = storage.updateInstance(instance.instanceId, { content: restoredPayload });
                if (!updated) {
                    return res.status(404).json({ error: 'Instance not found', instanceId: instance.instanceId });
                }

                notifyWsServer({
                    type: 'update',
                    instanceId: instance.instanceId,
                    payload: updated.content,
                    clientId: 'system-checkpoint-restore',
                });
            }

            if (bundle.chat?.messageId) {
                const ok = storage.truncateChatSession(bundle.threadId, bundle.chat.messageId, bundle.chat.blockIndex);
                if (!ok) {
                    return res.status(404).json({ error: 'Chat session or message not found' });
                }
                notifyWsServer({ type: 'chat:sessionsUpdated' });
                notifyWsServer({
                    type: 'chat:restored',
                    sessionId: bundle.threadId,
                    messageId: bundle.chat.messageId,
                    blockIndex: bundle.chat.blockIndex,
                });
            } else if (bundle.chat) {
                storage.clearChatSession(bundle.threadId);
                notifyWsServer({ type: 'chat:sessionsUpdated' });
                notifyWsServer({
                    type: 'chat:restored',
                    sessionId: bundle.threadId,
                });
            }

            if (bundle.agentCheckpointId) {
                await saver.setRestoreHead(bundle.threadId, bundle.agentCheckpointId, '');
            }

            res.json({ status: 'restored', bundleId, bundle });
        } catch (err) {
            console.error('[filesystem-api] Error restoring checkpoint bundle:', err);
            res.status(500).json({ error: 'Failed to restore checkpoint bundle' });
        }
    });

    // 4. Start Listening
    const server = http.createServer(app);

    return new Promise((resolve) => {
        server.listen(port, () => {
            let actualPort = port;
            try {
                const address = server.address();
                if (address && typeof address === 'object' && 'port' in address) {
                    actualPort = (address as any).port;
                }
            } catch (err) {
                // ignore
            }

            console.log(`[filesystem-api] Listening on http://localhost:${actualPort} for ${filePath}`);

            // Listen for storage reload (external changes)
            storage.on('reload', () => {
                console.log(`[filesystem-api] Storage reloaded from disk. Notifying WS server...`);
                notifyWsServer({ type: 'system:reload' });
            });
            
            storage.on('saving', () => {
                notifyWsServer({ type: 'system:persistence_status', status: 'saving' });
            });
            
            storage.on('saved', () => {
                notifyWsServer({ type: 'system:persistence_status', status: 'saved' });
            });

            resolve({
                port: actualPort,
                storage,
                setWsPort: (port: number) => {
                    currentWsPort = port;
                    if (notifyWs) {
                        notifyWs.close(); // will trigger reconnect with new port
                    } else {
                        connectNotifyWs();
                    }
                },
                close: () => {
                    storage.stopWatcher();
                    return new Promise<void>((res) => server.close(() => res()));
                }
            });
        });
    });
}

