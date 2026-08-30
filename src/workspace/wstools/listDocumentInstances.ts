import http from "node:http";
import { z } from "zod";
import WebSocket from "ws";
import { createSocket, type ConnectionOverrides } from "@workspace/sync/ClientConnection";
import { DEFAULT_INSTANCE_ID, normalizeInstanceSummaries } from "@workspace/contexts/instance/instanceSummaries";

export type DocumentInstanceSummary = {
  instanceId: string;
  projectId?: string;
  updatedAt?: string;
  name?: string;
  type?: 'document' | 'canvas';
};

export type ProjectSummary = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ListDocumentInstancesResult = {
  instances: DocumentInstanceSummary[];
  projects: ProjectSummary[];
  clientId: string;
};

const DEFAULT_TIMEOUT_MS = 2000;

type ListDocumentInstancesOverrides = ConnectionOverrides & {
  timeoutMs?: number;
  instanceId?: string | null;
  apiPort?: number;
  apiHost?: string;
};

const InstanceSummaryApiSchema = z.object({
  id: z.string().optional(),
  instanceId: z.string().optional(),
  name: z.string().optional(),
  projectId: z.string().optional(),
  type: z.enum(['document', 'canvas']).optional(),
  updatedAt: z.string().optional()
});

const InstancesApiResponseSchema = z.union([
  z.object({
    instances: z.array(InstanceSummaryApiSchema)
  }),
  z.array(InstanceSummaryApiSchema)
]);

const ProjectSummaryApiSchema = z.object({
  id: z.string(),
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  createdAt: z.union([z.string(), z.number()]).transform(v => String(v)),
  updatedAt: z.union([z.string(), z.number()]).optional().transform(v => v !== undefined ? String(v) : new Date().toISOString())
});

const ProjectsApiResponseSchema = z.union([
  z.object({
    projects: z.array(ProjectSummaryApiSchema)
  }),
  z.array(ProjectSummaryApiSchema)
]);

const InstancesSyncMsgSchema = z.object({
  type: z.literal('instancesSync'),
  instances: z.array(InstanceSummaryApiSchema)
});

async function fetchProjects(options?: { host?: string; port?: number }): Promise<ProjectSummary[]> {
  return new Promise((resolve, reject) => {
    const port = options?.port || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);
    if (!port) {
      resolve([]);
      return;
    }
    const host = options?.host || process.env.API_HOST || "localhost";
    
    const req = http.request({
      hostname: host,
      port: port,
      path: "/api/projects",
      method: "GET",
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const rawJson: unknown = JSON.parse(data);
            const parsed = ProjectsApiResponseSchema.safeParse(rawJson);
            if (parsed.success) {
              const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.projects;
              resolve(list.map(p => ({
                id: p.id,
                name: p.name,
                metadata: p.metadata,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
              })));
              return;
            }
            reject(new Error(`Invalid /api/projects schema: ${parsed.error.message}`));
            return;
          }
          reject(new Error(`Failed to fetch projects (status ${res.statusCode}): ${data}`));
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          reject(err);
        }
      });
    });
    
    req.on("error", (err) => {
      reject(err);
    });
    req.end();
  });
}

async function fetchInstancesFromApi(options?: { host?: string; port?: number }): Promise<DocumentInstanceSummary[]> {
  return new Promise((resolve, reject) => {
    const port = options?.port || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);
    if (!port) {
      resolve([]);
      return;
    }
    const host = options?.host || process.env.API_HOST || "localhost";
    const req = http.request({
      hostname: host,
      port: port,
      path: "/api/instances",
      method: "GET",
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            const rawJson: unknown = JSON.parse(data);
            const parsed = InstancesApiResponseSchema.safeParse(rawJson);
            if (parsed.success) {
              const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.instances;
              resolve(list.map(item => ({
                instanceId: item.id || item.instanceId || "",
                name: item.name,
                projectId: item.projectId,
                type: item.type,
                updatedAt: item.updatedAt
              })));
              return;
            }
            reject(new Error(`Invalid /api/instances schema: ${parsed.error.message}`));
            return;
          }
          reject(new Error(`Failed to fetch instances (status ${res.statusCode}): ${data}`));
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          reject(err);
        }
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

export async function listDocumentInstances(
  overrides: ListDocumentInstancesOverrides = {},
): Promise<ListDocumentInstancesResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    instanceId,
    apiPort,
    apiHost,
    ...connectionOverrides
  } = overrides;

  const effectiveApiPort = apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined);

  // If apiPort is available, query the REST API directly for deterministic, zero-timeout discovery
  if (effectiveApiPort) {
    const [instances, projects] = await Promise.all([
      fetchInstancesFromApi({ host: apiHost, port: effectiveApiPort }),
      fetchProjects({ host: apiHost, port: effectiveApiPort })
    ]);

    let finalInstances = instances;
    if (instanceId) {
      finalInstances = instances.filter(i => i.instanceId === instanceId);
    }

    return {
      instances: finalInstances,
      projects,
      clientId: connectionOverrides.clientId || "agent-client"
    };
  }

  // Fallback: Query WebSocket endpoint
  const socket = createSocket(connectionOverrides);
  const { ws, connection, waitForOpen, waitForClose } = socket;
  const { clientId } = connection;

  let timer: NodeJS.Timeout | null = null;

  try {
    await waitForOpen();

    let onMessage: ((data: WebSocket.RawData) => void) | null = null;
    let onError: ((err: Error) => void) | null = null;

    const cleanup = () => {
      try {
        if (onMessage) ws.off("message", onMessage);
        if (onError) ws.off("error", onError);
      } catch {
        // ignore
      }
    };

    const instancesPromise = new Promise<DocumentInstanceSummary[]>((resolve, reject) => {
      onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      onMessage = (data: WebSocket.RawData) => {
        try {
          const text =
            typeof data === "string"
              ? data
              : typeof Buffer !== "undefined" && data instanceof Buffer
              ? data.toString()
              : String(data);
          const msg: unknown = JSON.parse(text);
          const parsedSync = InstancesSyncMsgSchema.safeParse(msg);
          if (parsedSync.success) {
            cleanup();
            const normalized = normalizeInstanceSummaries(parsedSync.data.instances, DEFAULT_INSTANCE_ID);
            resolve(normalized);
          }
        } catch {
          // ignore unparsable messages
        }
      };

      ws.on("message", onMessage);
      ws.on("error", onError);

      try {
        ws.send(JSON.stringify({ type: "hello", clientId }));
        ws.send(JSON.stringify({ type: "watchInstances", clientId }));
      } catch (err: unknown) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    const projectsPromise = fetchProjects({ host: apiHost, port: apiPort });

    const timeoutPromise = new Promise<DocumentInstanceSummary[]>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out while fetching document instances via WebSocket")), timeoutMs);
    });

    const [instances, projects] = await Promise.all([
      Promise.race([instancesPromise, timeoutPromise]),
      projectsPromise
    ]);
    
    cleanup();
    
    let finalInstances = instances;
    if (instanceId) {
      finalInstances = instances.filter(
        (instance) => instance.instanceId === instanceId
      );
    }
    
    return { instances: finalInstances, projects, clientId };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
      await waitForClose().catch(() => undefined);
    }
  }
}
