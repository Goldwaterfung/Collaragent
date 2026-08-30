import { randomUUID } from "node:crypto";
import type { CheckpointBundle } from "../../shared/checkpoints/types";
import { CheckpointApiClient } from "@collaragent/checkpoint";
import type { CheckpointBundleStore } from "@collaragent/checkpoint";
import type { PersistenceManager } from "../storage/Persistence";
import { abortAgentStream } from "../handlers/agent";
import { agentCheckpointRegistry } from "@collaragent/checkpoint";

export type CheckpointCaptureOptions = {
  sessionId: string;
  threadId: string;
  projectId: string;
  label?: string;
  reason?: "auto" | "restore";
  includeInstances: "active" | "open" | "all" | string[];
  activeInstanceId?: string;
  openInstanceIds?: string[];
};

export type CheckpointRestoreOptions = {
  sessionId: string;
  threadId: string;
  bundleId: string;
  createAutoCheckpoint?: boolean;
  reason?: "auto" | "restore";
};

export type CheckpointBundleSummary = {
  id: string;
  createdAt: string;
  label?: string;
  reason?: "auto" | "restore";
  threadId: string;
  sessionId: string;
  chatMessageId?: string;
};

export interface CheckpointOrchestrator {
  createCheckpointBundle(options: CheckpointCaptureOptions): Promise<CheckpointBundleSummary>;
  restoreCheckpointBundle(options: CheckpointRestoreOptions): Promise<void>;
  listCheckpointBundles(sessionId: string, threadId: string): Promise<CheckpointBundleSummary[]>;
  cancelActiveOperation(sessionId: string): Promise<void>;
}

export type CheckpointBundleFactory = (input: {
  options: CheckpointCaptureOptions;
  bundleId: string;
  createdAt: string;
  agentCheckpointId?: string;
}) => Promise<CheckpointBundle>;

export class CheckpointOrchestratorImpl implements CheckpointOrchestrator {
  private bundleStore: CheckpointBundleStore;
  private bundleFactory: CheckpointBundleFactory;
  private apiClient: CheckpointApiClient;

  constructor(params: {
    apiPort?: number;
    persistenceManager?: PersistenceManager;
    bundleStore: CheckpointBundleStore;
    bundleFactory: CheckpointBundleFactory;
    apiClient: CheckpointApiClient;
  }) {
    this.bundleStore = params.bundleStore;
    this.bundleFactory = params.bundleFactory;
    this.apiClient = params.apiClient;
  }

  async createCheckpointBundle(options: CheckpointCaptureOptions): Promise<CheckpointBundleSummary> {
    // The registry is the authority for the effective checkpoint. It is kept
    // current by both restoreCheckpointBundle (on restore) and streamAgentResponse
    // (on successful turn completion).
    const agentCheckpointId = agentCheckpointRegistry.getEffective(options.threadId);

    const createdAt = new Date().toISOString();
    const bundleId = randomUUID();
    const bundle = await this.bundleFactory({
      options,
      bundleId,
      createdAt,
      agentCheckpointId,
    });

    const persisted = await this.bundleStore.createBundle(bundle);
    return {
      id: persisted.id,
      createdAt: persisted.createdAt,
      label: persisted.label,
      reason: persisted.reason,
      threadId: persisted.threadId,
      sessionId: persisted.sessionId,
      chatMessageId: persisted.chat?.messageId,
    };
  }

  async restoreCheckpointBundle(options: CheckpointRestoreOptions): Promise<void> {
    const bundle = await this.bundleStore.getBundle(options.bundleId);
    if (!bundle) {
      throw new Error(`Checkpoint bundle not found: ${options.bundleId}`);
    }

    if (bundle.sessionId !== options.sessionId || bundle.threadId !== options.threadId) {
      throw new Error("Checkpoint bundle does not match the active session/thread.");
    }

    abortAgentStream(options.threadId);

    if (options.createAutoCheckpoint && bundle.instances.length > 0) {
      const projectId = bundle.instances[0].projectId;
      await this.createCheckpointBundle({
        sessionId: options.sessionId,
        threadId: options.threadId,
        projectId,
        includeInstances: bundle.instances.map((instance) => instance.instanceId),
        reason: "restore",
        label: "Auto before restore",
      });
    }

    await this.apiClient.restoreCheckpointBundle(options.bundleId, {
      sessionId: options.sessionId,
      threadId: options.threadId,
    });

    if (bundle.agentCheckpointId) {
      // Tell the registry two things:
      // 1. The next stream must branch from this specific checkpoint (one-shot).
      // 2. This is now the effective current state for bundle creation.
      agentCheckpointRegistry.setPendingBranch(options.threadId, bundle.agentCheckpointId);
      agentCheckpointRegistry.setEffective(options.threadId, bundle.agentCheckpointId);
    }
  }

  async listCheckpointBundles(sessionId: string, threadId: string): Promise<CheckpointBundleSummary[]> {
    const bundles = await this.bundleStore.listBundles(sessionId, threadId);
    return bundles.map((bundle) => ({
      id: bundle.id,
      createdAt: bundle.createdAt,
      label: bundle.label,
      reason: bundle.reason,
      threadId: bundle.threadId,
      sessionId: bundle.sessionId,
      chatMessageId: bundle.chat?.messageId,
    }));
  }

  async cancelActiveOperation(_sessionId: string): Promise<void> {
    agentCheckpointRegistry.clear();
  }
}

