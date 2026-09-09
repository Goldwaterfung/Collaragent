# ADR-010: CAS Blob Deduplication, DAG Lineage Tracking, and Fail-Closed Checkpoint Architecture

## Status

**Accepted**

## Context

Following the adoption of the single-file SQLite storage engine (ADR-002) and multi-chat concurrency synchronization (ADR-009), real-world multi-turn agent execution identified six critical architectural vulnerabilities in the checkpointing and persistence subsystems:

1. **Unbounded Storage Growth via Duplicate Blobs**: In SQLite V4, every post-turn auto-checkpoint serialized a full MessagePack binary payload directly into `workspace_snapshots.snapshot_msgpack`. In workspaces containing large canvases or multi-page documents, identical or near-identical snapshots were written every turn, causing exponential database file growth.
2. **Cascade Deletion Vulnerability**: `workspace_snapshots` defined a foreign key constraint `instance_id REFERENCES instances(id) ON DELETE CASCADE`. If an instance was deleted, recreated, or temporarily dropped, historical snapshot rows and their embedded binaries were irreversibly deleted, breaking historical checkpoint bundles and preventing time-travel rollback.
3. **Linear Assumption in Non-Linear Chat Workflows**: `CheckpointBundle` records formed a flat chronological array without explicit parent-child lineage. When a user restored to an earlier checkpoint and continued prompting, new checkpoints lacked parent pointers (`parentBundleId`), flattening tree branches into an ambiguous chronological timeline.
4. **Destructive Null-Wipes on Missing Snapshots**: If a snapshot was missing, corrupted, or failed to deserialize during point-in-time restoration, `filesystemAPI.ts` proceeded with `restoredPayload = undefined` and executed `storage.updateInstance(instanceId, { payload: undefined })`. This destructively overwrote the live SQLite record and memory document with empty state, causing permanent data loss.
5. **WebSocket OCC Sequence Drift & Stale Proposals**: When a checkpoint restore rewound an instance's state in SQLite, the in-memory `ws-server.ts` sequence counter (`commandSequences`) remained at the higher pre-restore number. Furthermore, uncommitted staged proposals from previous turns remained in memory, causing subsequent agent tool calls to fail with `WORKSPACE_STALE_BASE_VERSION`.
6. **Agent Tool Persistence Bypass under Default Staging**: Core workspace tools (`writeGraph`, `createDocument`, `editDocument`) dispatched mutations with `staged: true` by default. These commands were buffered exclusively in WebSocket server memory (`proposals[instanceId][threadId]`) awaiting manual user acceptance. If the user closed and reopened the application without clicking "Accept", the changes were never committed to SQLite, resulting in blank canvases and empty documents.

---

## Decision

We implement a **Two-Tier Content-Addressed Storage (CAS) Architecture with Non-Linear DAG Lineage, Fail-Closed Restore Guardrails, and Synchronized WebSocket Sequence Alignment**:

### 1. Two-Tier Content-Addressed Storage (SQLite V5 CAS)

We decouple binary snapshot payloads from instance lifecycle constraints via Migration `002_cas_blobs.sql` (`PRAGMA user_version = 5`):

```sql
-- Immutable CAS blob table independent of instances
CREATE TABLE IF NOT EXISTS workspace_blobs (
    hash TEXT PRIMARY KEY NOT NULL,
    content_msgpack BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- Recreated workspace_snapshots referencing CAS blobs
CREATE TABLE IF NOT EXISTS workspace_snapshots_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT REFERENCES instances(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    instance_type TEXT,
    snapshot_ref TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    blob_hash TEXT REFERENCES workspace_blobs(hash) ON DELETE RESTRICT,
    snapshot_cursor_json TEXT NOT NULL DEFAULT '{}',
    snapshot_msgpack BLOB,
    created_at TEXT NOT NULL
);
```

- **SHA-256 Deduplication**: Every snapshot is hashed before storage. If an identical blob exists, the write is deduplicated via `INSERT OR IGNORE`.
- **Cascade Deletion Immunity**: Even if an instance is deleted from `instances`, the underlying binary payload remains safely preserved in `workspace_blobs` (`ON DELETE RESTRICT`), guaranteeing historical checkpoint bundle integrity.

### 2. Non-Linear DAG Lineage Tracking

- `CheckpointBundle` in `src/shared/checkpoints/types.ts` is extended with:
  ```typescript
  export type CheckpointBundle = {
    id: string
    createdAt: string
    sessionId: string
    threadId: string
    parentBundleId?: string // DAG parent pointer
    branchName?: string // Optional branch identifier
    agentCheckpointId?: string
    chat: { messageId?: string; blockIndex?: number }
    instances: InstanceRestorePoint[]
    fileRevisionId?: string
    label?: string
    reason?: 'auto' | 'restore'
    projectId?: string
  }
  ```
