import { z } from "zod";

export const InstanceTypeSchema = z.enum(["graph-canvas", "document"]);

export const InstanceLogPositionSchema = z.object({
  seq: z.number().int().nonnegative(),
  at: z.string().optional(),
});

export const InstanceRestorePointSchema = z.object({
  instanceId: z.string().min(1),
  instanceType: InstanceTypeSchema,
  projectId: z.string().min(1),
  snapshotId: z.string().min(1),
  targetCursor: InstanceLogPositionSchema,
  agentSeqs: z.array(z.number()).optional(),
});

export const CheckpointBundleSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  agentCheckpointId: z.string().min(1).optional(),
  chat: z.object({
    messageId: z.string().min(1).optional(),
    blockIndex: z.number().int().nonnegative().optional(),
  }),
  instances: z.array(InstanceRestorePointSchema),
  fileRevisionId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  reason: z.enum(["auto", "restore"]).optional(),
});

export const FileRevisionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.enum(["checkpoint", "autosave"]),
  baseId: z.string().min(1).optional(),
  snapshotRef: z.string().min(1).optional(),
  deltaRef: z.string().min(1).optional(),
});

export const WorkspaceSnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  instanceId: z.string().min(1),
  instanceType: InstanceTypeSchema,
  projectId: z.string().min(1),
  snapshotRef: z.string().min(1),
  snapshotHash: z.string().min(1).optional(),
  snapshotCursor: InstanceLogPositionSchema,
});

export const WorkspaceCommandLogEntrySchema = z.object({
  instanceId: z.string().min(1),
  instanceType: InstanceTypeSchema,
  projectId: z.string().min(1),
  cursor: InstanceLogPositionSchema,
  command: z.unknown(),
  source: z.enum(["ui", "agent", "sync"]).optional(),
  previousState: z.any().optional(),
});

export const WorkspaceCommandLogSchema = z.object({
  byInstanceId: z.record(z.string(), z.array(WorkspaceCommandLogEntrySchema)),
});

export type InstanceType = z.infer<typeof InstanceTypeSchema>;
export type InstanceLogPosition = z.infer<typeof InstanceLogPositionSchema>;
export type InstanceRestorePoint = z.infer<typeof InstanceRestorePointSchema>;
export type CheckpointBundle = z.infer<typeof CheckpointBundleSchema>;
export type FileRevision = z.infer<typeof FileRevisionSchema>;
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;
export type WorkspaceCommandLogEntry = z.infer<typeof WorkspaceCommandLogEntrySchema>;
export type WorkspaceCommandLog = z.infer<typeof WorkspaceCommandLogSchema>;
