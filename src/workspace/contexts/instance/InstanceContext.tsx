import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProjectSession } from "../project/ProjectSession";
import { isInstancesSyncMessage } from "../../editor/types/editorContentMessage";
import {
  DEFAULT_INSTANCE_ID,
  normalizeInstanceIds,
  normalizeInstanceIdList,
  normalizeInstanceSummaries,
  areInstanceIdListsEqual,
  type InstanceSummary,
  type NormalizedInstanceSummary,
} from "./instanceSummaries";
import { instanceService } from "@shared/services/InstanceService";

export type Project = {
  id: string;
  name: string;
  metadata?: Record<string, any>;
};

type InstanceContextValue = {
  instanceId: string;
  setInstanceId: (id: string) => void;
  instanceIds: string[];
  openInstanceIds: string[];
  setOpenInstanceIds: (ids: string[]) => void;
  instanceSummaries: NormalizedInstanceSummary[];
  createInstance: (name: string, type: 'document' | 'canvas', projectId: string, metadata?: Record<string, any>) => Promise<void>;
  renameInstance: (id: string, name: string) => Promise<void>;
  refreshInstanceIds: () => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  deleteInstances: (ids: string[]) => Promise<void>;
  unsetInstanceId: () => void;
  // Projects
  // Projects
  projects: Project[];
  activeProjectId?: string;
  setActiveProjectId: (id: string | undefined) => void;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  isLoaded: boolean;
  // Session ports for WebSocket connections
  wsPort: number | null;
  // Markdown import
  importMarkdownAsDocument: (name: string, markdownContent: string, projectId: string) => Promise<void>;
  consumePendingMarkdown: (instanceId: string) => string | undefined;
  isPersisting: boolean;
};

const DEFAULT_INSTANCE = DEFAULT_INSTANCE_ID;
const ACTIVE_ID_STORAGE_KEY = "docEditorActiveInstanceId";

