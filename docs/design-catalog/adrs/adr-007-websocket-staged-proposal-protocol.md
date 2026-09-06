# ADR-007: WebSocket Real-Time Synchronization & Staged Proposal Protocol

## Status

**Accepted**

## Context

When AI agents manipulate the visual knowledge graph (`writeGraph`) or rich-text documents (`editDocument`), updates must appear in the UI with sub-second latency while simultaneously preserving the human user's agency to inspect, accept, or reject the proposed changes. Relying on polling, batch HTTP file overwrites, or uncoordinated mutations caused race conditions, lost user edits, and a lack of visual review mechanisms.

## Decision

We implement a unified **WebSocket Real-Time Synchronization and Staged Proposal Protocol** (`src/main/server/ws/ws-server.ts` and `src/workspace/sync/SyncClient.ts`):

1. **Dynamic Per-Window WebSocket Server**: An in-process `ws` server runs on dynamic port `:wsPort`, multiplexing instances over scoped URLs (`/ws/canvas/:instanceId`, `/ws/editor/:instanceId`, `/ws/instances`).
2. **Client Identity & Echo Suppression**:
   - UI clients connect with `clientId: 'ui-<uuid>'`.
   - Agent tool runners connect via ephemeral `SyncClient` with `clientId: 'client-<uuid>'`.
   - The server broadcasts commands to peer sockets while excluding the originating sender (`exclude: ws`).
3. **Thread-Partitioned Staged Proposal Protocol (`staged: true`)**:
   - When an agent emits commands, it tags them with `staged: true`, `threadId`, and `baseVersion`.
   - The server applies the command to its fast in-memory DTO, captures the prior state (`previousState`), and buffers the operation inside a thread-segregated proposal map: `proposals: Map<instanceId, Map<threadId, Command[]>>` (see [ADR-009](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-009-multi-chat-concurrency-and-workspace-synchronization.md)).
   - The server broadcasts `{ type: 'sync-changes', instanceId, threadId, commands: bufferedProposals }` to trigger the **Proposal Banner** in the targeted chat thread's UI.
4. **Thread-Scoped Human Review Resolution**:
   - **Accept (`accept-changes`)**: Clears the proposal buffer for the targeted `threadId` (or all if omitted); changes remain committed in memory and are written to disk via 500ms `debouncedSave`.
   - **Reject (`reject-changes`)**: The server traverses the buffered commands for the specified `threadId` in reverse (`[...threadProposals].reverse()`), re-applies the captured `previousState` slices to restore the prior DTO, broadcasts the recovered snapshot (`sync-snapshot`), and persists the reverted state.
5. **Sequence Numbering, OCC & Persistence Ledger**:
   - The server assigns monotonic sequence numbers (`nextSeq`) to every command, returns `{ type: 'sync-ack', version: nextSeq }` to the sender, and appends the command record to `/api/checkpoints/workspace/logs`.
   - Before applying mutative commands, the server enforces Optimistic Concurrency Control (OCC) by validating `baseVersion >= currentSeq`, rejecting stale commands with `WORKSPACE_STALE_BASE_VERSION`.

## Consequences

### Positive

- Real-time reactivity: UI canvas immediately reflects agent-created nodes and layout adjustments.
- Non-destructive AI modifications: Users can undo complex multi-node graph transformations with one click without reloading from disk.
- Complete auditability: Every command execution is timestamped and recorded in the workspace transaction log.
- Multi-Agent Concurrency: Staged proposals from concurrent agents on different chat threads do not collide or overwrite one another.

### Negative / Trade-offs

- Requires keeping an in-memory DTO cache (`docs` map) on the WebSocket server synchronized with the underlying Express storage daemon.
- Staged proposals for abandoned agent threads persist in memory until explicitly resolved or the instance is closed.

## Compliance

Verified via `src/main/server/ws/ws-server.ts`, `src/workspace/sync/SyncClient.ts`, `src/workspace/wstools/manageGraph.ts`, and `src/workspace/wstools/manageDocument.ts`. See also [ADR-009](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-009-multi-chat-concurrency-and-workspace-synchronization.md).