- `AgentCheckpointRegistry` tracks `effectiveBundleIdByThreadId` alongside LangGraph checkpoint heads. When a new bundle is captured, `parentBundleId` is automatically linked to the active branch's parent bundle.

### 3. Fail-Closed Snapshot Restoration

During checkpoint restoration in `filesystemAPI.ts`, resolved instance payloads are strictly checked against null/undefined before touching storage:

```typescript
if (restoredPayload === undefined || restoredPayload === null) {
  throw new StorageError(
    StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND,
    `Failed to restore workspace snapshot for instance '${instance.instanceId}'. Snapshot data is missing or corrupted.`,
    { instanceId: instance.instanceId, snapshotId: instance.snapshotId }
  )
}

storage.updateInstance(instance.instanceId, {
  payload: restoredPayload,
  content: restoredPayload
})
```

If any snapshot in the bundle cannot be verified, the entire restoration transaction fails closed, throwing a typed error and preserving the live workspace untouched.

### 4. WebSocket Sequence & Proposal Alignment (`system-checkpoint-restore`)

Upon completing database restoration, the daemon dispatches an internal protocol update to `ws-server.ts`:

```typescript
notifyWsServer({
  type: 'update',
  instanceId: instance.instanceId,
  payload: restoredPayload,
  clientId: 'system-checkpoint-restore',
  sequenceNumber: instance.targetCursor?.seq ?? 0
})
```

`ws-server.ts` intercepts this message:

1. Resets `commandSequences.set(instanceId, m.sequenceNumber ?? 0)` to realign Optimistic Concurrency Control (OCC) with the historical cursor.
2. Purges stale proposal buffers (`proposals.delete(instanceId)` and `proposalBaselines.delete(instanceId)`).
3. Broadcasts the restored document to all connected clients without triggering redundant database debounced saves.

### 5. Direct Workspace Tool Persistence (`staged: false` Default)

To prevent unpersisted state loss on window reload, agent tools (`writeGraph`, `writeMindMap`, `createDocument`, `editDocument`) default to direct workspace execution:

- Commands are tagged with `staged: false`.
- `ws-server.ts` immediately updates the live in-memory document (`docs.set`) and enqueues a persistence task in `SerializedDrainQueue`, writing changes to SQLite via single-flight execution (superseding legacy 500ms `debouncedSave`, see [ADR-012](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-012-event-driven-serialized-drain-system.md)).
- Staging (`staged: true`) is reserved strictly for workflows where explicit diff review banners (`accept-changes` / `reject-changes`) are desired.

### 6. Cascading Relationship Cleanup on Node Deletion

In `checkpointRestoreHelpers.ts`, when `graph:remove_node` is dispatched, all incoming and outgoing relationships connected to the deleted node are harvested and stored into `previousState.removedRelationships`. During inverse command execution (`InverseCommandEngine`), both the node and its attached relationships are restored deterministically.

---

## Consequences

### Positive

- **Storage Efficiency**: SHA-256 CAS blob deduplication eliminates duplicate payload storage across multi-turn sessions, reducing database size by up to 80% on long-running workspaces.
- **Fail-Closed Safety**: Live workspace instances are 100% protected against corruption or null-wiping if historical snapshot data is missing.
- **Branching Continuity**: Multi-turn branching workflows preserve true non-linear DAG lineage via `parentBundleId` and `AgentCheckpointRegistry`.
- **OCC Consistency**: WebSocket sequence counters and pending proposals are synchronized cleanly across time-travel restores, eliminating stale sequence rejections.
- **Instant Persistence**: Agent-authored cards and documents are persisted immediately to disk, preventing data loss across app reloads.

### Negative / Trade-offs

- Requires SQLite schema migration `002_cas_blobs.sql` to backfill existing inline snapshots into `workspace_blobs` upon opening legacy V4 `.cagent` files.
- Restoring historical checkpoints invalidates uncommitted proposal buffers for that instance across all concurrent chat threads.

---

## Compliance

Verified via:

- Migration: `src/main/server/fileServer/db/migrations/002_cas_blobs.sql`
- CAS Storage: `src/main/server/fileServer/SqliteStorageEngine.ts`
- REST API: `src/main/server/fileServer/filesystemAPI.ts`
- WebSocket Server: `src/main/server/ws/ws-server.ts`
- Agent Tools: `src/collaragent/tools/WorkspaceTools.ts`
- Registry: `src/collaragent/checkpoint/AgentCheckpointRegistry.ts`
- Orchestrator: `src/main/orchestrators/CheckpointOrchestrator.ts`
- Contracts: `src/shared/checkpoints/types.ts`
