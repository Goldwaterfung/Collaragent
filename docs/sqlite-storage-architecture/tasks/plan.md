# Implementation Plan: V4 Embedded SQLite Data Storage Architecture

## 1. Overview

Transition CollarAgent from the legacy V3 sharded ZIP archive architecture to an embedded SQLite database in Write-Ahead Logging (WAL) mode serving directly as the native `.cagent` file. This eliminates $O(N)$ linear checkpoint scans, removes the 2–15s window shutdown zlib compression hang, lazily loads document/canvas payloads (<25MB heap), and provides full ACID crash durability with automated non-destructive migration.

Specification reference: [`docs/sqlite-storage-architecture/spec.md`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md).

---

## 2. Architecture Decisions & Invariants

- **In-Process Engine Confinement:** SQLite runs directly in the Electron `utilityProcess` ([`src/main/server/fileServer/process.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/process.ts)) using `better-sqlite3`. No background daemons or external servers are introduced.
- **Strict Single-Writer Concurrency:** Concurrency is guarded by `<path>.cagent.lock` with `{ pid, timestamp, host }`. Stale locks from dead PIDs are auto-recovered; active PID collisions prompt for Read-Only vs. Force Takeover.
- **Zero Protocol Breakage & Wire Contract Parity:** All storage access routes through existing loopback HTTP endpoints in [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts). Responses strictly adhere to existing Zod contracts (`ListInstancesResponseSchema`, `GetInstanceByIdSchema`). The WebSocket sync hub ([`ws-server.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/ws-server.ts)) and React 19 Frontend Renderer remain completely unmodified.
- **Decoupled Interface Contracts (Boundary B):** Operations are governed by strict TypeScript interfaces ([`IStorageEngine`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L277) and [`ICheckpointStore`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L308)), preventing tight coupling between Express route handlers and `better-sqlite3` native calls, enabling in-memory unit testing.
- **Standardized Error Wire Contract & Boundary Validation (Boundary A):** All 33 endpoints in `filesystemAPI.ts` validate incoming parameters with Zod and emit standardized error responses (`{ error: { code, message, subsystem: "STORAGE", details? } }`), eliminating leaked legacy database error codes (e.g. PostgreSQL `"23505"`).
- **Resolution of `content` vs. `payload` Wire Ambiguity:** Wire responses canonically return `payload` to satisfy `GetInstanceByIdSchema`, while internal storage uses `content_msgpack BLOB`.
- **Bounded Query Pagination:** High-cardinality endpoints (`/api/chat/sessions/:id/messages` and `/api/checkpoints/workspace/logs/:instanceId`) support `?limit=N&before=cursor` to eliminate V8 event loop freezes on large histories.
- **Fail-Closed Automated Migration:** Legacy V2/V3 archives are detected via magic-byte inspection (`PK\x03\x04`), backed up to `<filename>.cagent.v3.bak`, ingested into `<filename>.cagent.tmp`, and verified via `PRAGMA integrity_check` and `PRAGMA foreign_key_check` before atomic cutover.
- **Compaction & Retention:** `langgraph_writes` older than the last 3 completed turns are pruned upon turn completion. `PRAGMA incremental_vacuum(500);` runs during window close (`prepare-close`) immediately preceding `PRAGMA wal_checkpoint(TRUNCATE);`.
- **Large Tool Output Confinement (ADR-006):** Evicted tool outputs (>20k tokens / ~80KB) are stored inside the `large_tool_outputs` table within the same `.cagent` SQLite file.
- **Strict Layer Confinement (Section 6.5):** Code changes are strictly confined to `src/main/server/fileServer/` and root dependencies (`package.json`). Subsystems `src/renderer/`, `src/main/server/ws/`, `src/workspace/`, `src/collaragent/`, `src/preload/`, and `src/shared/` **MUST NOT** be edited.

---

## 3. Component Dependency Graph