const InstanceContext = createContext<InstanceContextValue | null>(null);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const { apiPort, wsPort } = useProjectSession();

  const [instanceSummaries, setInstanceSummaries] = useState<NormalizedInstanceSummary[]>([]);
  const [instanceIds, setInstanceIds] = useState<string[]>([DEFAULT_INSTANCE]);
  const [openInstanceIds, setOpenInstanceIdsState] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>();
  const [instanceId, setInstanceIdState] = useState<string>(DEFAULT_INSTANCE);
  const [isPersisting, setIsPersisting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const registrySocketRef = useRef<WebSocket | null>(null);
  const pendingMarkdownRef = useRef<Map<string, string>>(new Map());
  const instanceIdRef = useRef(instanceId);
  const instanceSummariesRef = useRef(instanceSummaries);
  const instanceWatcherClientId = useMemo(() => Math.random().toString(36).slice(2), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    instanceIdRef.current = instanceId;
    instanceSummariesRef.current = instanceSummaries;
  }, [instanceId, instanceSummaries]);

  const setOpenInstanceIds = useCallback((ids: string[]) => {
    const normalizedIds = normalizeInstanceIdList(ids, DEFAULT_INSTANCE);
    setOpenInstanceIdsState((prev) => (areInstanceIdListsEqual(prev, normalizedIds) ? prev : normalizedIds));
  }, []);

  const getNextActiveInstanceId = useCallback(
    (deletedSet: ReadonlySet<string>) => {
      const currentInstanceId = instanceIdRef.current;
      if (!deletedSet.has(currentInstanceId)) {
        return currentInstanceId;
      }

      const remaining = instanceSummariesRef.current.filter((summary) => !deletedSet.has(summary.instanceId));
      if (remaining.length === 0) {
        return DEFAULT_INSTANCE;
      }

      const firstDeleted = instanceSummariesRef.current.find((summary) => deletedSet.has(summary.instanceId));
      const preferredType = firstDeleted?.type;
      const nextMatch = preferredType
        ? remaining.find((summary) => summary.type === preferredType)
        : undefined;

      return nextMatch?.instanceId || remaining[0].instanceId;
    },
    [],
  );

  const applyDeletedInstances = useCallback(
    (deletedIds: string[]) => {
      if (deletedIds.length === 0) {
        return;
      }

      const deletedSet = new Set(deletedIds);
      const nextActiveId = getNextActiveInstanceId(deletedSet);

      setInstanceSummaries((prev) => {
        const next = prev.filter((summary) => !deletedSet.has(summary.instanceId));
        return next.length === prev.length ? prev : next;
      });
      setInstanceIds((prev) => {
        const next = prev.filter((id) => !deletedSet.has(id));
        return areInstanceIdListsEqual(prev, next) ? prev : next;
      });
      setOpenInstanceIdsState((prev) => {
        const next = prev.filter((id) => !deletedSet.has(id));
        return areInstanceIdListsEqual(prev, next) ? prev : next;
      });
      setInstanceIdState((current) => (deletedSet.has(current) ? nextActiveId : current));
    },
    [getNextActiveInstanceId],
  );

  const consumePendingMarkdown = useCallback((id: string) => {
    const content = pendingMarkdownRef.current.get(id);
    if (content) {
      pendingMarkdownRef.current.delete(id);
    }
    return content;
  }, []);

  const importMarkdownAsDocument = useCallback(async (name: string, markdownContent: string, projectId: string) => {
    try {
      // 1. Create document with unique name
      const { instanceId: newId, name: uniqueName } = await instanceService.createDocumentWithUniqueName(name, projectId, { isHidden: false });

      // 2. Store content for editor consumption
      pendingMarkdownRef.current.set(newId, markdownContent);

      // 3. Optimistically update local state
      const newSummary: NormalizedInstanceSummary = {
        instanceId: newId,
        name: uniqueName,
        type: 'document',
        projectId: projectId,
        updatedAt: new Date().toISOString(),
      };

      setInstanceSummaries((prev) => {
        if (prev.some(s => s.instanceId === newId)) return prev;
        return [...prev, newSummary];
      });

      setInstanceIds((prev) => {
        if (prev.includes(newId)) return prev;
        return [...prev, newId];
      });

      // 4. Set as active
      setInstanceIdState(newId);
    } catch (err) {
      console.error("Failed to import markdown document:", err);
      throw err;
    }
  }, []);

  const applyRemoteIds = useCallback((instances: InstanceSummary[]) => {
    // API returns 'id', internal types usage 'instanceId'. If API returns raw rows, it might have 'id'.
    // We map 'id' to 'instanceId' if 'instanceId' is missing.
    const mappedInstances: InstanceSummary[] = instances.map(inst => ({
      ...inst,
      instanceId: inst.instanceId || (inst as any).id,
    }));

    const nextIds = normalizeInstanceIds(mappedInstances, DEFAULT_INSTANCE);
    setInstanceIds((prev) => (areInstanceIdListsEqual(prev, nextIds) ? prev : nextIds));

    const summaries = normalizeInstanceSummaries(mappedInstances, DEFAULT_INSTANCE);
    setInstanceSummaries(summaries);

    // Update react-query cache as well so consumers using the query are in sync
    queryClient.setQueryData(["documentInstances"], nextIds);
  }, [queryClient]);

  const setInstanceId = useCallback((id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    setInstanceIdState((curr) => (curr === trimmed ? curr : trimmed));
  }, []);

  const unsetInstanceId = useCallback(() => {
    setInstanceIdState("");
  }, []);

  const fetchInstances = useCallback(async () => {
    try {
      // instanceService is already configured with the correct base URL by ProjectSession
      const instances = await instanceService.getAll();
      return instances;
    } catch (err) {
      console.error("Failed to load instances", err);
      return [];
    }
  }, []);

  const queryKey = ["documentInstancesSummary"] as const;

  const instancesQuery = useQuery<InstanceSummary[], Error>({
    queryKey,
    queryFn: fetchInstances,
    enabled: !!apiPort, // Only fetch when we have a port
  });

  useEffect(() => {
    if (instancesQuery.data) {
      const mappedInstances: InstanceSummary[] = instancesQuery.data.map(inst => ({
        ...inst,
        instanceId: inst.instanceId || (inst as any).id,
      }));

      const nextIds = normalizeInstanceIds(mappedInstances, DEFAULT_INSTANCE);
      setInstanceIds((prev) => (areInstanceIdListsEqual(prev, nextIds) ? prev : nextIds));

      const summaries = normalizeInstanceSummaries(mappedInstances, DEFAULT_INSTANCE);
      setInstanceSummaries(summaries);
    }
  }, [instancesQuery.data]);


  // Projects handling
  const fetchProjects = useCallback(async () => {
    if (!apiPort) return [];
    const res = await fetch(`http://localhost:${apiPort}/api/projects`);
    if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
    const data = await res.json();
    return data.projects || [];
  }, [apiPort]);

  const projectsQuery = useQuery<Project[], Error>({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled: !!apiPort,
  });

  useEffect(() => {
    if (projectsQuery.data) {
      setProjects(projectsQuery.data);
      // Auto-select first project if none selected
      if (!activeProjectId && projectsQuery.data.length > 0) {
        setActiveProjectId(projectsQuery.data[0].id);
      }
    }
  }, [projectsQuery.data, activeProjectId]);

  const refreshProjects = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [queryClient]);

  const refreshInstanceIds = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);

  const createMutation = useMutation<any, Error, { name: string; type: 'document' | 'canvas'; projectId: string; metadata?: Record<string, any> }>({
    mutationFn: async ({ name, type, projectId, metadata }) => {
      const id = await instanceService.create({ name, type, projectId, metadata });
      return { id };
    },
    onSuccess: (data, variables) => {
      if (data && data.id) {
        const newSummary: NormalizedInstanceSummary = {
          instanceId: data.id,
          name: variables.name,
          type: variables.type,
          projectId: variables.projectId,
          metadata: variables.metadata,
          updatedAt: new Date().toISOString(),
        };

        setInstanceSummaries((prev) => {
          if (prev.some(s => s.instanceId === data.id)) return prev;
          return [...prev, newSummary];
        });

        setInstanceIds((prev) => {
          if (prev.includes(data.id)) return prev;
          return [...prev, data.id];
        });

        setInstanceIdState(data.id);
      }
    },
  });

  const renameMutation = useMutation<void, Error, { id: string; name: string }>({
    mutationFn: async ({ id, name }) => {
      await instanceService.update(id, { name });
    },
    onSuccess: () => {
      refreshInstanceIds();
    },
  });

  const createProjectMutation = useMutation<void, Error, { name: string }>({
    mutationFn: async ({ name }) => {
      if (!apiPort) throw new Error("No API port available");
      const res = await fetch(`http://localhost:${apiPort}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
    },
    onSuccess: () => refreshProjects(),
  });

  const deleteProjectMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      if (!apiPort) throw new Error("No API port available");
      const res = await fetch(`http://localhost:${apiPort}/api/projects/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete project: ${res.status}`);
    },
    onSuccess: () => {
      refreshProjects();
      refreshInstanceIds();
    },
  });

  const deleteMutation = useMutation<any, Error, string | string[]>({
    mutationFn: async (input: string | string[]) => {
      const ids = Array.isArray(input) ? input : [input];
      const validIds = ids.map(id => id.trim()).filter(id => id && id !== DEFAULT_INSTANCE);

      if (validIds.length === 0) return null;

      // We perform deletions sequentially for simplicity since the backend might not have bulk delete
      for (const id of validIds) {
        await instanceService.delete(id);
      }
      return validIds;
    },
    onSuccess: (deletedIds) => {
      if (!deletedIds || deletedIds.length === 0) return;

      const deletedIdsArray = Array.isArray(deletedIds) ? deletedIds : [deletedIds];
      applyDeletedInstances(deletedIdsArray);
      // Defer the re-fetch so it runs after the current render cycle completes.
      // Calling refreshInstanceIds() synchronously here would invalidate the TanStack Query,
      // triggering useEffect([instancesQuery.data]) → more setInstanceSummaries/setInstanceIds
      // calls in the same cycle → React Error #185 (Maximum update depth exceeded).
      setTimeout(() => { refreshInstanceIds(); }, 0);
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedActive = localStorage.getItem(ACTIVE_ID_STORAGE_KEY);
    if (storedActive) {
      setInstanceIdState(storedActive);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(ACTIVE_ID_STORAGE_KEY, instanceId);
    } catch {
      // ignore storage failures
    }
  }, [instanceId]);

  useEffect(() => {
    if (typeof window === "undefined" || !wsPort) return;

    // Use dynamic WS port with /ws/instances endpoint
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws/instances`);
    registrySocketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", clientId: instanceWatcherClientId }));
      ws.send(JSON.stringify({ type: "watchInstances", clientId: instanceWatcherClientId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "instanceCreated" || data.type === "instanceUpdated") {
          const sum = data.instance;
          const id = sum.id || sum.instanceId;
          const newSummary: NormalizedInstanceSummary = {
            instanceId: id,
            name: sum.name,
            type: sum.type as 'document' | 'canvas',
            projectId: sum.projectId,
            metadata: sum.metadata,
            updatedAt: sum.updatedAt || new Date().toISOString(),
          };

          setInstanceSummaries((prev) => {
            const existingIndex = prev.findIndex(s => s.instanceId === id);
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = newSummary;
              return next;
            }
            return [...prev, newSummary];
          });

          setInstanceIds((prev) => prev.includes(id) ? prev : [...prev, id]);
          return;
        }

        if (data.type === "instanceDeleted") {
          const deletedId = data.instanceId;
          applyDeletedInstances([deletedId]);
          return;
        }

        if (isInstancesSyncMessage(data)) {
          applyRemoteIds(Array.isArray(data.instances) ? data.instances as InstanceSummary[] : []);
          return;
        }

        if (data.type === 'system:persistence_status') {
          setIsPersisting(data.status === 'saving');
          return;
        }
      } catch (error) {
        console.error("Failed to process instancesSync message:", error);
      }
    };

    ws.onclose = () => {
      // ...
    };

    ws.onerror = (error) => {
      console.error("Instance registry socket error:", error);
    };

    return () => {
      if (registrySocketRef.current === ws) {
        registrySocketRef.current = null;
      }
      ws.close();
    };
  }, [applyDeletedInstances, applyRemoteIds, instanceWatcherClientId, refreshInstanceIds, wsPort]);

  // Subscribe to instance open requests emitted via the shared service
  useEffect(() => {
    const sub = instanceService.subscribeToOpen(async (detail) => {
      try {
        const { instanceId: requestedId, instanceName, projectName } = detail || {};

        const addInstanceLocally = (id: string, summary?: NormalizedInstanceSummary) => {
          setInstanceIdState(id);
          setInstanceIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
          if (summary) {
            setInstanceSummaries((prev) =>
              prev.some((s) => s.instanceId === id) ? prev : [...prev, summary]
            );
          }
        };

        if (requestedId && typeof requestedId === 'string' && requestedId.trim()) {
          const trimmedId = requestedId.trim();
          let summary = instanceSummaries.find(s => s.instanceId === trimmedId);

          if (!summary) {
            try {
              // Fetch the exact details of the instance so we have the correct 'type' and 'projectId'
              const res = await instanceService.getById(trimmedId);
              if (res) {
                summary = {
                  instanceId: res.id,
                  name: res.name,
                  type: res.type as 'document' | 'canvas',
                  projectId: res.projectId,
                  metadata: res.metadata,
                  updatedAt: res.updatedAt,
                };
              }
            } catch (err) {
              console.error('Failed to fetch exact instance details before opening', err);
            }
          }

          // Fallback if the query fails but we still want to optimistically open it
          if (!summary && instanceName) {
            const projectId = projectName ? (projects.find((p) => p.name === projectName)?.id || '') : '';
            summary = {
              instanceId: trimmedId,
              name: instanceName,
              type: 'document', // fallback
              projectId,
              updatedAt: new Date().toISOString()
            };
          }

          if (summary) {
            addInstanceLocally(trimmedId, summary);
          } else {
            setInstanceIdState(trimmedId);
          }
          return;
        }

        if (!instanceName) return;

        if (projectName) {
          const project = projects.find((p) => p.name === projectName);
          if (!project) {
            console.warn(`Requested project not found: ${projectName} — aborting instance lookup for ${instanceName}`);
            return;
          }

          const projectId = project.id;
          let found = instanceSummaries.find((s) => s.name === instanceName && s.projectId === projectId);

          if (!found) {
            try {
              const f = await instanceService.findByName(instanceName, projectId);
              if (f) found = f as any;
            } catch (err) {
              console.error('Failed to lookup instance for open event (project-scoped)', err);
            }
          }

          if (found) {
            addInstanceLocally(found.instanceId, found as NormalizedInstanceSummary);
          } else {
            console.warn(`Requested instance not found in project ${projectName}: ${instanceName}`);
          }

          return;
        }

        const found = instanceSummaries.find((s) => s.name === instanceName);
        if (found) {
          setInstanceIdState(found.instanceId);
        } else {
          console.warn(`Requested instance not found locally: ${instanceName} (no global lookup performed)`);
        }
      } catch (err) {
        console.error('Error handling instance open event', err);
      }
    });

    return () => {
      sub();
    };
  }, [instanceSummaries, projects]);

  useEffect(() => {
    // Only bootstrap if we have a port
    if (!apiPort) return;

    const bootstrap = async () => {
      try {
        const instances = await instanceService.getAll();
        applyRemoteIds(instances);
      } catch (e) {
        console.error("Bootstrap fetch failed", e);
      }
    };
    bootstrap();

    instancesQuery.refetch().then(() => {
      setIsLoaded(true);
    }).catch((error) => {
      console.error("Initial instance refresh failed:", error);
      setIsLoaded(true);
    });
  }, [apiPort]);

  const value = useMemo<InstanceContextValue>(
    () => ({
      instanceId,
      setInstanceId,
      instanceIds,
      openInstanceIds,
      setOpenInstanceIds,
      instanceSummaries,
      createInstance: async (name, type, projectId, metadata) => {
        await createMutation.mutateAsync({ name, type, projectId, metadata });
      },
      renameInstance: async (id, name) => {
        await renameMutation.mutateAsync({ id, name });
      },
      refreshInstanceIds: () => refreshInstanceIds(),
      deleteInstance: async (id: string) => {
        await deleteMutation.mutateAsync(id);
      },
      deleteInstances: async (ids: string[]) => {
        await deleteMutation.mutateAsync(ids);
      },
      unsetInstanceId,
      activeProjectId,
      setActiveProjectId,
      projects,
      refreshProjects,
      createProject: async (name: string) => {
        await createProjectMutation.mutateAsync({ name });
      },
      deleteProject: async (id: string) => {
        await deleteProjectMutation.mutateAsync(id);
      },
      isLoaded,
      wsPort,
      importMarkdownAsDocument,
      consumePendingMarkdown,
      isPersisting,
    }),
    [
      instanceId,
      setInstanceId,
      instanceIds,
      openInstanceIds,
      setOpenInstanceIds,
      instanceSummaries,
      createMutation,
      renameMutation,
      refreshInstanceIds,
      deleteMutation,
      unsetInstanceId,
      projects,
      refreshProjects,
      createProjectMutation,
      deleteProjectMutation,
      isLoaded,
      wsPort,
      importMarkdownAsDocument,
      consumePendingMarkdown,
      isPersisting,
    ],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function InstanceScope({ children, instanceId }: { children: ReactNode; instanceId: string }) {
  const parentContext = useContext(InstanceContext);
  if (!parentContext) {
    throw new Error("InstanceScope must be used within InstanceProvider");
  }

  const value = useMemo<InstanceContextValue>(
    () => ({
      ...parentContext,
      instanceId,
      isLoaded: parentContext.isLoaded,
      wsPort: parentContext.wsPort,
      importMarkdownAsDocument: parentContext.importMarkdownAsDocument,
      consumePendingMarkdown: parentContext.consumePendingMarkdown,
      isPersisting: parentContext.isPersisting,
    }),
    [parentContext, instanceId]
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInstanceContext(): InstanceContextValue {
  const ctx = useContext(InstanceContext);
  if (!ctx) throw new Error("useInstanceContext must be used within InstanceProvider");
  return ctx;
}
