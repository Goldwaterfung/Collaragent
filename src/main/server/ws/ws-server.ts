import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";

import {
	DocumentInstancePayloadSchema,
	EMPTY_DOCUMENT,
} from "@workspace/persistence/editorContent";
import { Command } from "@shared/commands";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@shared/constants";
import {
	canonicalizeGraphCanvasDTO,
	isCanonicalNodeId,
} from "@workspace/persistence/graphCanvasDto";
import { CommandPreviousState, InstanceType } from "@shared/checkpoints/types";

type DocumentPayload = z.infer<typeof DocumentInstancePayloadSchema>;

type HelloMessage = { type: "hello"; clientId?: string };
type SubscribeMessage = { type: "subscribe"; instanceId: string; clientId?: string };
type UpdateMessage = {
	type: "update";
	instanceId: string;
	clientId?: string;
	payload: DocumentPayload;
};
type RequestSyncMessage = { type: "requestSync"; instanceId: string; clientId?: string };
type DeleteMessage = { type: "delete"; instanceId: string; clientId?: string };
type WatchInstancesMessage = { type: "watchInstances"; clientId?: string };
type InstancesUpdatedMessage = { type: "instancesUpdated"; clientId?: string };
type InternalInstanceCreatedMessage = { type: "internal:instanceCreated"; instance: { id: string; name: string; type: string; projectId?: string; updatedAt?: string; metadata?: Record<string, any> } };
type InternalInstanceUpdatedMessage = { type: "internal:instanceUpdated"; instance: { id: string; name: string; type: string; projectId?: string; updatedAt?: string; metadata?: Record<string, any> } };
type InternalInstanceDeletedMessage = { type: "internal:instanceDeleted"; instanceId: string };
type SystemReloadMessage = { type: "system:reload" };
type SystemPersistenceStatusMessage = { type: "system:persistence_status"; status: 'saving' | 'saved' };

// New Canvas Command Protocol
type JoinMessage = { type: 'join'; clientId: string };
type SyncRequestMessage = { type: 'sync-request'; version?: number };
type SyncCommandMessage = { type: 'sync-command'; command: Command; clientId: string; version: number };
type AcceptChangesMessage = { type: 'accept-changes'; instanceId: string; clientId: string };
type RejectChangesMessage = { type: 'reject-changes'; instanceId: string; clientId: string };
type SyncChangesMessage = { type: 'sync-changes'; instanceId: string; commands: Command[] };

type Message =
	| HelloMessage
	| SubscribeMessage
	| UpdateMessage
	| RequestSyncMessage
	| DeleteMessage
	| WatchInstancesMessage
	| InstancesUpdatedMessage
	| JoinMessage
	| SyncRequestMessage
	| SyncCommandMessage
	| InternalInstanceCreatedMessage
	| InternalInstanceUpdatedMessage
	| InternalInstanceDeletedMessage
	| AcceptChangesMessage
	| RejectChangesMessage
	| SyncChangesMessage
	| SystemPersistenceStatusMessage
	| SystemReloadMessage;

export type WsServerHandle = {
	port: number;
	close: () => Promise<void>;
	flush: (instanceId?: string) => Promise<void>;
};

export type StartWsServerOptions = {
	port?: number;
	apiBaseUrl?: string;
};

const MessageSchema: z.ZodType<Message> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("hello"), clientId: z.string().optional() }),
	z.object({
		type: z.literal("subscribe"),
		instanceId: z.string(),
		clientId: z.string().optional(),
	}),
	z.object({
		type: z.literal("update"),
		instanceId: z.string(),
		clientId: z.string().optional(),
		payload: DocumentInstancePayloadSchema,
	}),
	z.object({
		type: z.literal("requestSync"),
		instanceId: z.string(),
		clientId: z.string().optional(),
	}),
	z.object({
		type: z.literal("delete"),
		instanceId: z.string(),
		clientId: z.string().optional(),
	}),
	z.object({ type: z.literal("watchInstances"), clientId: z.string().optional() }),
	z.object({ type: z.literal("instancesUpdated"), clientId: z.string().optional() }),
	z.object({ type: z.literal("internal:instanceCreated"), instance: z.any() }),
	z.object({ type: z.literal("internal:instanceUpdated"), instance: z.any() }),
	z.object({ type: z.literal("internal:instanceDeleted"), instanceId: z.string() }),
	// Canvas bits
	z.object({ type: z.literal("join"), clientId: z.string() }),
	z.object({ type: z.literal("sync-request"), version: z.number().optional() }),
	z.object({ type: z.literal("sync-command"), command: z.any(), clientId: z.string(), version: z.number() }),
	z.object({ type: z.literal("accept-changes"), instanceId: z.string(), clientId: z.string() }),
	z.object({ type: z.literal("reject-changes"), instanceId: z.string(), clientId: z.string() }),
	z.object({ type: z.literal("system:reload") }),
	z.object({ type: z.literal("system:persistence_status"), status: z.enum(['saving', 'saved']) }),
]) as z.ZodType<Message>;