```
Phase 1: Foundation & Interface Contracts
├── Dependencies: better-sqlite3 & native rebuild
├── Centralized Errors & Constants (StorageErrors.ts, sqliteConfig.ts)
├── Storage & Checkpoint Interfaces (IStorageEngine.ts, ICheckpointStore.ts)
└── Database Connection & Migration DDL (SqliteDatabase.ts, 001_v4_init.sql)
        │
        ├── Phase 2: LangGraph Runtime Layer
        │   └── SqliteCheckpointStore.ts (implements ICheckpointStore: checkpoints, blobs, writes, heads, large_tool_outputs)
        │
        ├── Phase 3: Project & Instance Storage Engine
        │   ├── ProjectLockManager.ts (single-writer & conflict handling)
        │   └── SqliteStorageEngine.ts (implements IStorageEngine: lazy BLOBs, chat cascade, snapshots, idle/shutdown hooks)
        │
        └── Phase 4: Migration Engine
            └── StorageMigrationEngine.ts (header sniffing, backup, ETL, progress IPC, cutover)
                    │
                    └── Phase 5: Integration & Process Wiring
                        ├── filesystemAPI.ts (REST routing, Zod boundary validation, standardized errors, pagination)
                        ├── process.ts (UtilityProcess lifecycle)
                        └── End-to-End Performance & Contract Benchmarks
```

---

## 4. Phase Breakdown & Verification Checkpoints

### Phase 1: Foundation & Database Engine Core

Foundational dependency setup, centralized error codes extending `CollarError`, configuration constants, TypeScript interface contracts, DDL schema generation, and forward-only migration runner.

- **Task 1.1:** Add `better-sqlite3` and rebuild native bindings for Electron.
- **Task 1.2:** Implement centralized storage error codes (`StorageErrors.ts`), PRAGMA constants (`sqliteConfig.ts`), and decouple storage interface contracts ([`IStorageEngine.ts`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L277) and [`ICheckpointStore.ts`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L308)).
- **Task 1.3:** Create initial DDL migration (`001_v4_init.sql`) and `SqliteDatabase` connection manager with forward-only migration runner (`PRAGMA user_version`).

#### Checkpoint 1: Foundation Verification

- [ ] Native `better-sqlite3` loads cleanly inside Node.js and Electron environments.
- [ ] TypeScript interfaces `IStorageEngine` and `ICheckpointStore` define complete domain boundaries.
- [ ] DDL schema executes with all tables, primary keys, foreign keys, and indexes.
- [ ] PRAGMAs (`WAL`, `NORMAL`, `foreign_keys`, `incremental_vacuum`) verify via `PRAGMA pragma_name;`.
- [ ] `yarn typecheck:node` passes.

---

### Phase 2: LangGraph Execution State Storage

Implements `SqliteCheckpointStore.ts` conforming to [`ICheckpointStore`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L308) to replace [`FileCheckpointStore.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/FileCheckpointStore.ts) with B-Tree indexed reads and writes for LangGraph turns.

- **Task 2.1:** Implement `SqliteCheckpointStore` implementing `ICheckpointStore` for core checkpoint, blob, and restore head queries.
- **Task 2.2:** Implement `langgraph_writes` recording with 3-turn pruning and ADR-006 `large_tool_outputs` storage.
- **Task 2.3:** Wire `SqliteCheckpointStore` to `FileSystemSaver` and test tuple resolution.

#### Checkpoint 2: LangGraph State Verification

- [ ] `getTuple()` resolves latest checkpoint via index in $< 1.5\text{ms}$ across 1,000 checkpoints.
- [ ] Stale task writes older than 3 turns are pruned automatically.
- [ ] Evicted large tool results (>80KB) store in and stream from `large_tool_outputs`.
- [ ] Vitest unit test suite passes: `npx vitest run src/main/server/fileServer/__tests__/SqliteCheckpointStore.test.ts`.

---

### Phase 3: Project, Instance, and Chat Storage Engine

Implements `SqliteStorageEngine.ts` conforming to [`IStorageEngine`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L277) to replace [`CagentStorage.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/storageEngine.ts), providing lazy BLOB loading, granular chat inserts, and shutdown hooks.

- **Task 3.1:** Implement `ProjectLockManager` with PID liveness check and conflict resolution.
- **Task 3.2:** Implement `SqliteStorageEngine` project metadata, lazy MessagePack instance BLOB access, and milestone-driven snapshots.
- **Task 3.3:** Implement granular chat messaging, chat session cascade deletion, and shutdown compaction (`incremental_vacuum(500)` + `wal_checkpoint(TRUNCATE)`).

#### Checkpoint 3: Storage Engine Verification

