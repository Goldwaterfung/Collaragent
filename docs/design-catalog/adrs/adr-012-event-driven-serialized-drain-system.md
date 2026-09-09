# ADR-012: Event-Driven Serialized Drain System Architecture

## Status

**Accepted**

## Context

In CollarAgent's local-first architecture, real-time workspace mutations (Lexical rich-text editor blocks, visual concept canvas DAG commands, and relational knowledge-graph ledger triples) are synchronized via a local WebSocket server (`ws-server.ts`) to an Express 5 utility process backed by SQLite WAL storage and sharded JSON files (`.collar/` workspace).

Historically, persistent I/O was throttled using a naive **temporal debounce** mechanism (`setTimeout(..., 500)`):

1. **Concurrency Violations & SQLite Lock Contention**: If disk write latency exceeded 500ms (due to large document serialization, background virus scanning, or disk load), a subsequent timer fired before the previous HTTP/disk write completed. This resulted in concurrent HTTP `PATCH /api/instances/:id` requests striking the Express utility process, triggering SQLite busy/locked errors and non-deterministic write interleaving.
2. **Stale Reads by Autonomous AI Agents**: When an autonomous agent executed tools (`getDocument`, `listCanvases`, `loadLedger`, or `auditContradictions`) immediately after user keystrokes, the agent tool inspected the filesystem directly (`createFsWikiWorkspaceAdapter`). Because changes were stranded in memory awaiting the 500ms timer, the agent operated on stale, obsolete snapshots, introducing phantom hallucination cycles.
3. **Flaky Test Suites & Violation of Coding Rules**: Test suites were forced to insert arbitrary `await new Promise(r => setTimeout(r, 600))` calls before asserting disk state, violating Coding Rule 2.1 ("Hardcoded values or parameters are forbidden in this project") and inflating CI pipeline runtimes.
4. **Silent Error Swallowing**: Unhandled promise rejections within detached `setTimeout` callbacks were not propagated back to the mutation caller, leading to silent data loss during system crashes or network dropouts.
5. **Lack of Cancellation Token Integration**: Detached timers could not be bound to `AbortSignal` or session cancellation tokens, preventing deterministic teardown during workspace unloading.

## Decision

We replace all temporal debouncing with an **Event-Driven Serialized Drain System** powered by a single-flight state machine, dirty coalescing, and transactional barrier guarantees:

1. **Strict Single-Flight Serialization (Concurrency = 1)**:
   - For any given `instanceId`, exactly one asynchronous persistence operation (`saveDocumentInstanceToApi`) is executed at any point in time (`activeDrainPromise !== null`).
   - If a new mutation arrives while a write is in-flight, the worker does NOT spawn a new task or start a timer. It transitions to `COALESCING`, marks `isDirty = true`, and updates the latest in-memory pending payload.
   - When the active write resolves, the worker checks `isDirty`. If true, it immediately launches the next single-flight write with the coalesced snapshot without delay.

2. **Deterministic Transactional Barriers (`flush()`)**:
   - The `SerializedDrainQueue.flush(instanceId?: string, options?: FlushOptions)` method registers a deferred barrier promise.
   - The barrier promise resolves ONLY when both the active in-flight write and any pending coalesced writes have settled to disk and the worker transitions to `IDLE`.
   - Autonomous AI tools and test harnesses await `flush(instanceId)` prior to performing disk reads, guaranteeing 100% read-after-write consistency with zero artificial sleep delays.

3. **Zero Hardcoded Timeout Delays**:
   - `saveDebounceTimers` (`Map<string, NodeJS.Timeout>`) and `ledgerSaveDebounceTimer` are completely removed from `src/main/server/ws/ws-server.ts`.
   - When an instance is `IDLE`, an incoming mutation triggers persistence immediately without waiting for a 500ms delay.

4. **Structured Error Taxonomy & Exponential Backoff**:
   - All synchronization and persistence errors are classified under the typed `SyncErrorCode` enum (`SYNC_DRAIN_PERSIST_FAILED`, `SYNC_DRAIN_ABORTED`, `SYNC_DRAIN_BARRIER_TIMEOUT`, `SYNC_DRAIN_QUEUE_DISPOSED`).
   - Transient I/O failures trigger non-blocking event-driven retries calculated by `BackoffPolicyEngine` without blocking the Node.js event loop.
   - If retries are exhausted, waiting barrier promises reject with structured `SyncError` preserving upstream causes.

5. **End-to-End Cancellation Token Propagation (Pattern A)**:
   - All drain operations, barrier registrations, and retry schedules accept an optional `AbortSignal`.
   - Aborted operations reject immediately with `SyncErrorCode.SYNC_DRAIN_ABORTED` and release registered promises cleanly.

## Consequences

### Positive

- **Elimination of SQLite Lock Contention**: Enforcing strict single-flight serialization guarantees that the Express utility process never receives overlapping writes for the same instance.
- **Zero Stale Reads for AI Agents**: AI co-authors await `wsHandle.flush()` before reading files, ensuring all user keystrokes are committed to disk before tool execution begins.
- **100% Deterministic Unit & Integration Testing**: Tests replace arbitrary `sleep(600)` with `await wsHandle.flush()`, eliminating test flakiness and drastically speeding up test suites.
- **Fail-Closed Error Propagation**: Persistence failures reject barrier promises and emit typed telemetry events rather than disappearing into silent timer callbacks.
- **Clean Workspace Teardown**: Closing a workspace awaits `drainQueue.flush()`, guaranteeing that all unpersisted changes are committed to disk before process exit.

### Negative / Trade-offs

- **Memory Buffering Under Sustained High-Frequency Load**: During sustained rapid typing while disk I/O is slow, the pending payload is held in memory until the current write finishes. (Mitigated: only the single latest payload snapshot is retained per instance).
- **Tool Latency Tied to Disk Write**: If an AI agent tool calls `flush()` while a large file write is underway, the tool turn waits for the write to finish before reading. (Mitigated: this ensures consistency; fast local SSD writes typically complete in <15ms).

## Compliance & Verification

- Defined by:
  - `docs/event-driven-system/README.md`
  - `docs/event-driven-system/system-architecture.md`
  - `docs/event-driven-system/event-contracts.md`
  - `docs/event-driven-system/migration-plan.md`
- Implemented and verified by:
  - `src/workspace/sync/drain/SerializedDrainQueue.ts`
  - `src/workspace/sync/drain/InstanceDrainWorker.ts`
  - `src/main/server/ws/ws-server.ts`
  - `src/collaragent/tools/wiki/adapters.ts`
  - Automated test suites: `SerializedDrainQueue.test.ts`, `wsServerPersistence.test.ts`.
