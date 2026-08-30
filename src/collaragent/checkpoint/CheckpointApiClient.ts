import type {
  CheckpointBundle,
  FileRevision,
  WorkspaceCommandLogEntry,
  WorkspaceSnapshot,
} from "@shared/checkpoints/types";

export type InstanceRecord = {
  id: string;
  name: string;
  type: string;
  projectId?: string;
  content: unknown;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type ChatSession = {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    toolCalls?: unknown[];
    blocks?: unknown[];
    timestamp?: number;
    metadata?: Record<string, unknown>;
  }>;
};

async function getFetch(): Promise<typeof fetch> {
  if (typeof (globalThis as any).fetch === "function") return (globalThis as any).fetch;
  try {
    const nf = await import("node-fetch");
    return (nf as any).default;
  } catch (e) {
    throw new Error("No fetch available in this runtime");
  }
}

export class CheckpointApiClient {
  private baseUrl: string;

  constructor(apiPort: number) {
    this.baseUrl = `http://localhost:${apiPort}/api`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const fetch = await getFetch();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Checkpoint API request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  async listInstances(): Promise<InstanceRecord[]> {
    const payload = await this.request<{ instances?: InstanceRecord[] }>("/instances");
    return payload.instances ?? [];
  }

  async getInstance(instanceId: string): Promise<InstanceRecord | null> {
    try {
      return await this.request<InstanceRecord>(`/instances/${encodeURIComponent(instanceId)}`);
    } catch (err) {
      if (String(err).includes("404")) return null;
      throw err;
    }
  }

  async updateInstanceContent(instanceId: string, payload: unknown): Promise<void> {
    await this.request(`/instances/${encodeURIComponent(instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ payload }),
    });
  }

  async createWorkspaceSnapshot(payload: {
    instanceId: string;
    instanceType: WorkspaceSnapshot["instanceType"];
    projectId: string;
    snapshot: unknown;
    snapshotCursor: WorkspaceSnapshot["snapshotCursor"];
  }): Promise<WorkspaceSnapshot> {
    return this.request("/checkpoints/workspace/snapshots", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getWorkspaceSnapshot(snapshotId: string): Promise<{ snapshot: WorkspaceSnapshot; payload: unknown }> {
    return this.request(`/checkpoints/workspace/snapshots/${encodeURIComponent(snapshotId)}`);
  }

  async getWorkspaceLogs(instanceId: string): Promise<WorkspaceCommandLogEntry[]> {
    const payload = await this.request<{ entries?: WorkspaceCommandLogEntry[] }>(
      `/checkpoints/workspace/logs/${encodeURIComponent(instanceId)}`,
    );
    return payload.entries ?? [];
  }

  async createFileRevision(reason: FileRevision["reason"]): Promise<FileRevision> {
    return this.request("/checkpoints/revisions", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async restoreFileRevision(revisionId: string): Promise<FileRevision | null> {
    const payload = await this.request<{ revision?: FileRevision }>(
      `/checkpoints/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: "POST" },
    );
    return payload.revision ?? null;
  }

  async getChatSession(sessionId: string): Promise<ChatSession | null> {
    try {
      return await this.request<ChatSession>(`/chat/sessions/${encodeURIComponent(sessionId)}`);
    } catch (err) {
      if (String(err).includes("404")) return null;
      throw err;
    }
  }

  async restoreChatSession(sessionId: string, messageId: string, blockIndex?: number): Promise<void> {
    await this.request(`/chat/sessions/${encodeURIComponent(sessionId)}/restore`, {
      method: "POST",
      body: JSON.stringify({ messageId, blockIndex }),
    });
  }

  async restoreCheckpointBundle(bundleId: string, options?: { sessionId?: string; threadId?: string }): Promise<CheckpointBundle> {
    const payload = await this.request<{ bundle: CheckpointBundle }>(
      "/checkpoints/restore",
      {
        method: "POST",
        body: JSON.stringify({ bundleId, sessionId: options?.sessionId, threadId: options?.threadId }),
      },
    );
    return payload.bundle;
  }
}
