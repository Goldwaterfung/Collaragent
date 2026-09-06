# ADR-009: Multi-Chat Concurrent Execution & Workspace Synchronization Architecture

## Status

**Accepted**

## Context

Upgrading the CollarAgent UI layout to support multi-chat Dockview panes (allowing knowledge workers to engage multiple autonomous agents simultaneously in parallel conversations) exposed several structural concurrency failures in the real-time synchronization and checkpointing subsystems:

1. **Unhandled Fiber Unmount Rejections**: When Dockview tabs or split panels unmounted, `SyncClient.disconnect()` rejected its internal `readyPromise` and drained pending ack promises. Because `waitForReady()` was not explicitly awaited by unmounting components, Chromium raised unhandled promise rejection exceptions (`Uncaught (in promise) Error: SyncClient disconnected`), crashing the renderer process.
2. **Global Checkpoint Quiesce Contention**: On completion of an agent turn, `CHECKPOINT_CREATE` emitted a window-wide `CHECKPOINT_QUIESCE` IPC event, toggling global `paused = true` in `syncPause.ts`. This halted WebSocket command ingestion across the entire window, dropping in-flight edits submitted by concurrent agents running in adjacent panes.
3. **Monolithic Proposal Buffer Collision**: `ws-server.ts` stored staged proposals in a single flat map keyed solely by `instanceId` (`proposals: Map<string, Command[]>`). When two agents concurrently proposed modifications to the same document or canvas, their operations were interleaved into a single array, corrupting diff calculations and preventing granular accept or reject actions.
4. **Positional Diff Divergence (Lack of OCC)**: ReAct agent tools (`manageDocument`, `manageGraph`) read instance snapshots without sequence locking. If multiple agents mutated an instance simultaneously, positional commands (such as `insert_block` or `update_block`) applied against divergent baseline states, leading to index drift and corrupt Lexical document ASTs.
5. **Transient Dockview Tab Drops**: Dockview's `onDidActivePanelChange` event fired with `e?.panel === undefined` during split divider dragging and group rebalancing. This triggered `unsetInstanceId()`, unmounting active document and canvas editors during normal UI layout manipulation.

## Decision

We implement a comprehensive **Multi-Chat Concurrent Execution and Workspace Synchronization Architecture**:

1. **Thread-Partitioned Staging Buffer**:
   - In `src/main/server/ws/ws-server.ts`, refactor the staging buffer to a nested two-tier map:
     ```typescript
     // instanceId -> threadId -> StagedCommand[]
     const proposals = new Map<string, Map<string, Command[]>>()
     ```
   - All `sync-command` payloads with `staged: true` must be accompanied by the originating `threadId`.
   - Broadcast `sync-changes` events include `threadId` metadata, allowing each chat dock to render its own dedicated proposal review banner.

2. **Thread-Scoped Human Review Protocol**:
   - `accept-changes` and `reject-changes` WebSocket messages accept an optional `threadId`.
   - When a user accepts or rejects proposals, only the commands belonging to the targeted thread are committed or reverted. Other threads' pending proposals remain intact in the buffer.

3. **Optimistic Concurrency Control (OCC)**:
   - `SyncClient` tracks `serverVersion` across `sync-snapshot`, `sync-command`, and `sync-ack` messages, exposing `getServerVersion(): number | null`.
   - Agent tools capture `baseVersion = client.getServerVersion()` upon reading the instance snapshot and submit it with subsequent mutation batches.
   - `ws-server.ts` validates incoming mutations against the instance sequence counter (`currentSeq`):
     ```typescript
     if (baseVersion !== undefined && baseVersion < currentSeq) {
       ws.send(
         JSON.stringify({
           type: 'error',
           code: 'WORKSPACE_STALE_BASE_VERSION',
           message: `Base version ${baseVersion} is stale. Current instance sequence is ${currentSeq}.`
         })
       )
       return
     }
     ```

4. **Decoupled Turn Checkpoints (No Global Quiesce)**:
   - Routine turn auto-checkpoints (`CHECKPOINT_CREATE`) no longer broadcast `CHECKPOINT_QUIESCE` / `CHECKPOINT_RESUME` across the window.
   - Main host persists dirty WebSocket state directly by invoking `await record.wsHandle.flush()` before writing the checkpoint bundle to SQLite.
   - Window-wide quiescing is preserved strictly for destructive state rewinds (`CHECKPOINT_RESTORE`).

5. **Resilient `SyncClient` Promise Lifecycle**:
   - `readyPromise` is instantiated immediately in the `SyncClient` constructor with a registered no-op rejection handler (`this.readyPromise.catch(() => {})`).
   - Sockets detached during React component unmounting can safely reject without triggering unhandled promise rejection errors in Chromium or Node.js.
   - Pending ack promises are drained cleanly with `WORKSPACE_SYNC_DISCONNECTED` errors.

6. **Thread Lineage Propagation via LangGraph Runtime**:
   - `src/main/handlers/streaming.ts` passes `thread_id` into LangGraph's `configurable` execution context.
   - `src/collaragent/tools/WorkspaceTools.ts` reads `config.configurable.thread_id` and injects it into `executeWriteDocument`, `executeDocumentCommands`, and `executeWriteGraph`.
   - `Chat.tsx` routes `onStreamError` events directly to `data.threadId` in `useChatStore`, preventing error alerts from leaking into unrelated active tabs.

## Consequences

### Positive

- **True Parallel Multi-Agent Execution**: Users can run arbitrary concurrent ReAct agents in split panes without race conditions, state cross-talk, or dropped frames.
- **Independent Staging Reviews**: Staged proposals from different agents targeting the same document can be accepted or rejected independently.
- **Fail-Fast Structural Integrity**: OCC eliminates silent overwrite bugs and corrupted document block indexes.
- **Zero Unmount Crashes**: Resilient promise handling ensures dynamic Dockview panel tiling and tab switching never crashes the app.

### Negative / Trade-offs

- **Fail-Fast OCC Rejections**: If two agents execute unstaged, direct mutations against the exact same document at the same instant, the lagging write is rejected with `WORKSPACE_STALE_BASE_VERSION`, requiring the agent to re-read the snapshot and re-compute its diff.
- **In-Memory Buffer Retention**: Staged proposals for a thread remain in memory until accepted, rejected, or when the instance is closed.

## Compliance

- Verified by:
  - `src/main/server/ws/ws-server.ts`
  - `src/workspace/sync/SyncClient.ts`
  - `src/workspace/wstools/manageDocument.ts`
  - `src/workspace/wstools/manageGraph.ts`
  - `src/collaragent/tools/WorkspaceTools.ts`
  - `src/main/handlers/checkpoints.ts`
  - Automated test suites: `documentPayloadPipeline.test.ts`, `manageGraph.test.ts`, `subagent_stream_isolation.test.ts`.