export async function startWsServer(
	options: StartWsServerOptions = {},
): Promise<WsServerHandle> {
	let port = options.port ?? (process.env.WS_PORT ? Number(process.env.WS_PORT) : 0);
	const apiBaseUrl =
		options.apiBaseUrl ??
		process.env.DOCUMENT_INSTANCES_API_URL ??
		`http://localhost:${process.env.API_PORT || 0}/api/instances`;
	const apiRoot = apiBaseUrl.replace(/\/api\/instances\/?$/, "/api");

	const docs = new Map<string, DocumentPayload>();
	const channels = new Map<string, Set<WebSocket>>();
	const pendingHydrations = new Map<string, Promise<DocumentPayload | null>>();
	const instanceMetadata = new Map<string, { projectId?: string; name: string; type: string; updatedAt: string; metadata?: Record<string, any> }>();
	const instanceWatchers = new Set<WebSocket>();
	const commandSequences = new Map<string, number>();
	const proposals = new Map<string, Command[]>();

	function currentIsoTimestamp() {
		return new Date().toISOString();
	}

	function snapshotInstances() {
		return Array.from(instanceMetadata.entries()).map(([instanceId, meta]) => ({
			instanceId, // internal ID used by WS
			id: instanceId, // explicit ID for consumers expecting it
			projectId: meta.projectId,
			name: meta.name,
			type: meta.type,
			updatedAt: meta.updatedAt,
			metadata: meta.metadata,
		}));
	}

	async function appendWorkspaceLog(entry: {
		instanceId: string;
		instanceType: InstanceType;
		projectId: string;
		cursor: { seq: number; at?: string };
		command: unknown;
		source?: "ui" | "agent" | "sync";
		previousState?: CommandPreviousState;
	}) {
		try {
			await requestJson(`${apiRoot}/checkpoints/workspace/logs`, {
				method: "POST",
				body: JSON.stringify(entry),
			});
		} catch (err) {
			console.warn("[ws] Failed to append workspace log entry:", err);
		}
	}

	async function sendInstancesSync(targets: Iterable<WebSocket> = instanceWatchers) {
		if (!targets || typeof (targets as any)[Symbol.iterator] !== "function") return;

		const payload = JSON.stringify({
			type: "instancesSync",
			instances: snapshotInstances(),
		});
		for (const socket of targets) {
			if (!socket || socket.readyState !== WebSocket.OPEN) continue;
			try {
				socket.send(payload);
			} catch (err) {
				console.warn("[ws] Failed to send instancesSync:", err);
			}
		}
	}

	function registerInstance(
		instanceId: string,
		{ projectId, name, type, updatedAt, metadata, notify = true }: { projectId?: string; name: string; type: string; updatedAt?: string; metadata?: Record<string, any>; notify?: boolean },
	) {
		if (!instanceId) return;
		const resolvedUpdatedAt = updatedAt ?? currentIsoTimestamp();
		
		// We overwrite existing metadata entirely or merge? The plan implies we should keep it fresh.
		instanceMetadata.set(instanceId, { 
			projectId, 
			name,
			type,
			updatedAt: resolvedUpdatedAt,
			metadata
		});
		
		if (notify) {
			sendInstancesSync(); // always sync on registration/update in this simpler model
		}
	}

	function unregisterInstance(
		instanceId: string,
		{ notify = true }: { notify?: boolean } = {},
	) {
		if (!instanceId) return false;
		const removed = instanceMetadata.delete(instanceId);
		if (removed && notify) {
			sendInstancesSync();
		}
		return removed;
	}

	async function requestJson<T>(
		url: string,
		init?: RequestInit,
	): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				"content-type": "application/json",
				...(init?.headers ?? {}),
			},
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Request failed (${response.status}): ${text}`);
		}
		return (await response.json()) as T;
	}

	async function listDocumentInstancesFromApi(): Promise<
		Array<{ instanceId: string; projectId?: string; name: string; type: string; updatedAt?: string; metadata?: Record<string, any> }>
	> {
		// API returns { instances: Array<Summary> } where Summary has id, name, type, projectId, updatedAt
		const result = await requestJson<{ instances?: Array<{ id: string; projectId?: string; name: string; type: string; updatedAt?: string; metadata?: Record<string, any> }> }>(
			apiBaseUrl,
		);
		const items = Array.isArray(result.instances) ? result.instances : [];
		return items.map(item => ({
			instanceId: item.id,
			projectId: item.projectId,
			name: item.name,
			type: item.type,
			updatedAt: item.updatedAt,
			metadata: item.metadata
		}));
	}

	async function getDocumentInstanceFromApi(instanceId: string): Promise<
		| {
				instanceId: string;
				projectId?: string;
				name: string;
				type: string;
				payload: DocumentPayload;
				updatedAt?: string;
				metadata?: Record<string, any>;
			}
		| null
	> {
		if (!instanceId) return null;
		try {
			// API: GET /api/instances/:id -> Returns { id, name, type, projectId, content, updatedAt, metadata }
			const record = await requestJson<{
				id: string;
				name: string;
				type: string;
				projectId?: string;
				content: DocumentPayload;
				updatedAt?: string;
				metadata?: Record<string, any>;
			}>(`${apiBaseUrl}/${encodeURIComponent(instanceId)}`);
			
			return {
				instanceId: record.id,
				projectId: record.projectId,
				name: record.name,
				type: record.type,
				payload: record.content,
				updatedAt: record.updatedAt,
				metadata: record.metadata,
			};
		} catch (err) {
			if (err instanceof Error && err.message.includes("404")) {
				return null;
			}
			throw err;
		}
	}

	async function saveDocumentInstanceToApi(payload: {
		instanceId: string;
		projectId?: string;
		name?: string;
		payload: DocumentPayload;
	}) {
		// API: PATCH /api/instances/:id -> Body { projectId, name, payload/content }
		await requestJson<{ status: string; id: string }>(`${apiBaseUrl}/${payload.instanceId}`, {
			method: "PATCH",
			body: JSON.stringify({
				projectId: payload.projectId,
				// We generally don't update name via save content, but if we had it, we could.
				// However, saveToApi here is triggered by "update" message, which usually just carries content.
				payload: payload.payload, 
			}),
		});
	}

	function isDocumentBlocksPayload(payload: unknown): payload is Extract<DocumentPayload, { blocks: unknown[] }> {
		return Boolean(
			payload &&
			typeof payload === "object" &&
			"blocks" in payload,
		);
	}

	function isGraphCanvasPayload(payload: unknown): payload is Extract<DocumentPayload, { type: "graph-canvas" }> {
		return Boolean(
			payload &&
			typeof payload === "object" &&
			"type" in payload &&
			(payload as { type?: unknown }).type === "graph-canvas",
		);
	}

	function createDocumentBlockId(): string {
		const randomUuid = globalThis.crypto?.randomUUID?.();
		if (randomUuid) return randomUuid;
		return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function normalizeGraphPayload(payload: Extract<DocumentPayload, { type: "graph-canvas" }>): DocumentPayload {
		return canonicalizeGraphCanvasDTO(payload) as DocumentPayload;
	}

	function normalizeDocumentPayload(payload: Extract<DocumentPayload, { blocks: unknown[] }>): DocumentPayload {
		return {
			...payload,
			blocks: payload.blocks.map((block: any) =>
				block?.id ? block : { ...block, id: createDocumentBlockId() },
			),
		};
	}



	function validateIncomingCanvasCommand(command: Command, currentPayload: DocumentPayload | undefined): string | null {
		switch (command.type) {
			case "graph:add_node": {
				if (!isCanonicalNodeId(command.nodeId)) {
					return "graph:add_node requires a canonical UUID nodeId";
				}
				if (command.entity?.id && command.entity.id !== command.nodeId) {
					return "graph:add_node requires entity.id to match nodeId";
				}
				return null;
			}
			case "graph:update_node": {
				if (!isCanonicalNodeId(command.nodeId)) {
					return "graph:update_node requires a canonical UUID nodeId";
				}
				return null;
			}
			case "graph:update_node_layout":
			case "graph:remove_node":
				if (!isCanonicalNodeId(command.nodeId)) {
					return `${command.type} requires a canonical UUID nodeId`;
				}
				return null;
			case "graph:add_relationship":
				if (!isCanonicalNodeId(command.relationship.from.nodeId) || !isCanonicalNodeId(command.relationship.to.nodeId)) {
					return "graph:add_relationship endpoints must reference canonical UUID nodeIds";
				}
				if (currentPayload && isGraphCanvasPayload(currentPayload)) {
					const nodes = (currentPayload as any).graph?.nodes ?? {};
					if (!nodes[command.relationship.from.nodeId] || !nodes[command.relationship.to.nodeId]) {
						return "graph:add_relationship endpoints must reference existing nodes";
					}
				}
				return null;
			case "graph:update_relationship":
			case "graph:remove_relationship":
			case "editor:insert_block":
			case "editor:remove_block":
			case "editor:replace_document":
			case "editor:update_block":
			case "editor:update_comments":
				return null;
		}
	}

	function applyCommandToDto(payload: DocumentPayload, command: Command, instanceType?: string): { payload: DocumentPayload; previousState?: CommandPreviousState } {
		let previousState: CommandPreviousState | undefined = undefined;

		if (instanceType === 'canvas' && !isGraphCanvasPayload(payload)) {
			const dto = payload as any;
			dto.schemaVersion = 1;
			dto.type = "graph-canvas";
			dto.graph = dto.graph || { nodes: {}, relationships: {} };
			dto.layout = dto.layout || { layoutByNodeId: {} };
		}

		if (isGraphCanvasPayload(payload)) {
			const dto: any = payload;
			switch (command.type) {
				case 'graph:add_node':
					dto.graph.nodes[command.nodeId] = {
						id: command.nodeId,
						type: command.entity.type || 'card',
						name: command.entity.name,
						attrs: command.entity.attrs || {}
					};
					dto.layout.layoutByNodeId[command.nodeId] = {
						x: command.position.x,
						y: command.position.y,
						width: DEFAULT_NODE_WIDTH,
						height: DEFAULT_NODE_HEIGHT
					};
					break;
				case 'graph:update_node':
					const existingNode = dto.graph.nodes[command.nodeId];
					if (existingNode) {
						const capturedNode: Record<string, any> = { id: command.nodeId };
						for (const key of Object.keys(command.changes)) {
							capturedNode[key] = (existingNode as any)[key];
						}
						previousState = { node: capturedNode };
						Object.assign(existingNode, command.changes);
					}
					break;
				case 'graph:update_node_layout':
					if (!dto.layout.layoutByNodeId[command.nodeId]) {
						dto.layout.layoutByNodeId[command.nodeId] = { 
							x: 0, 
							y: 0, 
							width: DEFAULT_NODE_WIDTH, 
							height: DEFAULT_NODE_HEIGHT 
						};
					}
					const existingLayout = dto.layout.layoutByNodeId[command.nodeId];
					previousState = { layout: { ...existingLayout } };
					Object.assign(dto.layout.layoutByNodeId[command.nodeId], command.layout);
					break;
				case 'graph:remove_node':
					const nodeToDel = dto.graph.nodes[command.nodeId];
					const layoutToDel = dto.layout.layoutByNodeId[command.nodeId];
					const removedRelationships: any[] = [];
					if (nodeToDel) {
						for (const [relId, rel] of Object.entries(dto.graph.relationships || {}) as Array<[string, any]>) {
							if (rel?.from?.nodeId === command.nodeId || rel?.to?.nodeId === command.nodeId) {
								removedRelationships.push({ ...rel });
								delete dto.graph.relationships[relId];
							}
						}
						previousState = { 
							removedEntity: { ...nodeToDel },
							layout: layoutToDel ? { ...layoutToDel } : undefined,
							removedRelationships: removedRelationships.length > 0 ? removedRelationships : undefined,
						};
					}
					delete dto.graph.nodes[command.nodeId];
					delete dto.layout.layoutByNodeId[command.nodeId];
					break;
				case 'graph:add_relationship':
					dto.graph.relationships[command.relationshipId] = command.relationship;
					break;
				case 'graph:update_relationship':
					if (dto.graph.relationships[command.relationshipId]) {
						const rel = dto.graph.relationships[command.relationshipId];
						previousState = { removedRelationships: [{ ...rel }] as any[] };
						rel.attrs = { ...(rel.attrs || {}), ...command.changes };
					}
					break;
				case 'graph:remove_relationship':
					const relToDel = dto.graph.relationships[command.relationshipId];
					if (relToDel) {
						previousState = { removedRelationships: [{ ...relToDel }] as any[] };
					}
					delete dto.graph.relationships[command.relationshipId];
					break;
			}
		} else if (isDocumentBlocksPayload(payload)) {
			const doc = payload as any;
			switch (command.type) {
				case 'editor:replace_document':
					previousState = { documentPayload: { ...payload } };
					return { payload: command.payload, previousState };
				case 'editor:update_comments':
					previousState = { documentPayload: { comments: doc.comments } };
					doc.comments = command.comments;
					break;
				case 'editor:update_block':
					const block = doc.blocks.find((b: any) => b.id === command.blockId);
					if (block) {
						const capturedBlock: Record<string, any> = { id: command.blockId };
						for (const key of Object.keys(command.changes)) {
							capturedBlock[key] = (block as any)[key];
						}
						previousState = { block: capturedBlock };
						Object.assign(block, command.changes);
					}
					break;
				case 'editor:insert_block':
					doc.blocks.splice(command.index, 0, command.block);
					break;
				case 'editor:remove_block':
					const idx = doc.blocks.findIndex((b: any) => b.id === command.blockId);
					if (idx !== -1) {
						previousState = { 
							block: { ...doc.blocks[idx] },
							index: idx 
						};
						doc.blocks.splice(idx, 1);
					}
					break;
			}
		}

		return { payload, previousState };
	}

	const saveDebounceTimers = new Map<string, NodeJS.Timeout>();

	async function flush(instanceId?: string): Promise<void> {
		if (instanceId) {
			const timer = saveDebounceTimers.get(instanceId);
			if (timer) {
				clearTimeout(timer);
				saveDebounceTimers.delete(instanceId);
			}
			const doc = docs.get(instanceId);
			const meta = instanceMetadata.get(instanceId);
			if (doc && meta) {
				await saveDocumentInstanceToApi({
					instanceId,
					projectId: meta.projectId,
					payload: doc
				});
			}
			return;
		}

		const flushPromises: Promise<void>[] = [];
		for (const [id, timer] of saveDebounceTimers.entries()) {
			clearTimeout(timer);
			saveDebounceTimers.delete(id);
			const doc = docs.get(id);
			const meta = instanceMetadata.get(id);
			if (doc && meta) {
				flushPromises.push(
					saveDocumentInstanceToApi({
						instanceId: id,
						projectId: meta.projectId,
						payload: doc
					})
				);
			}
		}
		await Promise.all(flushPromises);
	}

	async function debouncedSave(instanceId: string, projectId: string | undefined, payload: DocumentPayload) {
		// Clear existing timer if any
		if (saveDebounceTimers.has(instanceId)) {
			clearTimeout(saveDebounceTimers.get(instanceId)!);
		}

		// Set new timer for 500ms
		const timer = setTimeout(async () => {
			try {
				if (!instanceMetadata.has(instanceId)) {
					console.log(`[ws] Skipping debounced update for deleted instance ${instanceId}`);
					saveDebounceTimers.delete(instanceId);
					return;
				}

				console.log(`[ws] Persisting debounced update for ${instanceId}`);
				await saveDocumentInstanceToApi({
					instanceId,
					projectId,
					payload
				});
				console.log(`[ws] Persist success for ${instanceId}`);
				saveDebounceTimers.delete(instanceId);
			} catch (err) {
				console.error(`[ws] Failed to persist document ${instanceId}:`, err);
			}
		}, 500);

		saveDebounceTimers.set(instanceId, timer);
	}

	async function hydrateDocument(instanceId: string) {
		if (docs.has(instanceId)) {
			return docs.get(instanceId) ?? null;
		}
		if (!instanceId) {
			return null;
		}
		if (pendingHydrations.has(instanceId)) {
			return pendingHydrations.get(instanceId) ?? null;
		}
		const hydrationPromise = (async () => {
			try {
				const record = await getDocumentInstanceFromApi(instanceId);
				if (record && record.payload) {
					const normalized = isGraphCanvasPayload(record.payload)
						? normalizeGraphPayload(record.payload)
						: isDocumentBlocksPayload(record.payload)
							? normalizeDocumentPayload(record.payload)
							: (record.payload as DocumentPayload);
					const isNew = !instanceMetadata.has(instanceId);
					docs.set(instanceId, normalized);
					registerInstance(instanceId, {
						projectId: record.projectId,
						name: record.name,
						type: record.type,
						updatedAt: record.updatedAt ?? currentIsoTimestamp(),
						metadata: record.metadata,
						notify: isNew,
					});

					// Phase 2: Initialize sequence counter from log tail on hydration
					try {
						const logs = await requestJson<{ entries?: any[] }>(`${apiRoot}/checkpoints/workspace/logs/${encodeURIComponent(instanceId)}`);
						const entries = logs.entries || [];
						if (entries.length > 0) {
							const lastSeq = entries[entries.length - 1]?.cursor?.seq ?? 0;
							commandSequences.set(instanceId, lastSeq);
							console.log(`[ws] Initialized sequence for ${instanceId} at ${lastSeq}`);
						}
					} catch (e) {
						console.warn(`[ws] Failed to initialize sequence for ${instanceId}:`, e);
					}

					return normalized;
				}
				return null;
			} catch (err) {
				console.error(`[ws] Failed to hydrate document ${instanceId}:`, err);
				return null;
			} finally {
				pendingHydrations.delete(instanceId);
			}
		})();
		pendingHydrations.set(instanceId, hydrationPromise);
		return hydrationPromise;
	}

	function broadcastSync(
		instanceId: string,
		payload: DocumentPayload,
		options: { exclude?: WebSocket | null; from?: string | null } = {},
	) {
		const { exclude = null, from = null } = options;
		const peers = channels.get(instanceId);
		if (!peers) return;
		const message = (() => {
			if (isGraphCanvasPayload(payload)) {
				const dto = normalizeGraphPayload(payload) as any;
				return JSON.stringify({
					type: "sync-snapshot",
					graph: dto.graph,
					layout: dto.layout?.layoutByNodeId ?? {},
					version: 1,
					instanceId,
					from,
				});
			}

			const doc = (payload || {}) as any;
			return JSON.stringify({
				type: "sync-snapshot",
				blocks: Array.isArray(doc.blocks) ? doc.blocks : [],
				comments: doc.comments,
				version: 1,
				instanceId,
				from,
			});
		})();
		for (const peer of peers) {
			if (peer.readyState !== WebSocket.OPEN) continue;
			if (exclude && peer === exclude) continue;
			try {
				peer.send(message);
			} catch (err) {
				console.warn(`[ws] Failed to broadcast to peer for ${instanceId}:`, err);
			}
		}
	}



	const server = http.createServer((req, res) => {
		if (req.url === "/healthz") {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("ok");
			return;
		}
		res.writeHead(404);
		res.end();
	});

	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url ?? "", `http://${req.headers.host}`);
		const pathname = url.pathname;

		if (pathname === "/ws/editor-content" || pathname === "/ws/instances" || pathname.startsWith("/ws/canvas/") || pathname.startsWith("/ws/editor/")) {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
		} else {
			socket.destroy();
		}
	});

	wss.on("connection", (ws, req) => {
		let clientId: string | null = null;
		let urlInstanceId: string | null = null;
		const subscribedKeys = new Set<string>();

		// Extract instanceId from URL if using /ws/canvas/:id or /ws/editor/:id
		const url = new URL(req.url ?? "", `http://${req.headers.host}`);
		if (url.pathname.startsWith("/ws/canvas/") || url.pathname.startsWith("/ws/editor/")) {
			urlInstanceId = url.pathname.split("/").pop() || null;
			if (urlInstanceId) {
				if (!channels.has(urlInstanceId)) channels.set(urlInstanceId, new Set());
				channels.get(urlInstanceId)?.add(ws);
				subscribedKeys.add(urlInstanceId);
			}
		}

		ws.on("message", async (data) => {
			try {
				let msg: unknown;
				try {
					msg = JSON.parse(data.toString());
				} catch {
					ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
					return;
				}

				const parsed = MessageSchema.safeParse(msg);
				if (!parsed.success) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Invalid message",
							issues: parsed.error.issues,
						}),
					);
					return;
				}

				const m = parsed.data;
				if (m.type === "hello") {
					clientId = m.clientId || clientId || Math.random().toString(36).slice(2);
					ws.send(JSON.stringify({ type: "hello", clientId }));
					return;
				}
				if (m.type === "subscribe") {
					clientId = m.clientId || clientId || Math.random().toString(36).slice(2);

					if (!channels.has(m.instanceId)) channels.set(m.instanceId, new Set());
					channels.get(m.instanceId)?.add(ws);
					subscribedKeys.add(m.instanceId);

					// We attempt to get metadata if we have it
					let meta = instanceMetadata.get(m.instanceId);
					
					let doc = docs.get(m.instanceId) ?? null;
					if (!doc) {
						doc = await hydrateDocument(m.instanceId);
						// refresh metadata after hydration
						meta = instanceMetadata.get(m.instanceId);
					}
					
					if (doc) {
						// Include name and type in the sync response as per Phase 3 requirements
						ws.send(JSON.stringify({ 
							type: "sync", 
							instanceId: m.instanceId, 
							payload: doc,
							instanceType: meta?.type,
							metadata: meta?.metadata
						}));
					}
					return;
				}
				if (m.type === "requestSync") {
					if (!m.instanceId) return;

					let doc = docs.get(m.instanceId) ?? null;
					let meta = instanceMetadata.get(m.instanceId);
					if (!doc) {
						doc = await hydrateDocument(m.instanceId);
						meta = instanceMetadata.get(m.instanceId);
					}
					if (doc) {
						ws.send(JSON.stringify({ 
							type: "sync", 
							instanceId: m.instanceId, 
							payload: doc,
							name: meta?.name,
							instanceType: meta?.type,
							metadata: meta?.metadata 
						}));
					}
					return;
				}
				if (m.type === "update") {
					// We only skip self-broadcasts but we WANT to process updates
					
					if (!instanceMetadata.has(m.instanceId)) {
						await hydrateDocument(m.instanceId);
					}

					const normalizedPayload = isGraphCanvasPayload(m.payload)
						? normalizeGraphPayload(m.payload)
						: isDocumentBlocksPayload(m.payload)
							? normalizeDocumentPayload(m.payload)
							: (m.payload as DocumentPayload);
					docs.set(m.instanceId, normalizedPayload);
					
					const existingMeta = instanceMetadata.get(m.instanceId);
					if (existingMeta) {
						registerInstance(m.instanceId, {
							...existingMeta,
							updatedAt: currentIsoTimestamp(),
							notify: true
						});
					}

					if (m.clientId === 'system-persistence-confirm') {
						return; 
					}

					broadcastSync(m.instanceId, normalizedPayload, {
						exclude: ws,
						from: m.clientId || null,
					});

					// Use debounced save for regular updates too
					await debouncedSave(m.instanceId, existingMeta?.projectId, normalizedPayload);
					return;
				}
				if (m.type === "watchInstances") {
					clientId = m.clientId || clientId || Math.random().toString(36).slice(2);
					instanceWatchers.add(ws);
					try {
						const records = await listDocumentInstancesFromApi();
						for (const record of records) {
							registerInstance(record.instanceId, {
								projectId: record.projectId,
								name: record.name,
								type: record.type,
								updatedAt: record.updatedAt ?? currentIsoTimestamp(),
								metadata: record.metadata,
								notify: false,
							});
						}
					} catch (err) {
						console.error("[ws] Failed to list document instances for watcher:", err);
					}
					sendInstancesSync([ws]);
					return;
				}
				if (m.type === "delete") {
					clientId = m.clientId || clientId || Math.random().toString(36).slice(2);

					docs.delete(m.instanceId);
					pendingHydrations.delete(m.instanceId);
					
					const timer = saveDebounceTimers.get(m.instanceId);
					if (timer) {
						clearTimeout(timer);
						saveDebounceTimers.delete(m.instanceId);
					}

					broadcastSync(m.instanceId, EMPTY_DOCUMENT as DocumentPayload, {
						from: clientId || null,
					});

					channels.delete(m.instanceId);
					unregisterInstance(m.instanceId, { notify: false });
					sendInstancesSync(); // broadcast deletion to watchers
					return;
				}
				if (m.type === "instancesUpdated") {
					try {
						const records = await listDocumentInstancesFromApi();
						const currentInstanceIds = new Set(records.map(r => r.instanceId));
						
						for (const existingId of instanceMetadata.keys()) {
							if (!currentInstanceIds.has(existingId)) {
								instanceMetadata.delete(existingId);
								docs.delete(existingId);
							}
						}

						for (const record of records) {
							registerInstance(record.instanceId, {
								projectId: record.projectId,
								name: record.name,
								type: record.type,
								updatedAt: record.updatedAt,
								metadata: record.metadata,
								notify: false,
							});
						}
						sendInstancesSync();
					} catch (err) {
						console.error("[ws] Failed to process instancesUpdated:", err);
					}
					return;
				}

				if (m.type === "internal:instanceCreated" || m.type === "internal:instanceUpdated") {
					try {
						const record = m.instance;
						registerInstance(record.id, {
							projectId: record.projectId,
							name: record.name,
							type: record.type,
							updatedAt: record.updatedAt ?? currentIsoTimestamp(),
							metadata: record.metadata,
							notify: false,
						});
						// Forward granular diff to UI watchers
						const payload = JSON.stringify({ type: m.type.replace('internal:', ''), instance: record });
						for (const watcher of instanceWatchers) {
							if (watcher.readyState === WebSocket.OPEN) watcher.send(payload);
						}
					} catch(err) {
						console.error(`[ws] Failed to process ${m.type}:`, err);
					}
					return;
				}

				if (m.type === "internal:instanceDeleted") {
					try {
						unregisterInstance(m.instanceId, { notify: false });
						docs.delete(m.instanceId);
						
						const timer = saveDebounceTimers.get(m.instanceId);
						if (timer) {
							clearTimeout(timer);
							saveDebounceTimers.delete(m.instanceId);
						}

						const payload = JSON.stringify({ type: 'instanceDeleted', instanceId: m.instanceId });
						for (const watcher of instanceWatchers) {
							if (watcher.readyState === WebSocket.OPEN) watcher.send(payload);
						}
					} catch(err) {
						console.error(`[ws] Failed to process internal:instanceDeleted:`, err);
					}
					return;
				}

				// --- New Protocol Handlers ---
				if (m.type === 'join') {
					clientId = m.clientId;
					ws.send(JSON.stringify({ type: 'hello', clientId }));
					return;
				}

				if (m.type === 'sync-request') {
					const instanceId = urlInstanceId;
					if (!instanceId) {
						ws.send(JSON.stringify({
							type: 'error',
							code: 'WORKSPACE_INSTANCE_ID_MISSING',
							message: 'No instance ID specified in connection route'
						}));
						return;
					}

					let doc = docs.get(instanceId) ?? null;
					if (!doc) doc = await hydrateDocument(instanceId);

					if (!doc) {
						ws.send(JSON.stringify({
							type: 'error',
							code: 'WORKSPACE_INSTANCE_NOT_FOUND',
							message: `Instance "${instanceId}" could not be found or hydrated`
						}));
						return;
					}

					if (isGraphCanvasPayload(doc)) {
						const canonicalDoc = normalizeGraphPayload(doc) as Extract<DocumentPayload, { type: "graph-canvas" }>;
						ws.send(JSON.stringify({
							type: 'sync-snapshot',
							graph: (canonicalDoc as any).graph,
							layout: (canonicalDoc as any).layout.layoutByNodeId,
							version: 1
						}));
					} else if (isDocumentBlocksPayload(doc)) {
						ws.send(JSON.stringify({
							type: 'sync-snapshot',
							blocks: doc.blocks,
							comments: doc.comments,
							version: 1
						}));
					} else {
						ws.send(JSON.stringify({
							type: 'error',
							code: 'WORKSPACE_PAYLOAD_INVALID',
							message: `Payload for instance "${instanceId}" is neither a valid document nor a canvas`
						}));
					}
					return;
				}

				if (m.type === 'sync-command') {
					const instanceId = urlInstanceId;
					if (!instanceId) return;

					// Ensure we have a payload in memory
					if (!docs.has(instanceId)) {
						await hydrateDocument(instanceId);
					}
					
					// Re-fetch the latest state from the map after potential hydration
					let doc = docs.get(instanceId);
					if (!doc) return;

					const commandIdentityError = validateIncomingCanvasCommand(m.command, doc);
					if (commandIdentityError) {
						ws.send(
							JSON.stringify({
								type: "error",
								message: commandIdentityError,
							}),
						);
						return;
					}

					const meta = instanceMetadata.get(instanceId);
					const nextSeq = (commandSequences.get(instanceId) ?? 0) + 1;
					const instanceType = meta?.type === 'canvas' ? 'graph-canvas' : 'document';
					
					commandSequences.set(instanceId, nextSeq);
					
					// 1. Update In-Memory state via Mutation (Fast)
					const { payload: nextDto, previousState } = applyCommandToDto(doc, m.command, meta?.type);
					const updatedDoc = isGraphCanvasPayload(nextDto)
						? normalizeGraphPayload(nextDto)
						: isDocumentBlocksPayload(nextDto)
							? normalizeDocumentPayload(nextDto)
							: (nextDto as DocumentPayload);
					docs.set(instanceId, updatedDoc);

					// If command is staged, buffer it with previous state and broadcast the current proposal state
					if ((m.command as any).staged) {
						if (!proposals.has(instanceId)) {
							proposals.set(instanceId, []);
						}
						// Attach previousState to the command for undo/revert
						const stagedCmd = { ...m.command, previousState };
						proposals.get(instanceId)!.push(stagedCmd);
						
						// Broadcast current proposal state to all clients in the channel
						const peers = channels.get(instanceId);
						if (peers) {
							const broadcastMsg = JSON.stringify({
								type: 'sync-changes',
								instanceId,
								commands: proposals.get(instanceId)
							});
							for (const peer of peers) {
								if (peer.readyState === WebSocket.OPEN) {
									peer.send(broadcastMsg);
								}
							}
						}
					}

					// 2. Broadcast to other users immediately (Real-time movement)
					const peers = channels.get(instanceId);
					if (peers) {
						const broadcastMsg = JSON.stringify({
							type: 'sync-command',
							command: m.command,
							clientId: m.clientId,
							version: nextSeq
						});
						for (const peer of peers) {
							if (peer !== ws && peer.readyState === WebSocket.OPEN) {
								peer.send(broadcastMsg);
							}
						}
					}

					if (ws.readyState === WebSocket.OPEN) {
						ws.send(
							JSON.stringify({
								type: 'sync-ack',
								version: nextSeq,
								clientVersion: m.version,
								instanceId,
							}),
						);
					}

					if (meta?.projectId) {
						const source = m.clientId?.startsWith('agent-')
							? 'agent'
							: m.clientId?.startsWith('ui-')
							? 'ui'
							: 'sync';
						void appendWorkspaceLog({
							instanceId,
							instanceType,
							projectId: meta.projectId,
							cursor: { seq: nextSeq, at: new Date().toISOString() },
							command: m.command,
							source,
							previousState,
						});
					}

					// 3. Debounce the Database Persistence (IO efficiency)
					await debouncedSave(instanceId, meta?.projectId, updatedDoc);


					return;
				}

				if (m.type === 'accept-changes') {
					const { instanceId } = m;
					const buffered = proposals.get(instanceId);
					if (!buffered || buffered.length === 0) return;

					// Changes are already applied, so we just clear the proposal buffer
					proposals.delete(instanceId);

					// Broadcast empty sync-changes to clear UI state for all clients
					const peers = channels.get(instanceId);
					if (peers) {
						const broadcastMsg = JSON.stringify({
							type: 'sync-changes',
							instanceId,
							commands: []
						});
						for (const peer of peers) {
							if (peer.readyState === WebSocket.OPEN) peer.send(broadcastMsg);
						}
					}
					return;
				}

				if (m.type === 'reject-changes') {
					const { instanceId } = m;
					const buffered = proposals.get(instanceId);
					if (!buffered || buffered.length === 0) return;

					// REVERTING (UNDO) logic
					if (!docs.has(instanceId)) {
						await hydrateDocument(instanceId);
					}
					let currentDoc = docs.get(instanceId);
					if (!currentDoc) return;

					const meta = instanceMetadata.get(instanceId);

					// Process in reverse to undo correctly
					for (const cmd of [...buffered].reverse()) {
						const prev = (cmd as any).previousState;
						if (!prev) continue;

						if (isDocumentBlocksPayload(currentDoc)) {
							const doc = currentDoc as any;
							switch (cmd.type) {
								case 'editor:replace_document':
									if (prev.documentPayload) {
										currentDoc = prev.documentPayload;
									}
									break;
								case 'editor:update_comments':
									if (prev.documentPayload?.comments) {
										doc.comments = prev.documentPayload.comments;
									}
									break;
								case 'editor:update_block':
									const block = doc.blocks.find((b: any) => b.id === cmd.blockId);
									if (block && prev.block) {
										Object.assign(block, prev.block);
									}
									break;
								case 'editor:insert_block':
									doc.blocks.splice(cmd.index, 1);
									break;
								case 'editor:remove_block':
									if (prev.block && prev.index !== undefined) {
										doc.blocks.splice(prev.index, 0, prev.block);
									}
									break;
							}
						}
					}

					docs.set(instanceId, currentDoc!);
					proposals.delete(instanceId);

					// Persist reverted state
					await debouncedSave(instanceId, meta?.projectId, currentDoc!);

					// Broadcast recovered snapshot to all clients
					broadcastSync(instanceId, currentDoc!, { from: 'agent-proposal-reverted' });

					// Broadcast clear to all clients
					const peers = channels.get(instanceId);
					if (peers) {
						const broadcastMsg = JSON.stringify({
							type: 'sync-changes',
							instanceId,
							commands: []
						});
						for (const peer of peers) {
							if (peer.readyState === WebSocket.OPEN) peer.send(broadcastMsg);
						}
					}
					return;
				}

				if (m.type === 'system:persistence_status') {
					const broadcastMsg = JSON.stringify(m);
					for (const client of wss.clients) {
						if (client.readyState === WebSocket.OPEN) {
							client.send(broadcastMsg);
						}
					}
					return;
				}
				
				if (m.type === "system:reload") {
					console.log(`[ws] System reload requested. Broadcasting to all clients...`);
					const broadcastMsg = JSON.stringify({ type: 'system:reload' });
					for (const client of wss.clients) {
						if (client.readyState === WebSocket.OPEN) {
							client.send(broadcastMsg);
						}
					}
					return;
				}
			} catch (err) {
				console.error("[ws] Error handling message:", err);
				ws.send(JSON.stringify({ type: "error", message: "Internal server error" }));
			}
		});

		ws.on("close", () => {
			instanceWatchers.delete(ws);
			for (const instanceId of subscribedKeys) {
				const peers = channels.get(instanceId);
				if (peers) {
					peers.delete(ws);
					if (peers.size === 0) channels.delete(instanceId);
				}
			}
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(port, () => resolve());
	});

	// Resolve the actual bound port (in case port 0 was used)
	try {
		const address = server.address();
		// address can be string or AddressInfo; handle both
		if (address && typeof address === 'object' && 'port' in address) {
			// @ts-ignore - node types
			port = (address as any).port as number;
		}
	} catch (err) {
		// ignore and keep configured port
	}

	console.log(`[ws] listening on ws://localhost:${port}/ws/editor-content`);

	return {
		port,
		flush,
		close: async () => {
			await flush();
			for (const client of wss.clients) {
				try {
					client.close();
				} catch {
					// ignore
				}
			}
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		},
	};
}
