export type InstanceType = "graph-canvas" | "document";

export type InstanceLogPosition = {
  seq: number;
  at?: string;
};

export type InstanceRestorePoint = {
  instanceId: string;
  instanceType: InstanceType;
  projectId: string;
  snapshotId: string;
  targetCursor: InstanceLogPosition;
  agentSeqs?: number[];
};

export type CheckpointBundle = {
  id: string;
  createdAt: string;
  sessionId: string;
  threadId: string;
  agentCheckpointId?: string;
  chat: {
    messageId?: string;
    blockIndex?: number;
  };
  instances: InstanceRestorePoint[];
  fileRevisionId?: string;
  label?: string;
  reason?: "auto" | "restore";
};

export type FileRevision = {
  id: string;
  createdAt: string;
  reason: "checkpoint" | "autosave";
  baseId?: string;
  snapshotRef?: string;
  deltaRef?: string;
};

export type WorkspaceSnapshot = {
  id: string;
  createdAt: string;
  instanceId: string;
  instanceType: InstanceType;
  projectId: string;
  snapshotRef: string;
  snapshotHash?: string;
  snapshotCursor: InstanceLogPosition;
};

export type CommandPreviousState = {
  node?: Record<string, any>; // For graph:update_node
  layout?: { x: number; y: number; width: number; height: number }; // For graph moves
  removedEntity?: any; // For reconstruct on undo
  removedRelationships?: any[];
  block?: any; // For editor:update_block or editor:remove_block
  index?: number;
  documentPayload?: any; // Fallback for full replacements
};

export type WorkspaceCommandLogEntry = {
  instanceId: string;
  instanceType: InstanceType;
  projectId: string;
  cursor: InstanceLogPosition;
  command?: unknown;
  source?: "ui" | "agent" | "sync";
  previousState?: CommandPreviousState;
};

export type WorkspaceCommandLog = {
  byInstanceId: Record<string, WorkspaceCommandLogEntry[]>;
};