- [ ] Memory footprint on workspace mount remains $< 25\text{MB}$ (lazy metadata cache).
- [ ] Instance MessagePack payloads stream on demand without eager full-card loads.
- [ ] Deleting a chat session cascades and deletes associated LangGraph checkpoints and blobs.
- [ ] Vitest unit test suite passes: `npx vitest run src/main/server/fileServer/__tests__/SqliteStorageEngine.test.ts`.

---

### Phase 4: Automated ETL Migration Pipeline

Implements `StorageMigrationEngine.ts` to convert legacy V2/V3 archives into V4 SQLite databases with safety backups and validation gates.

- **Task 4.1:** Implement archive header sniffing, `.v3.bak` backup generation, and progress event streaming over IPC.
- **Task 4.2:** Implement ETL stream ingestion into staging database (`<project>.cagent.tmp`) with transactional atomicity.
- **Task 4.3:** Implement validation gates (`PRAGMA integrity_check`, `foreign_key_check`, entity count parity) and atomic cutover / rollback.

#### Checkpoint 4: Migration Pipeline Verification

- [ ] Successfully migrates real-world legacy V2 and V3 fixtures without data loss.
- [ ] Emits real-time progress events over IPC (`onMigrationProgress: { stage, percent }`).
- [ ] Corrupt or invalid archives abort transaction, remove `.tmp`, and leave original file intact.
- [ ] Vitest unit test suite passes: `npx vitest run src/main/server/fileServer/__tests__/StorageMigrationEngine.test.ts`.

---

### Phase 5: Process Lifecycle & Express REST Integration

Hardens [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts) and wires the new SQLite components into `process.ts`, deprecating `ArchiveManager.ts`.

- **Task 5.1:** Update `filesystemAPI.ts` loopback Express routes to interface with `IStorageEngine` and `ICheckpointStore`:
  - Enforce Zod boundary validation on all 33 route parameters, query strings, and request bodies.
  - Standardize error responses to `{ error: { code, message, subsystem: "STORAGE", details? } }` with mapped HTTP status codes (400, 404, 409, 422, 500).
  - Guarantee wire schema parity with `ListInstancesResponseSchema` and `GetInstanceByIdSchema` (canonical `payload` property).
  - Add bounded query pagination (`?limit=50&before=cursor`) on `/api/chat/sessions/:id/messages` and `/api/checkpoints/workspace/logs/:instanceId`.
- **Task 5.2:** Refactor `process.ts` to mount SQLite databases directly and handle `prepare-close` lifecycle without zlib compression.
- **Task 5.3:** Run end-to-end regression tests and performance benchmarks against all NFR budgets and API requirements (`API-REQ-01` through `API-REQ-06`).

#### Checkpoint 5: End-to-End System Verification

- [ ] Cold workspace open completes in $< 15\text{ms}$ ($O(1)$).
- [ ] Window close teardown completes in $< 10\text{ms}$ ($O(1)$).
- [ ] All 33 REST endpoints pass contract tests and validation gates (`API-REQ-01` through `API-REQ-06`).
- [ ] Zero breaking changes observed on WebSocket sync hub or frontend components.
- [ ] `yarn typecheck` and `yarn lint` pass clean across the entire repository.

---

## 5. Risks and Mitigations

| Risk                                             | Impact | Likelihood | Mitigation Strategy                                                                                                                                                                 |
| :----------------------------------------------- | :----- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native ABI mismatch for Electron**             | High   | Medium     | Execute `electron-builder install-app-deps` via `postinstall` script; verify ABI compatibility across macOS, Windows, and Linux.                                                    |
| **Partial write on sudden process kill**         | High   | Low        | SQLite WAL mode (`synchronous = NORMAL`) guarantees page-level crash consistency. Completed turns are committed inside explicit `BEGIN IMMEDIATE ... COMMIT` transactions.          |
| **Legacy migration edge cases (corrupt ZIP)**    | High   | Medium     | Immutable `<filename>.cagent.v3.bak` created upfront; migration executes in temporary `.tmp` database; fail-closed rollback leaves original archive untouched.                      |
| **Lock contention across multi-window launches** | Medium | Low        | `ProjectLockManager` performs dead-process inspection; active process conflicts surface an interactive dialog giving the user the choice between Read-Only mode and Force Takeover. |
