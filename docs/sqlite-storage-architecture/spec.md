# Spec: V4 Embedded SQLite Data Storage Architecture

## 1. Assumptions

```
ASSUMPTIONS I'M MAKING:
1. Target Database Library: `better-sqlite3` native C++ bindings executed within the Electron utilityProcess (`src/main/server/fileServer/process.ts`).
2. Concurrency Model: Single serialized writer per project (enforced by `<path>.cagent.lock`) with non-blocking concurrent readers via SQLite WAL mode.
3. Wire Protocol Neutrality: Zero breaking changes to the HTTP REST contract in `filesystemAPI.ts`, the WebSocket relay in `ws-server.ts`, and the React 19 Frontend Renderer.
4. Legacy Support: Existing V2 monolithic JSON and V3 sharded ZIP archives are automatically migrated upon project open with an immutable `.v3.bak` safety copy.
→ Correct me now or I'll proceed with these.
```

---

## 2. Objective

Transition CollarAgent's project storage from a sharded ZIP archive extracted into a live directory (`<project>.collar/`) to a **native, single-file embedded SQLite database (WAL mode)** that acts directly as the `.cagent` project container.

### Problem Addressed

- Linear $O(N)$ directory scan and file parsing on every LangGraph checkpoint read ([`FileSystemSaver.getTuple()`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/FileSystemSaver.ts#L35) $\rightarrow$ [`FileCheckpointStore.getCheckpoints()`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/FileCheckpointStore.ts#L69)).
- Multi-second UI freeze (2–15s) at window shutdown caused by synchronous zlib directory compression ([`ArchiveManager.commit()`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/ArchiveManager.ts#L80)).
- Eager V8 heap consumption caused by loading all instance payloads into RAM on project mount ([`CagentStorage.load()`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/storageEngine.ts#L363)).
- Monolithic serialization of all chat history and command logs on every minor update (`state.json` via [`CagentStorage.save()`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/storageEngine.ts#L699)).
- Absence of ACID multi-file transactional atomicity during agent turns.

### Target Persona & User Impact

- **End User / Researcher:** Instant project startup (<15ms) and shutdown (<10ms); resilient against app crashes; easy file sharing of compact `.cagent` files without LLM trace bloat.
- **Autonomous Agent Co-Pilot:** Sub-millisecond LangGraph state transitions (<1.5ms checkpoint resolution) across hundreds of recursive turns.

---

## 3. Tech Stack

| Component             | Technology                      | Role / Justification                                                                 |
| :-------------------- | :------------------------------ | :----------------------------------------------------------------------------------- |
| **Engine Runtime**    | Electron 43 `utilityProcess`    | Isolated background Node.js process owning file I/O and SQLite handles.              |
| **Database Library**  | `better-sqlite3` (~11.8.x)      | Synchronous, high-throughput, native C++ SQLite bindings with direct buffer support. |
| **Serialization**     | `msgpackr` / `msgpackr-extract` | High-efficiency binary encoding for Lexical editor trees and Canvas DTOs.            |
| **Schema Validation** | `zod` 4.x                       | Strict boundary validation for all REST payloads and database entity decoders.       |
| **Type Checking**     | TypeScript 5.8+                 | Strict null checks, zero-`any` policy, branded IDs.                                  |

---

## 4. Commands

```bash
# Install dependencies and rebuild native C++ bindings for Electron
yarn install

# Run TypeScript quality gate across Node.js runtime and Web renderer
yarn typecheck:node
yarn typecheck:web
yarn typecheck

# Lint and verify code hygiene
yarn lint

# Format code with Prettier
yarn format:check
yarn format

# Execute storage engine unit and integration test suite
npx vitest run src/main/server/fileServer/__tests__/SqliteStorageEngine.test.ts
npx vitest run src/main/server/fileServer/__tests__/SqliteCheckpointStore.test.ts
npx vitest run src/main/server/fileServer/__tests__/StorageMigrationEngine.test.ts

# Dev environment launch
yarn dev
```

---

## 5. Project Structure

```
docs/sqlite-storage-architecture/
├── README.md                               # Architecture overview and navigation hub
├── spec.md                                 # This hard requirements specification
├── requirements.md                         # FRs, NFRs, and system invariants
├── current-zip-storage-problems.md          # Root-cause analysis of current ZIP bottlenecks
├── storage-engine-design.md                 # DDL, ERD, indexes, PRAGMA, and query patterns
├── migration-plan.md                       # 4-phase ETL pipeline and validation gates
└── adrs/
    └── adr-001-sqlite-embedded-project-storage.md # ADR for SQLite project container

src/main/server/fileServer/
├── process.ts                              # UtilityProcess entry point (forked per project)
├── filesystemAPI.ts                        # Loopback Express REST router
├── SqliteStorageEngine.ts                  # V4 Storage Engine (replaces CagentStorage)
├── SqliteCheckpointStore.ts                # V4 LangGraph Checkpoint Store (replaces FileCheckpointStore)
├── StorageMigrationEngine.ts               # Automated ETL migrator (V2/V3 -> V4)
├── errors/
│   └── StorageErrors.ts                    # Centralized typed error codes and CollarError subclasses
└── __tests__/
    ├── SqliteStorageEngine.test.ts         # Project, instance, chat, and command log tests
    ├── SqliteCheckpointStore.test.ts       # Checkpoint, blob, write, and restore head tests
    └── StorageMigrationEngine.test.ts      # V2/V3 extraction, validation, and rollback tests
```

---

## 6. Hard Requirements Specification

### 6.1 Functional Hard Requirements (FR)

- [ ] **HR-FR-01 (Single-File SQLite Container):**
      The `.cagent` file MUST be a valid, standalone SQLite 3 database operating with WAL mode enabled. No extracted working directory (`<project>.collar/`) shall be created or left on disk.
- [ ] **HR-FR-02 (Unified Entity Schema):**
      The database MUST store the following entities across relational tables with strict foreign keys:
  - `projects`: Root project metadata and settings.
  - `instances`: Canvas cards and Lexical documents (`content_msgpack BLOB` column).
  - `chat_sessions` & `chat_messages`: Granular per-message rows.
  - `langgraph_checkpoints`: Checkpoint state keyed by `(thread_id, checkpoint_ns, checkpoint_id)`.
  - `langgraph_blobs`: Channel version payloads keyed by `(thread_id, checkpoint_ns, channel, version)`.
  - `langgraph_writes`: Task writes keyed by `(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)`.
  - `langgraph_restore_heads`: Restore head pointers keyed by `(thread_id, checkpoint_ns)`.
  - `workspace_snapshots`, `workspace_command_logs`, `file_revisions`: Time travel, undo/redo, and revision snapshots.
- [ ] **HR-FR-03 (Lazy Payload Loading):**
      `GET /api/instances` MUST query only metadata columns (`id, name, type, updated_at`). Heavy content in `content_msgpack BLOB` MUST only be loaded when `GET /api/instances/:id` is invoked for an active tab.
- [ ] **HR-FR-04 (Automated Non-Destructive Migration & Progress Streaming):**
      The engine MUST detect file format via magic-byte inspection at offset 0:
  - `"SQLite format 3\0"` $\rightarrow$ Open native SQLite connection directly.
  - `"PK\x03\x04"` $\rightarrow$ Trigger `StorageMigrationEngine`:
    1. Create immutable backup: `<filename>.cagent.v3.bak` kept indefinitely in the project directory until manually deleted by the user.
    2. Stream real-time progress events over IPC (`onMigrationProgress: { stage: string, percent: number }`) to render an informative progress bar in the UI.
    3. Extract and ingest all data inside a staging SQLite file `<filename>.cagent.tmp` wrapped in `BEGIN IMMEDIATE ... COMMIT`.
    4. Run verification gates (`PRAGMA integrity_check;`, `PRAGMA foreign_key_check;`, record parity).
    5. Atomically rename `<filename>.cagent.tmp` over `<filename>.cagent`.
    6. On any error, fail closed, discard `.tmp`, and leave the original file untouched.
- [ ] **HR-FR-05 (Compaction & Hybrid WAL Checkpointing):**
  - **Pruning:** Intermediate transient task writes (`langgraph_writes`) older than the last 3 completed turns MUST be pruned automatically upon turn completion.
  - **Runtime WAL:** Rely on SQLite's default `wal_autocheckpoint(1000)` during active turns, and trigger a non-blocking passive checkpoint (`PRAGMA wal_checkpoint(PASSIVE);`) after 30 seconds of idle inactivity.
  - **Shutdown Hook:** `PRAGMA incremental_vacuum(500);` followed by `PRAGMA wal_checkpoint(TRUNCATE);` MUST execute during the window close hook (`prepare-close`), folding the journal into the primary database file and releasing unused pages.
- [ ] **HR-FR-06 (Format Singularity for Sharing):**
      The `.cagent` SQLite database file itself is the sole native project format and container. External sharing of research content is handled exclusively via existing single-document exports (DOCX, Markdown, PDF) without introducing auxiliary project ZIP export pipelines.
- [ ] **HR-FR-07 (Milestone-Driven Snapshots & Live Edits):**
  - Live document and canvas edits MUST update `instances.content_msgpack` atomically on each debounced flush (`HTTP PATCH /api/instances/:id`).
  - Entries in `workspace_snapshots` MUST only be recorded on explicit user checkpoints, tab switches, or named milestone events, avoiding continuous snapshot generation on micro-edits.
- [ ] **HR-FR-08 (Session Cascade Deletion):**
      Deleting a chat session in the UI MUST cascade and atomically remove all associated `chat_messages`, as well as corresponding thread lineage records in `langgraph_checkpoints`, `langgraph_writes`, `langgraph_blobs`, and `langgraph_restore_heads`.
- [ ] **HR-FR-09 (Ephemeral Telemetry Policy):**
      Agent execution traces and token metrics MUST remain in-memory and ephemeral. No local telemetry tables shall be persisted to `.cagent` unless Langfuse telemetry is explicitly enabled by the user.
- [ ] **HR-FR-10 (ADR-006 Large Tool Output Confinement):**
      Tool outputs exceeding 20k tokens (~80KB) evicted under ADR-006 MUST be stored inside a dedicated `large_tool_outputs` table (`id TEXT PRIMARY KEY, session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE, content_blob BLOB NOT NULL, byte_size INTEGER NOT NULL, created_at INTEGER NOT NULL`) directly within the `.cagent` SQLite database, ensuring strict single-file containment.
- [ ] **HR-FR-11 (Linear Forward-Only Schema Evolution):**
      Future schema updates beyond V4 MUST be executed via forward-only DDL migration scripts keyed by `PRAGMA user_version`. Migrations MUST run sequentially inside an atomic transaction on startup before initializing application queries.

---

### 6.2 Non-Functional Requirements & Performance Budgets (NFR)

| Requirement ID | Operation / Scenario                              | Hard Budget                         | Verification Method                      |
| :------------- | :------------------------------------------------ | :---------------------------------- | :--------------------------------------- |
| **HR-NFR-01**  | Cold Workspace Open (1,000 checkpoints, 50 cards) | **$< 15\text{ms}$** ($O(1)$)        | High-resolution startup timer            |
| **HR-NFR-02**  | Window Close / Shutdown (`prepare-close`)         | **$< 10\text{ms}$** ($O(1)$)        | Process teardown audit                   |
| **HR-NFR-03**  | LangGraph Checkpoint Resolution (`getTuple`)      | **$< 1.5\text{ms}$** ($O(\log N)$)  | Vitest benchmark across 1,000 turns      |
| **HR-NFR-04**  | LangGraph Checkpoint Append (`put`)               | **$< 3\text{ms}$** (Sequential WAL) | Turn throughput benchmark                |
| **HR-NFR-05**  | Instance Content Read (10 MB Canvas / Doc)        | **$< 8\text{ms}$** (BLOB streaming) | Virtualized tab switch test              |
| **HR-NFR-06**  | Heap Memory on Project Mount                      | **$< 25\text{MB}$** (Lazy cache)    | Node.js `process.memoryUsage().heapUsed` |
| **HR-NFR-07**  | Migration Throughput (V3 $\rightarrow$ V4)        | **$> 10\text{MB/s}$**               | Migration suite on 100MB legacy archive  |

---

### 6.3 System Invariants (INV)

- [ ] **HR-INV-01 (In-Process Confinement):**
      The SQLite engine MUST run in-process within the Electron `utilityProcess`. No external database daemons or network listeners (beyond the local loopback Express port `:0`) are permitted.
- [ ] **HR-INV-02 (Single-Writer Lock Confinement & Conflict Resolution):**
      Only one `utilityProcess` may hold write access. A companion file lock (`<path>.cagent.lock`) containing `{ pid, timestamp, host }` MUST be acquired before write operations.
  - **Dead PID Recovery:** If a lock exists but the recording PID is no longer alive, the engine MUST auto-recover and acquire the lock.
  - **Active Process Conflict:** If the PID is actively running, the engine MUST display an interactive modal permitting the user to choose between **Read-Only Mode** or **Force Takeover**.
- [ ] **HR-INV-03 (Agent Turn Atomicity):**
      Every completed LangGraph agent turn MUST commit its chat message, checkpoint tuple, and channel version blobs within a single atomic SQLite transaction (`BEGIN IMMEDIATE ... COMMIT`). Partial turn states MUST NEVER be committed to disk.
- [ ] **HR-INV-04 (Zero Protocol Breakage):**
      The engine MUST interface exclusively via the existing REST API routes in [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts). No breaking changes to [`ws-server.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/ws-server.ts) or the React 19 Frontend Renderer.
- [ ] **HR-INV-05 (Fail-Closed Data Preservation):**
      Under no circumstances may a legacy `.cagent` file be altered or deleted until migration passes all validation gates with zero foreign key violations and identical entity counts.
- [ ] **HR-INV-06 (Strict Fail-Closed Corruption Policy):**
      If `PRAGMA integrity_check;` detects database corruption upon startup, the engine MUST fail closed immediately without executing heuristic auto-repairs. It MUST present a diagnostic alert providing options to restore from backup or inspect the database via diagnostic tools.

### 6.4 Hard API & Interface Contracts

In CollarAgent's architecture, the storage layer is not an isolated database; it is a service consumed across process boundaries by the **WebSocket Sync Relay** ([`ws-server.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/ws-server.ts)), the **LangGraph Agent Runtime** ([`CheckpointApiClient.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/checkpoint/CheckpointApiClient.ts)), and **Frontend Synchronizers** ([`listDocumentInstances.ts`](file:///Users/goldenfung/Documents/collaragent/src/workspace/wstools/listDocumentInstances.ts)).

Applying the principles from [api-and-interface-design](file:///Users/goldenfung/.gemini/config/skills/api-and-interface-design/SKILL.md) and [.agents/rules/coding-rules.md](file:///Users/goldenfung/Documents/collaragent/.agents/rules/coding-rules.md), the storage architecture requires hard specifications across two distinct boundaries:

1. **Boundary A: The External Wire API Contract** (HTTP REST endpoints in [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts)).
2. **Boundary B: The Internal Storage Engine Interfaces** (typed TypeScript contracts for `SqliteStorageEngine` and `SqliteCheckpointStore`).

---

### 1. Hard Wire API Specification Requirements (Boundary A)

#### Hard Req 1: Zero Schema Drift Against Existing Zod Contracts

Existing client-side modules validate responses using strict Zod schemas defined in [`src/shared/schemas/requests.ts`](file:///Users/goldenfung/Documents/collaragent/src/shared/schemas/requests.ts) and [`src/shared/checkpoints/validators.ts`](file:///Users/goldenfung/Documents/collaragent/src/shared/checkpoints/validators.ts).

- **Evidence:** In [`listDocumentInstances.ts#L157`](file:///Users/goldenfung/Documents/collaragent/src/workspace/wstools/listDocumentInstances.ts#L157), the client executes:
  ```typescript
  const parsed = ListInstancesResponseSchema.safeParse(data)
  if (!parsed.success) reject(new Error(`Invalid /api/instances schema: ${parsed.error.message}`))
  ```
- **Hard Spec Requirement:**
  - `GET /api/instances` **MUST** return `{ instances: InstanceSummary[], projects: ProjectSummary[] }` exactly conforming to `ListInstancesResponseSchema`.
  - `GET /api/instances/:id` **MUST** return `{ id, projectId, name, type, payload, metadata, updatedAt }` conforming to `GetInstanceByIdSchema`.
  - The SQLite storage engine must produce output that satisfies these existing validators without requiring changes in the caller.

---

#### Hard Req 2: Resolution of the `content` vs. `payload` Ambiguity

- **Evidence:** In [`filesystemAPI.ts#L161-L164`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts#L161-L164), legacy code contained an ad-hoc fallback:
  ```typescript
  if (changes.payload && !changes.content) {
    changes.content = changes.payload
    delete changes.payload
  }
  ```
- **Hard Spec Requirement:**
  - The wire API must formalize input/output fields via explicit Zod schemas:
    - In request bodies (`PATCH /api/instances/:id` and `POST /api/instances`), clients may provide `content` or `payload`, which is normalized strictly at the route boundary validator.
    - In response bodies (`GET /api/instances/:id`), the field returned to clients is canonically `payload` (for canvas/document AST) to remain 100% compliant with `GetInstanceByIdSchema`.
    - Internal database storage names the column `content_msgpack BLOB`.

---

#### Hard Req 3: Standardized Error Wire Contract (Elimination of Leaked DB Codes)

- **Evidence:** In [`filesystemAPI.ts#L151`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts#L151), the legacy code leaked a PostgreSQL error code:
  ```typescript
  if (err.code === '23505') {
    // Legacy PostgreSQL unique_violation!
    return res.status(409).json({ error: err.message })
  }
  ```
  Elsewhere, endpoints returned unstructured strings: `res.status(500).json({ error: "Internal Server Error" })`.
- **Hard Spec Requirement:**
  All error responses across all 33 endpoints must conform to a single deterministic shape:
  ```typescript
  interface ApiErrorResponse {
    error: {
      code: string // Scoped typed enum: "STORAGE_NOT_FOUND", "STORAGE_LOCK_CONFLICT"
      message: string // Human-readable diagnostic message
      subsystem: 'STORAGE'
      details?: unknown // Structured metadata (entityId, path, constraint)
    }
  }
  ```
  HTTP Status Code Mapping:
  - `400 Bad Request`: Input failed Zod request schema validation.
  - `404 Not Found`: Entity (instance, session, checkpoint) does not exist in SQLite.
  - `409 Conflict`: Unique constraint violation or file lock conflict (`STORAGE_LOCK_CONFLICT`).
  - `422 Unprocessable Entity`: Semantic validation failure (e.g. invalid checkpoint state).
  - `500 Internal Server Error`: Unhandled database exception (with cause preserved in logs, but never leaking raw C++ stack dumps).

---

#### Hard Req 4: Boundary Validation at System Edges

- **Hard Spec Requirement:**
  Every endpoint in `filesystemAPI.ts` must validate `req.params`, `req.query`, and `req.body` using Zod schemas _before_ calling internal storage methods.
  - No database logic may execute with unvalidated inputs.
  - Internal storage methods will receive strongly-typed domain objects, not raw Express `req.body`.

---

#### Hard Req 5: Bounded Query Pagination for Chat & Logs

- **Problem:** Currently, `GET /api/chat/sessions/:id` and `GET /api/checkpoints/workspace/logs/:instanceId` return unbounded JSON arrays. In long sessions with 2,000 messages or 10,000 command actions, stringifying and sending the entire array degrades the event loop and memory.
- **Hard Spec Requirement:**
  - `GET /api/chat/sessions/:id/messages` and `/api/checkpoints/workspace/logs/:instanceId` must support query parameters:
    `?limit=50&before=<timestamp | cursor>`.
  - Default `limit = 100`.
  - For backward compatibility, `GET /api/chat/sessions/:id` without query parameters continues returning recent messages with a sensible ceiling (e.g. 200) rather than unconstrained memory dumps.

---

### 2. Hard Internal Interface Specification Requirements (Boundary B)

To prevent tight coupling between the Express route handlers and `better-sqlite3` native calls, the database operations must be governed by explicit TypeScript interfaces.

#### Interface 1: `IStorageEngine` Contract

```typescript
export interface IStorageEngine {
  // Lifecycle
  initialize(): Promise<void>
  close(): Promise<void>
  prepareClose(): Promise<void>

  // Projects & Instances
  getProjects(): ProjectRecord[]
  getInstancesMeta(projectId?: string): InstanceSummary[]
  getInstanceContent(instanceId: string): Buffer | null
  createInstance(type: 'document' | 'canvas', data: CreateInstanceInput): InstanceSummary
  updateInstance(instanceId: string, updates: UpdateInstanceInput): void
  deleteInstance(instanceId: string): void

  // Chat & Messaging
  getChatSessions(projectId: string): ChatSessionSummary[]
  getChatSession(sessionId: string): ChatSessionDetail | null
  createChatSession(projectId: string, title: string): ChatSessionSummary
  appendChatMessage(sessionId: string, message: ChatMessageInput): void
  deleteChatSession(sessionId: string): void // Cascades checkpoints & writes

  // Snapshots & Command Logs
  createSnapshot(snapshot: CreateSnapshotInput): WorkspaceSnapshot
  getSnapshot(snapshotRef: string): Buffer | null
  appendCommandLog(instanceId: string, command: CommandLogInput): void
  getCommandLogs(instanceId: string, limit?: number): WorkspaceCommandLogEntry[]
}
```

#### Interface 2: `ICheckpointStore` Contract

```typescript
export interface ICheckpointStore {
  // LangGraph Core
  getCheckpoints(threadId: string, checkpointNs?: string): Promise<CheckpointRecord[]>
  getLatestCheckpoint(
    threadId: string,
    checkpointNs?: string
  ): Promise<CheckpointRecord | undefined>
  putCheckpoint(record: CheckpointRecord): Promise<void>

  // Channel Version Blobs
  getBlob(
    threadId: string,
    checkpointNs: string,
    channel: string,
    version: string
  ): Promise<CheckpointBlobRecord | undefined>
  getBlobsByPrefix(threadId: string, checkpointNs: string): Promise<CheckpointBlobRecord[]>
  putBlob(record: CheckpointBlobRecord): Promise<void>
  deleteBlobs(keys: string[]): Promise<void>

  // Pending Task Writes & Retention
  getWrites(threadId: string, checkpointId: string): Promise<CheckpointWriteRecord[]>
  putWrites(records: CheckpointWriteRecord[]): Promise<void>
  pruneWrites(threadId: string, keepTurns: number): Promise<number>

  // Restore Heads
  getRestoreHead(threadId: string, checkpointNs: string): Promise<string | undefined>
  putRestoreHead(threadId: string, checkpointNs: string, checkpointId: string): Promise<void>

  // ADR-006 Large Tool Results
  putLargeToolOutput(id: string, sessionId: string, buffer: Buffer): Promise<void>
  getLargeToolOutput(id: string): Promise<Buffer | undefined>
}
```

### Summary Checklist of Hard API Requirements

| ID             | Requirement                                                                                  | Justification                                                                     |
| :------------- | :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| **API-REQ-01** | Output of `GET /api/instances` must strictly validate against `ListInstancesResponseSchema`. | Prevents sync breakage in `listDocumentInstances.ts`.                             |
| **API-REQ-02** | Output of `GET /api/instances/:id` must return canonical `payload` property.                 | Required by `GetInstanceByIdSchema` and `ws-server.ts`.                           |
| **API-REQ-03** | Error bodies must follow `{ error: { code, message, subsystem, details } }`.                 | Eliminates legacy PostgreSQL codes and provides typed error handling.             |
| **API-REQ-04** | All route inputs must pass Zod schema parsing before hitting the storage engine.             | Enforces boundary validation; guarantees internal type integrity.                 |
| **API-REQ-05** | Chat and log queries must support `limit` and `before` cursor parameters.                    | Prevents memory starvation and V8 freeze on large histories.                      |
| **API-REQ-06** | Engine must implement decoupled `IStorageEngine` and `ICheckpointStore` interfaces.          | Enables unit testing, Vitest in-memory mocks, and clean architectural boundaries. |

---

### 6.5 Architectural Confinement: Permitted vs. Strictly Prohibited Layers

To prevent architectural regression, cross-process leakage, and unintended coupling, modifications for the V4 SQLite storage transition are strictly bounded by subsystem layer:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Layer                                    │ Status         │ Rationale      │
├──────────────────────────────────────────┼────────────────┼────────────────┤
│ src/main/server/fileServer/              │ PERMITTED      │ Storage domain │
│ package.json / build configurations      │ PERMITTED      │ Dependencies   │
│ docs/sqlite-storage-architecture/        │ PERMITTED      │ Specs & docs   │
├──────────────────────────────────────────┼────────────────┼────────────────┤
│ src/renderer/                            │ MUST NOT EDIT  │ UI boundary    │
│ src/main/server/ws/                      │ MUST NOT EDIT  │ Transport sync │
│ src/workspace/                           │ MUST NOT EDIT  │ Canvas/editor  │
│ src/collaragent/                         │ MUST NOT EDIT  │ Agent runtime  │
│ src/preload/                             │ MUST NOT EDIT  │ IPC bridge     │
│ src/shared/                              │ MUST NOT EDIT  │ Zero-dep specs │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Permitted Modification Layer (CAN Be Edited)

Modifications are strictly confined to the backend utility-process storage layer and project build configurations:

- **[`src/main/server/fileServer/`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/) (Primary Storage Subsystem):**
  - **New files permitted:**
    - `SqliteStorageEngine.ts`: Implements [`IStorageEngine`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L277).
    - `SqliteCheckpointStore.ts`: Implements [`ICheckpointStore`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md#L308).
    - `StorageMigrationEngine.ts`: Automated V2/V3 ETL migration pipeline.
    - `db/SqliteDatabase.ts`: Database connection factory and migration runner.
    - `db/migrations/001_v4_init.sql`: Initial DDL schema and B-Tree indexes.
    - `interfaces/IStorageEngine.ts`: Storage domain contract.
    - `interfaces/ICheckpointStore.ts`: LangGraph checkpoint store contract.
    - `errors/StorageErrors.ts`: Typed enum error codes extending `CollarError`.
    - `config/sqliteConfig.ts`: PRAGMA and buffer configuration constants.
    - `locks/ProjectLockManager.ts`: Single-writer file lock with PID recovery.
    - `__tests__/*`: Unit, integration, and performance benchmark suites.
  - **Modified files permitted:**
    - [`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts): Route-by-route wiring to `IStorageEngine` / `ICheckpointStore`, Zod boundary parsing, standardized error mapping, bounded query pagination.
    - [`process.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/process.ts): UtilityProcess entry point direct SQLite connection, migration routing, and window close hook (`prepare-close`).
    - [`FileSystemSaver.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/FileSystemSaver.ts): Adapter wiring to `SqliteCheckpointStore`.
  - **Deprecated files (Safe to remove upon test passage):**
    - `CagentStorage.ts`, `FileCheckpointStore.ts`, `ArchiveManager.ts`.
- **Root Project Dependencies:**
  - [`package.json`](file:///Users/goldenfung/Documents/collaragent/package.json) and `yarn.lock`: Adding `better-sqlite3` and `@types/better-sqlite3`.
- **Documentation & Task Management:**
  - [`docs/sqlite-storage-architecture/`](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/) and `tasks/` (`plan.md`, `todo.md`).

---

#### 2. Strictly Prohibited Modification Layer (MUST NOT Be Edited)

Under no circumstances may the following subsystems and modules be edited during the storage engine transition:

1. **[`src/renderer/`](file:///Users/goldenfung/Documents/collaragent/src/renderer/) (Chromium UI / React 19 / Dockview):**
   - **Prohibited Modules:** Canvas components, Lexical editor panes, Dockview panel layouts, Zustand stores (`chatStore.ts`, `configStore.ts`), React hooks, UI styles (`base.css`).
   - **Rationale:** The storage engine runs strictly in the background Electron `utilityProcess`. The renderer interacts purely via context-isolated IPC (`agentIPC`, `configIPC`) and WebSocket connections. Editing UI components violates process confinement and risks breaking frontend stability.
2. **[`src/main/server/ws/`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/) (WebSocket Sync Relay):**
   - **Prohibited Modules:** [`ws-server.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/ws/ws-server.ts), `editorContentSync.ts`.
   - **Rationale:** The WebSocket server mediates real-time tab collaboration and in-memory delta broadcasts. It persists by issuing standard HTTP `PATCH` and `GET` requests to `filesystemAPI.ts`. The SQLite backend must satisfy this existing HTTP contract; the WebSocket server MUST NOT be rewritten or modified.
3. **[`src/workspace/`](file:///Users/goldenfung/Documents/collaragent/src/workspace/) (Canvas & Lexical Editor Engine):**
   - **Prohibited Modules:** Canvas stores (`store.tsx`), Dagre layouts, Leiden clustering worker, Lexical editor nodes/plugins (`CardEditor`), `SyncClient`, `wstools/` (`listDocumentInstances.ts`, `createDocumentInstance.ts`).
   - **Rationale:** Workspace synchronizers consume standard DTOs via the WebSocket and HTTP endpoints. Client-side schemas must be preserved without modification.
4. **[`src/collaragent/`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/) (DeepAgent LangGraph Core Runtime):**
   - **Prohibited Modules:** Core agent loop (`runtime/agent.ts`), middleware (`middleware/*`), mathematical diff engines (`CanvasDiffEngine.ts`, `DocumentDiffEngine.ts`, `InverseCommandEngine.ts`), skills (`skills/*`), checkpointer adapters (`ChatCheckpointSaver.ts`, `CheckpointBundleStore.ts`).
   - **Rationale:** Agent decision logic, memory middleware, and tool execution engines are decoupled from physical database files. `FileSystemSaver` and [`CheckpointApiClient.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/checkpoint/CheckpointApiClient.ts) connect via existing REST persistence contracts.
5. **[`src/preload/`](file:///Users/goldenfung/Documents/collaragent/src/preload/) (IPC Isolation Bridges):**
   - **Prohibited Modules:** Preload entry point (`index.ts`), exposed window bridges (`configIPC`, `agentIPC`, `fileIPC`).
   - **Rationale:** Context-isolated security boundaries must remain fixed; no new ambient channels or IPC signature mutations are permitted.
6. **[`src/shared/`](file:///Users/goldenfung/Documents/collaragent/src/shared/) (Core Platform-Agnostic Contracts):**
   - **Prohibited Modules:** Canvas nominal branded types (`src/shared/canvas/types.ts`), REST DTO schemas (`src/shared/schemas/requests.ts`, `src/shared/schemas/instances.ts`), checkpoint validators (`src/shared/checkpoints/validators.ts`).
   - **Rationale:** Invariant 1: `src/shared` is a platform-agnostic, zero-platform-dependency single source of truth. The storage engine must conform to these existing schemas, never alter them.

---

## 7. Code Style & TypeScript Integrity

### Rules

1. **Zero `any` Policy:** Use `unknown`, type guards, custom narrowing (`x is Type`), or Zod schemas.
2. **No Suppression:** Never use `@ts-ignore` or `@ts-nocheck`.
3. **Structured Errors:** Throw `StorageError` extending `CollarError` with typed enum codes (`STORAGE_CHECKPOINT_NOT_FOUND`, `STORAGE_LOCK_CONFLICT`). Upstream SQLite errors MUST be preserved in the `cause` chain.
4. **No Hardcoded Constants:** PRAGMAs, timeouts, and page sizes must originate from a centralized configuration file.

### Reference Implementation Snippet

```typescript
import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { StorageError, StorageErrorCode } from './errors/StorageErrors'

export interface SqliteEngineConfig {
  readonly busyTimeoutMs: number
  readonly cacheSizeKb: number
  readonly mmapSizeByte: number
}

export class SqliteConnectionFactory {
  public static create(dbPath: string, config: SqliteEngineConfig): DatabaseType {
    try {
      const db = new Database(dbPath, { timeout: config.busyTimeoutMs })

      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = NORMAL')
      db.pragma('foreign_keys = ON')
      db.pragma('temp_store = MEMORY')
      db.pragma(`cache_size = -${config.cacheSizeKb}`)
      db.pragma(`mmap_size = ${config.mmapSizeByte}`)
      db.pragma('auto_vacuum = INCREMENTAL')

      return db
    } catch (cause: unknown) {
      throw new StorageError(
        StorageErrorCode.STORAGE_CONNECTION_FAILED,
        `Failed to open SQLite database at ${dbPath}`,
        { dbPath },
        cause instanceof Error ? cause : undefined
      )
    }
  }
}
```

---

## 8. Testing Strategy

| Level                     | Scope                                                                                                                                                         | Tools                      | Verification Target                                                                        |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------- | :----------------------------------------------------------------------------------------- |
| **Unit**                  | Checkpoint store, blob encoding, query statements, migration parsing                                                                                          | Vitest                     | 100% statement coverage of DDL queries and statement bindings.                             |
| **Integration**           | Express REST endpoints ([`filesystemAPI.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/filesystemAPI.ts)) with live SQLite DB | Vitest + Supertest         | Verifies payload parity against legacy `CagentStorage` responses.                          |
| **End-to-End Migration**  | Converting real-world V2/V3 `.cagent` fixtures to V4 SQLite                                                                                                   | Vitest + Fixtures          | Verifies zero data loss, foreign key check passage, and automatic rollback on corrupt ZIP. |
| **Performance Benchmark** | 1,000 checkpoint iterations, cold startup, and shutdown timing                                                                                                | Vitest bench / Node hrtime | Enforces performance budgets (<15ms open, <1.5ms getTuple, <10ms close).                   |

---

## 9. Boundaries

### Always Do

- Execute `PRAGMA foreign_key_check;` and `PRAGMA integrity_check;` after any migration or bulk mutation.
- Execute `PRAGMA wal_checkpoint(TRUNCATE);` before closing the SQLite database handle on shutdown.
- Acquire and release `<path>.cagent.lock` cleanly in [`process.ts`](file:///Users/goldenfung/Documents/collaragent/src/main/server/fileServer/process.ts).
- Validate all incoming REST and WebSocket payloads with Zod schemas.

### Ask First

- Modifying the DDL schema in [storage-engine-design.md](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/storage-engine-design.md) or changing table column names.
- Adding dependencies outside of `better-sqlite3` and `@types/better-sqlite3`.
- Altering the retention threshold for `langgraph_writes` pruning (currently 3 turns).

### Never Do

- Never use `@ts-ignore`, `@ts-nocheck`, or `as any`.
- Never extract files to an adjacent directory (no `<project>.collar/` directory).
- Never invoke synchronous `zlib` compression on shutdown.
- Never overwrite or delete a user's legacy `.cagent` file without a validated `.v3.bak` backup.

---

## 10. Success Criteria (Reframed Acceptance)

```
SUCCESS CRITERIA:
1. Cold Startup: Connecting to a 1,000-checkpoint project takes < 15ms (down from 3.5–8s).
2. Clean Exit: Window close teardown completes in < 10ms without zlib compression (down from 2–15s).
3. Checkpoint Query: getTuple() completes in < 1.5ms across 1,000 turns (down from 50–250ms).
4. Memory Footprint: Initial project heap consumption remains < 25MB (down from >100MB).
5. Zero Protocol Breakage: 100% of existing tests in src/workspace/ pass with zero frontend or WS protocol changes.
6. Migration Parity: Converting any valid V2/V3 archive results in 0 foreign key violations, identical canvas/document content hashes, and a preserved .v3.bak file.
→ Are these the right targets?
```

---

## 11. Resolved & Open Design Decisions

### Resolved

- **Transient Writes Retention:** Retaining the last 3 completed turns of `langgraph_writes` is confirmed as sufficient for UI time-travel, replay, and error retry scenarios.
- **Vacuum Schedule:** `PRAGMA incremental_vacuum(500);` runs as part of the window close hook (`prepare-close`) immediately preceding `PRAGMA wal_checkpoint(TRUNCATE);`.
- **Backup Retention:** The `<filename>.cagent.v3.bak` migration backup remains indefinitely in the project directory until manually deleted by the user.
- **Lock Conflict Strategy:** Dead PIDs auto-recover the lock; active process conflicts surface an interactive dialog giving the user the choice between Read-Only Mode and Force Takeover.
- **Runtime WAL Checkpointing:** Hybrid checkpointing using SQLite default `wal_autocheckpoint(1000)` during turns + background `PRAGMA wal_checkpoint(PASSIVE);` after 30 seconds of idle inactivity.
- **Project Export Scope:** `.cagent` SQLite file is the single project format; content sharing occurs via existing single-document exports (DOCX/Markdown/PDF).
- **Session Deletion Cascade:** Deleting a chat session cascades and deletes all associated LangGraph checkpoints, writes, blobs, and restore heads for that thread lineage.
- **Snapshot Trigger Semantics:** Live edits update `instances.content_msgpack` atomically on debounced patches; historical entries in `workspace_snapshots` are milestone-driven (user checkpoints, tab switches, named snapshots).
- **Corruption Policy:** Strict fail-closed on `PRAGMA integrity_check` failure without automated heuristic repairs; immediate diagnostic prompt offering restore from backup.
- **Telemetry Storage Policy:** Local token usage and step execution metrics remain strictly in-memory/ephemeral unless Langfuse is configured.
- **Migration Progress Feedback:** Real-time progress events are emitted over IPC (`onMigrationProgress: { stage, percent }`) to render a progress bar in the UI.
- **Large Tool Output Storage:** ADR-006 evicted tool results (>20k tokens / ~80KB) are stored inside the `large_tool_outputs` table within the same `.cagent` SQLite file to preserve strict single-file containment.
- **Future Schema Evolution:** Forward-only DDL migrations keyed by `PRAGMA user_version`, executed sequentially in a single transaction on startup.
