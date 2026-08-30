/**
 * Tracks the "effective current" LangGraph checkpoint for each thread.
 *
 * There are exactly two moments this must be updated:
 *   1. After a checkpoint restore  → setEffective(threadId, restoredCheckpointId)
 *   2. After a stream/invoke turn  → setEffective(threadId, newCheckpointId)
 *
 * And exactly two moments it is read:
 *   A. Before bundle creation      → getEffective(threadId)  [snapshot the right branching point]
 *   B. Before a stream/invoke      → consumeForBranch(threadId)  [pass as checkpoint_id for branching]
 *
 * This replaces the old split between AgentCheckpointRegistry (pending-restore only)
 * and ChatCheckpointSaver.latestCheckpointIds (last-written-to-disk only), both of
 * which were individually stale after a restore.
 */
export class AgentCheckpointRegistry {
  private effectiveByThreadId: Map<string, string> = new Map();
  /**
   * When set, the next stream invocation should branch from this checkpoint_id
   * rather than the latest. This is consumed once and cleared.
   */
  private pendingBranchByThreadId: Map<string, string> = new Map();

  /**
   * Record the effective current checkpoint for a thread.
   * Call this after both restores and successful stream completions.
   */
  setEffective(threadId: string, checkpointId: string): void {
    if (!threadId || !checkpointId) return;
    this.effectiveByThreadId.set(threadId, checkpointId);
  }

  /**
   * Get the effective current checkpoint without side effects.
   * Used by bundle creation to capture the right branching point.
   */
  getEffective(threadId: string): string | undefined {
    return this.effectiveByThreadId.get(threadId);
  }

  /**
   * Mark that the next stream for this thread must branch from the
   * given checkpoint_id instead of continuing from the latest.
   * Called only by restoreCheckpointBundle.
   */
  setPendingBranch(threadId: string, checkpointId: string): void {
    if (!threadId || !checkpointId) return;
    this.pendingBranchByThreadId.set(threadId, checkpointId);
  }

  /**
   * Consume the pending branch checkpoint for a stream invocation.
   * The entry is deleted after reading — it is a one-shot value.
   * Returns undefined if no branch was scheduled (normal continuation).
   */
  consumePendingBranch(threadId: string): string | undefined {
    const id = this.pendingBranchByThreadId.get(threadId);
    if (id) this.pendingBranchByThreadId.delete(threadId);
    return id;
  }



  clear(threadId?: string): void {
    if (threadId) {
      this.effectiveByThreadId.delete(threadId);
      this.pendingBranchByThreadId.delete(threadId);
      return;
    }
    this.effectiveByThreadId.clear();
    this.pendingBranchByThreadId.clear();
  }
}

export const agentCheckpointRegistry = new AgentCheckpointRegistry();
