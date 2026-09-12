# CollarAgent API Requirements & Interface Specifications

This document defines the formal API requirements, communication protocols, request/response payload schemas, error taxonomies, and interface contracts for all subsystems in the CollarAgent platform.

---

## 1. System Communication Taxonomy

CollarAgent uses four specialized communication channels tailored to specific latency, durability, and execution requirements:

```mermaid
flowchart TB
    subgraph UI ["Renderer UI (React / Dockview)"]
        CanvasUI["Graph Canvas"]
        EditorUI["Lexical Editor"]
        ChatUI["ReAct Chat Pane"]
    end

    subgraph IPCBridge ["Electron IPC Bridge (contextBridge)"]
        direction TB
        IPCRequest["Request / Response IPC"]
        IPCStream["AsyncGenerator Stream IPC"]
    end

    subgraph MainHost ["Electron Main Host"]
        AgentRuntime["LangGraph Agent Runtime"]
        WorkspaceTools["Workspace Tools Engine"]
        WSServer["WebSocket Sync Server (Dynamic :wsPort)"]
    end

    subgraph UtilityProcess ["Node.js Utility Process (Dynamic :apiPort)"]
        RESTServer["Express Storage API"]
        StorageEngine["Single-File SQLite V7 CAS & True DAG Engine"]
    end

    subgraph External ["External Services"]
        LLM["Cloud LLM Providers"]
        MCP["MCP Servers (STDIO/SSE)"]
    end

    %% Wiring
    ChatUI -->|"Dynamic Channel IPC"| IPCStream
    IPCStream --> AgentRuntime
    CanvasUI <-->|"ws://localhost:${wsPort}/ws/canvas/:id"| WSServer
    EditorUI <-->|"ws://localhost:${wsPort}/ws/editor/:id"| WSServer
    WorkspaceTools <-->|"ws://localhost:${wsPort}/ws/..."| WSServer
    WorkspaceTools -->|"http://localhost:${apiPort}/api/..."| RESTServer
    WSServer -->|"http://localhost:${apiPort}/api/..."| RESTServer
    RESTServer --> StorageEngine
    AgentRuntime -->|"HTTPS / REST"| LLM
    AgentRuntime -->|"STDIO / SSE"| MCP
```

| Layer                    | Transport / Protocol               | Port / Endpoint                                              | Primary Responsibility                                                                      |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Storage REST API**     | HTTP 1.1 / JSON                    | `http://127.0.0.1:${apiPort}/api/*` (Dynamic ephemeral port) | Instance discovery, project management, binary export, checkpoint restoration               |
| **Realtime Sync API**    | WebSocket / JSON                   | `ws://127.0.0.1:${wsPort}/ws/*` (Dynamic ephemeral port)     | Realtime state synchronization, staged proposals, collaborative mutation, command inversion |
| **Electron Desktop IPC** | Electron `ipcRenderer` / `ipcMain` | Dynamic channels                                             | Chat invocation, token stream unbuffering, native dialogs, hardware key encryption          |
| **Agent Tool Calling**   | TypeScript In-Process Functions    | `WorkspaceTools.ts`                                          | Programmatic manipulation of workspace documents, graph nodes, and files                    |

### 1.1 Dynamic Ephemeral Port Allocation & Session Discovery

CollarAgent runs both the Storage REST API and the Realtime WebSocket Sync Server on **dynamically allocated ephemeral ports** rather than fixed static ports:

- **Per-Window Ephemeral Allocation**: On workspace/window initialization (`WindowManager.ts`), the main process forks the storage daemon (`utilityProcess.fork`) and starts `ws-server` by binding to port `0`. The operating system allocates free ephemeral ports on demand, ensuring zero port collisions across multiple open windows, test runners, or concurrent instances.
- **Renderer Discovery via URL Query Parameters**: The allocated ports are passed into the renderer `BrowserWindow` through URL search parameters (`?apiPort=${fsPort}&wsPort=${wsHandle.port}&filePath=${filePath}`).
- **Client Session Context**: The frontend React app (`ProjectSession.tsx`) extracts `apiPort` and `wsPort` from `window.location.search` and exposes them via `InstanceContext` and `ProjectSessionContext`.
- **Agent Tool Execution**: The LangGraph agent runtime and tool executor (`WorkspaceTools.ts`, `ClientConnection.ts`) receive `wsPort` and `apiPort` from the active session context for all workspace operations.

---

## 2. Storage REST API Requirements (`src/main/server/fileServer`)

The Storage REST API runs inside a dedicated Node.js `UtilityProcess` and provides deterministic, schema-validated CRUD operations for workspaces, instances, and checkpoints.

### 2.1 Standard Envelopes & Error Contracts

All REST API responses must adhere to strictly typed JSON envelopes. Arbitrary top-level raw arrays or naked objects without field validation are forbidden.

#### Standard Error Response Envelope

```json
{
  "error": {
    "code": "STORAGE_ERR_NOT_FOUND",
    "message": "Instance \"doc-uuid-1\" could not be found in active project.",
    "subsystem": "STORAGE",
    "details": null
  }
}
```

### 2.2 Endpoint Specifications

#### 1. `GET /api/instances`

Returns a list of all document and canvas instances in the active project along with project records.

- **Query Parameters**:
  - `projectId` _(optional, string)_: Unfiltered in current storage daemon implementation.
- **Success Response (`200 OK`)**:
  ```json
  {
    "instances": [
      {
        "id": "4a73ec31-6ec6-4f40-9a28-971c66f7d0a1",
        "name": "System Architecture",
        "projectId": "default",
        "type": "document",
        "updatedAt": "2026-08-30T07:15:00.000Z",
        "metadata": {
          "wordCount": 1420
        }
      },
      {
        "id": "9b12cc88-2ff1-4ab3-8e41-018dca44f210",
        "name": "Service Topology Canvas",
        "projectId": "default",
        "type": "canvas",
        "updatedAt": "2026-08-30T07:20:00.000Z",
        "metadata": {
          "nodeCount": 18
        }
      }
    ],
    "projects": [
      {
        "id": "default",
        "name": "Default Project"
      }
    ]
  }
  ```
- **Validation Schema (Zod)**:
  ```typescript
  export const ListInstancesResponseSchema = z.object({
    instances: z.array(
      z.object({
        id: z.string().min(1),
        projectId: z.string().optional(),
        updatedAt: z.string().optional(),
        name: z.string().optional(),
        type: z.enum(['document', 'canvas']).optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
    ),
    projects: z.array(ProjectSchema).optional()
  })
  ```

#### 2. `GET /api/instances/:id`

Retrieves the raw persisted state payload of an individual instance.

- **Path Parameters**:
  - `id` _(string, required)_: The UUID of the instance.
- **Success Response (`200 OK`)**:
  - For Document: `{ "blocks": [...], "comments": [...] }`
  - For Canvas: `{ "type": "graph-canvas", "graph": { "nodes": [...], "edges": [...] }, "layout": { ... } }`
- **Error Responses**:
  - `404 Not Found`: `{ "error": { "code": "STORAGE_ERR_NOT_FOUND", "message": "...", "subsystem": "STORAGE" } }`

#### 3. `POST /api/instances`

Creates a new document or canvas instance.

- **Request Body**:
  ```json
  {
    "id": "optional-custom-uuid",
    "name": "New Research Document",
    "projectId": "proj-uuid",
    "type": "document",
    "payload": {
      "blocks": [
        {
          "id": "block-1",
          "type": "paragraph",
          "children": [{ "text": "Initial paragraph content." }]
        }
      ],
      "comments": []
    }
  }
  ```
- **Success Response (`201 Created`)**: `{ "status": "created", "id": "4a73ec31-6ec6-4f40-9a28-971c66f7d0a1" }`

#### 4. `GET /api/projects`

Lists all workspaces/projects registered in the storage engine.

- **Success Response (`200 OK`)**:
  ```json
  {
    "projects": [
      {
        "id": "default",
        "name": "Default Project",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "updatedAt": "2026-08-30T07:00:00.000Z"
      }
    ]
  }
  ```

#### 5. `POST /api/checkpoints/restore`

Restores the complete project state, instance snapshots, and chat history to a designated checkpoint bundle.

- **Request Body**:
  ```json
  {
    "bundleId": "chk-turn-14-uuid",
    "threadId": "chat-thread-uuid",
    "sessionId": "chat-session-uuid"
  }
  ```
- **Validation Schema (Zod)**:
  ```typescript
  export const CheckpointRestoreBodySchema = z.object({
    bundleId: z.string().min(1),
    sessionId: z.string().optional(),
    threadId: z.string().optional()
  })
  ```
- **Success Response (`200 OK`)**:
  ```json
  {
    "status": "restored",
    "bundleId": "chk-turn-14-uuid",
    "bundle": {
      "id": "chk-turn-14-uuid",
      "sessionId": "chat-session-uuid",
      "threadId": "chat-thread-uuid",
      "projectId": "default",
      "chat": { "messageId": "msg-14", "blockIndex": 0 },
      "instances": []
    }
  }
  ```
- **Behavioral Guarantees**:
  1. **Non-Destructive True DAG Chat Branch Switching**: Checkpoint restore does not destroy or truncate historical messages. Instead, `setActiveBranch(threadId, activeMessageId, activeCheckpointId)` pivots the active pointer of the thread (`active_message_id = bundle.chat.messageId`, `active_checkpoint_id = bundle.id`, or `NULL` for initial start). When rendering the chat timeline, the storage engine executes a recursive Common Table Expression (CTE) traversing from `active_message_id` upward along `parent_message_id`. All messages across alternate branches and abandoned exploratory paths remain permanently preserved in SQLite.
  2. **Fail-Closed CAS Snapshot Hydration**: Target instance snapshots are resolved from CAS `workspace_blobs` via `blob_hash`. If snapshot data cannot be resolved or is null, the restore operation aborts immediately and throws `StorageError(StorageErrorCode.STORAGE_CHECKPOINT_NOT_FOUND)`, ensuring live instances are never overwritten with empty state.
  3. **DAG Lineage & LangGraph Head Synchronization**: Updates `LANGGRAPH_RESTORE_HEADS` and registers `AgentCheckpointRegistry.setPendingBranch()` and `setEffectiveBundleId()` so subsequent agent turns correctly branch in the DAG tree.
  4. **WebSocket OCC Sequence & Proposal Realignment**: Emits a `system-checkpoint-restore` protocol update to the WebSocket server, resetting `commandSequences.set(instanceId, seq)` to the restore point's cursor and purging any pending proposals in `proposals[instanceId]`. Also emits `chat:restored` and `chat:sessionsUpdated`.

#### 6. `POST /api/checkpoints/workspace/snapshots`

Captures an idempotent, two-tier content-addressed binary MessagePack instance snapshot.

- **Request Body**: Raw binary buffer (`application/octet-stream` containing MessagePack-encoded instance payload) or JSON payload with DTO.
- **Query Parameters**:
  - `instanceId` _(required, string)_: Instance UUID.
  - `instanceType` _(required, string)_: `'graph-canvas' | 'document'`.
  - `projectId` _(optional, string)_: Scoped project UUID.
  - `parentSnapshotRef` _(optional, string)_: Previous snapshot reference sha256.
- **Success Response (`200 OK` / `201 Created`)**:
  ```json
  {
    "snapshotId": "snap-uuid-101",
    "snapshotRef": "3a7b9c...sha256.msgpack",
    "blobHash": "3a7b9c...sha256",
    "size": 4096
  }
  ```
- **Two-Tier CAS Architecture & Idempotency Guarantee**: The payload is hashed (SHA-256) and upserted into `workspace_blobs (hash, content_msgpack, byte_size, created_at)`. A pointer record is then inserted into `workspace_snapshots (id, instance_id, project_id, snapshot_ref, snapshot_hash, blob_hash, snapshot_cursor_json)`. If an identical blob exists, the existing record is referenced, preventing data bloat and granting cascade-deletion immunity.

#### 7. `GET /api/checkpoints/bundles` & `PUT /api/checkpoints/bundles`

Lists and stores checkpoint bundles scoped by session, thread, and project with DAG tree lineage.

- **`GET /api/checkpoints/bundles` Query Parameters**:
  - `threadId` _(optional, string)_
  - `sessionId` _(optional, string)_
  - `projectId` _(optional, string)_: Filters bundles to the active project, preventing cross-project metadata pollution.
- **`PUT /api/checkpoints/bundles` Request Body**: Validated `CheckpointBundleSchema` payload including non-linear DAG properties (`parentBundleId?: string` and `branchName?: string`).

---

## 3. Realtime WebSocket Protocol Specifications (`src/main/server/ws`)

The WebSocket server provides bidirectional synchronization between UI clients (Canvas, Editor) and the Agent Tool execution engine.

### 3.1 Connection Handshake & Endpoint Routing

All WebSocket endpoints are served over the dynamically bound `${wsPort}` resolved during workspace initialization (`ws://127.0.0.1:${wsPort}`).

| Route                    | Purpose                        | Message Types Handled                                                                                                        |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `/ws/canvas/:instanceId` | Realtime Graph Canvas Sync     | `join`, `sync-request`, `sync-command`, `sync-ack`, `sync-changes`, `accept-changes`, `reject-changes`, `flush`, `flush-ack` |
| `/ws/editor/:instanceId` | Realtime Document Editor Sync  | `join`, `sync-request`, `sync-command`, `sync-ack`, `sync-changes`, `accept-changes`, `reject-changes`, `flush`, `flush-ack` |
| `/ws/editor-content`     | Legacy Single-Doc Route        | Same as editor route                                                                                                         |
| `/ws/instances`          | Live Instance Registry Watcher | `hello`, `watchInstances`, `instancesSync`                                                                                   |

### 3.2 Protocol Sequence Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as SyncClient (Agent / UI)
    participant WSServer as WebSocket Server (Dynamic :wsPort)
    participant Storage as Storage REST API (Dynamic :apiPort)

    Note over Client,WSServer: Connection Establishment
    Client->>WSServer: Connect ws://localhost:${wsPort}/ws/editor/:id
    WSServer-->>Client: Connection Opened

    Note over Client,WSServer: Protocol Handshake
    Client->>WSServer: {"type": "join", "clientId": "agent-123"}
    Client->>WSServer: {"type": "sync-request", "version": 0}

    alt Instance Exists and Hydrated
        WSServer->>Storage: Hydrate payload if missing
        Storage-->>WSServer: Document Payload
        WSServer-->>Client: {"type": "sync-snapshot", "blocks": [...], "comments": [], "version": 1}
        Note over Client: readyPromise resolves
    else Instance Not Found
        WSServer-->>Client: {"type": "error", "code": "WORKSPACE_INSTANCE_NOT_FOUND", "message": "..."}
        Note over Client: readyPromise rejects immediately
    end

    Note over Client,WSServer: Mutative Command & OCC Validation
    Client->>WSServer: {"type": "sync-command", "command": {...}, "clientId": "agent-123", "version": 2, "threadId": "thread-1", "baseVersion": 1}
    alt Stale Base Version (baseVersion < currentSeq)
        WSServer-->>Client: {"type": "error", "code": "WORKSPACE_STALE_BASE_VERSION", "message": "Base version is stale"}
    else Valid Sequence
        WSServer->>WSServer: Apply command & buffer under proposals[instanceId][threadId]
        WSServer-->>Client: {"type": "sync-ack", "version": 2, "clientVersion": 2}
        WSServer-)OtherClients: Broadcast {"type": "sync-changes", "instanceId": "...", "threadId": "thread-1", "commands": [...]}
    end
```

### 3.3 Protocol Message Taxonomy

#### 1. Client-to-Server Messages

- **`join`**: Declares client identification.
  ```json
  { "type": "join", "clientId": "agent-client-uuid" }
  ```
- **`sync-request`**: Requests the full current state snapshot.
  ```json
  { "type": "sync-request", "version": 0 }
  ```
- **`sync-command`**: Dispatches an incremental mutation command with optional staging, thread isolation, and OCC base sequence.
  ```json
  {
    "type": "sync-command",
    "clientId": "agent-client-uuid",
    "version": 1,
    "threadId": "chat-thread-101",
    "baseVersion": 5,
    "command": {
      "type": "insert-block",
      "staged": true,
      "block": {
        "id": "block-uuid-5",
        "type": "paragraph",
        "children": [{ "text": "Inserted analysis text." }]
      },
      "targetIndex": 2
    }
  }
  ```
- **`accept-changes`**: Approves staged changes proposed by an agent (optionally scoped to a specific thread).
  ```json
  {
    "type": "accept-changes",
    "instanceId": "doc-uuid-1",
    "clientId": "user-client-uuid",
    "threadId": "chat-thread-101"
  }
  ```
- **`reject-changes`**: Rolls back staged changes for the targeted thread via inverse command dispatch.
  ```json
  {
    "type": "reject-changes",
    "instanceId": "doc-uuid-1",
    "clientId": "user-client-uuid",
    "threadId": "chat-thread-101"
  }
  ```
- **`flush`**: Dispatches a transactional read barrier request. The WebSocket server awaits completion of active and coalesced writes via `SerializedDrainQueue` for the specified `instanceId` (or all instances if omitted) and responds with `flush-ack`.
  ```json
  {
    "type": "flush",
    "instanceId": "doc-uuid-1",
    "flushId": "c4d5e6f7-a8b9-4c0d-1e2f-3a4b5c6d7e8f"
  }
  ```

#### 2. Server-to-Client Messages

- **`sync-snapshot`**: Full state dump answering `sync-request`.
  ```json
  {
    "type": "sync-snapshot",
    "version": 1,
    "blocks": [ ... ],
    "comments": [ ... ]
  }
  ```
- **`sync-ack`**: Monotonic sequence confirmation for a submitted command.
  ```json
  { "type": "sync-ack", "version": 2, "clientVersion": 1, "instanceId": "doc-uuid-1" }
  ```
- **`sync-changes`**: Broadcast of applied or staged commands to connected peers with thread isolation metadata.
  ```json
  {
    "type": "sync-changes",
    "instanceId": "doc-uuid-1",
    "threadId": "chat-thread-101",
    "commands": [ ... ]
  }
  ```
- **`flush-ack`**: Transactional read barrier acknowledgment confirming all in-flight persistence writes have settled to SQLite disk.
  ```json
  {
    "type": "flush-ack",
    "flushId": "c4d5e6f7-a8b9-4c0d-1e2f-3a4b5c6d7e8f"
  }
  ```
- **`error`**: Deterministic protocol-level error notification (e.g. OCC conflict, instance not found).
  ```json
  {
    "type": "error",
    "code": "WORKSPACE_STALE_BASE_VERSION",
    "message": "Base version 2 is stale. Current instance sequence is 5."
  }
  ```
- **`system-checkpoint-restore`**: Internal system message dispatched by the Storage Daemon upon point-in-time restoration. Resets `commandSequences.set(instanceId, sequenceNumber ?? 0)` to prevent OCC collisions and evicts uncommitted thread proposals from memory.
  ```json
  {
    "type": "update",
    "instanceId": "doc-uuid-1",
    "payload": { "blocks": [ ... ] },
    "clientId": "system-checkpoint-restore",
    "sequenceNumber": 5
  }
  ```

---

## 4. Electron Desktop IPC Contracts (`src/preload`, `src/main`)

Electron IPC channels use context-isolated `contextBridge` interfaces with strict runtime parameter validation. Instead of a single monolithic API, the preload layer exposes five domain-specific bridges: `window.agentIPC`, `window.configIPC`, `window.checkpointIPC`, `window.fileIPC`, and `window.skillsIPC`.

### 4.1 IPC Channel Registry

```mermaid
flowchart LR
    Renderer["Renderer Process"]
    Preload["contextBridge Domain Bridges<br/>(agentIPC, configIPC, checkpointIPC, fileIPC, skillsIPC)"]
    Main["Main Process"]

    Renderer -->|"window.agentIPC.chat(req)"| Preload
    Preload -->|"ipcRenderer.invoke('agent:chat', req)"| Main
    Main -->>|"ipcRenderer.send('agent:stream:${streamId}', chunk)"| Preload
    Preload -->>|"AsyncGenerator.next()"| Renderer
```

| Channel Name                     | Direction        | Payload Shape                                                      | Description                                                             |
| -------------------------------- | ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `agent:chat`                     | Bidirectional    | `{ message: string, threadId: string, modelConfig: ModelConfig }`  | Initiates an agent execution turn                                       |
| `agent:stream:${streamId}`       | Main -> Renderer | `{ type: 'token' \| 'tool_call' \| 'reasoning', content: string }` | Streams tokens and reasoning traces for dynamic per-request stream UUID |
| `agent:stream:${streamId}:end`   | Main -> Renderer | `void`                                                             | Signals stream completion                                               |
| `agent:stream:${streamId}:error` | Main -> Renderer | `{ error: string }`                                                | Emits stream-level execution error                                      |
| `dialog:openFile`                | Renderer -> Main | `void` -> `{ canceled: boolean, filePaths: string[] }`             | Opens native project file picker (`.cagent`)                            |
| `dialog:createFile`              | Renderer -> Main | `void` -> `{ canceled: boolean, filePath?: string }`               | Opens native file save dialog to create `.cagent`                       |
| `file:openPath`                  | Renderer -> Main | `{ filePath: string }`                                             | Mounts and opens project archive                                        |
| `config:save`                    | Renderer -> Main | `{ config: Partial<AppConfig> }`                                   | Persists user configuration intent and provider settings                |
| `config:check-key`               | Renderer -> Main | `{ provider: string }` -> `boolean`                                | Checks key presence in OS vault without leaking plaintext               |
| `config:set-tool-api-key`        | Renderer -> Main | `{ keyName: string, apiKey: string }`                              | Encrypts and saves tool API key via OS `safeStorage`                    |

---

## 5. Agent Tool Interface Specifications (`src/collaragent/tools`)

Workspace tools provide the ReAct agent with atomic, deterministic operations over the workspace.

### 5.1 Document Management Tools

#### 1. `readDocument`

Reads the block structure, identity mapping, and comments of a document with pagination and targeted anchoring support.

- **Input Parameters (Zod)**:
  ```typescript
  export const ReadDocumentInputSchema = z.object({
    instanceName: z.string().optional().describe('The name or UUID of the document to read.'),
    instanceId: z.string().optional().describe('Direct instance UUID.'),
    projectName: z.string().optional().describe('Optional project name to disambiguate.'),
    offset: z.number().optional().describe('Zero-based starting block offset for pagination.'),
    limit: z.number().optional().describe('Maximum number of blocks to return.'),
    outlineOnly: z
      .boolean()
      .optional()
      .describe('If true, returns only heading blocks for high-level structure.'),
    targetBlockId: z
      .string()
      .optional()
      .describe('Anchor block ID to center the read window around.'),
    radius: z
      .number()
      .optional()
      .describe('Number of contextual blocks before and after targetBlockId.')
  })
  ```
- **Return Type (`ReadDocumentResult`)**:
  ```typescript
  export interface ReadDocumentResult {
    status: 'success'
    action: 'Read'
    instanceName: string
    projectName?: string
    editable_blocks: Array<{
      id: string // Persistent UUID (e.g. "b7a2-...")
      html: string // Clean HTML without data-block-id attributes
    }>
    comments: CommentItem[]
  }
  ```
- **Error Invariants**:
  - Throws `WORKSPACE_INSTANCE_NOT_FOUND` if the instance name or ID cannot be resolved.
  - Throws `WORKSPACE_BLOCK_IDENTITY_MISSING` if any block in the payload lacks a valid string `id`.
  - Throws `WORKSPACE_PAYLOAD_INVALID` if the document blocks structure is not an array.

#### 2. `editDocument`

Performs atomic block updates, insertions, deletions, or targeted substring text replacements with staged proposal tracking and unified diff generation.

- **Input Parameters (Zod)**:
  ```typescript
  export const EditDocumentInputSchema = z.object({
    instanceId: z.string().optional().describe('Target document instance UUID.'),
    instanceName: z.string().optional().describe('Target document name.'),
    projectName: z.string().optional().describe('Target project name.'),
    allowUnresolvedLinks: z
      .boolean()
      .optional()
      .describe('Allow wiki links that do not yet exist.'),
    operations: z
      .array(
        z.object({
          action: z.enum(['update', 'insert', 'delete', 'replace_text']).describe('Edit action.'),
          blockId: z
            .string()
            .describe('Target block ID to update, delete, replace text, or anchor against.'),
          anchor: z.enum(['before', 'after']).optional().describe('Anchor position for insert.'),
          newHtml: z.string().optional().describe('HTML string for update or insert.'),
          target: z
            .string()
            .optional()
            .describe('Exact substring to find when action is replace_text.'),
          replacement: z
            .string()
            .optional()
            .describe('Replacement string when action is replace_text.')
        })
      )
      .describe('Ordered sequence of atomic document editing operations.'),
    explanation: z.string().optional().describe('Human-readable description of the proposed edits.')
  })
  ```
- **Unified Diff Output**:
  Every successful `editDocument` execution returns a structured unified diff:
  ```text
  [diff_block_start]
  @@ -2,3 +2,3 @@
   <p>Original unmodified text.</p>
  -<p>Old paragraph content.</p>
  +<p>Updated paragraph content with revised citations.</p>
   <p>Next paragraph.</p>
  [diff_block_end]
  ```

#### 3. `createDocument`

Creates a brand new document instance with initial HTML content.

- **Input Parameters (Zod)**:
  ```typescript
  export const CreateDocumentInputSchema = z.object({
    html_content: z.string().describe('Initial HTML or Markdown content.'),
    instanceName: z.string().describe('Display name of the new document.'),
    instanceId: z.string().optional().describe('Optional custom UUID.'),
    projectName: z.string().optional().describe('Target project name.'),
    allowUnresolvedLinks: z.boolean().optional().describe('Allow wiki links that do not yet exist.')
  })
  ```

### 5.2 Graph Canvas & Spatial Modeling Tools

Agent tools for visual canvas management are individually registered tools in `WorkspaceTools.ts`:

- **`writeGraph`**: Replaces or updates the graph canvas structure using declarative nodes, links, and layout specifications (`WriteGraphSpec`).
- **`writeMindMap`**: Ingests hierarchical tree nodes to automatically generate radial or tree mind maps on the canvas.
- **`readGraph`**: Reads canvas nodes, relationships, and layout properties for a specified canvas instance.

Each mutation tool accepts:

- `instanceName` _(string)_: Target canvas instance name or UUID.
- `instanceId` _(optional, string)_: Direct instance UUID.
- `projectName` _(optional, string)_: Scoped project name.
- `staged` _(optional, boolean)_: Whether to buffer as a staged proposal (`proposals[instanceId][threadId]`). Defaults to `false` (direct mutation).

### 5.3 LLM Wiki & Knowledge Ledger Tools (`src/collaragent/tools/wiki`)

CollarAgent provides a specialized tool suite for grounded claims, relational triple ledgers, and semantic validation:

| Tool Function      | Description                                                                                                                                                       | Read Barrier Option                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pruneLedger`      | Removes orphaned, duplicate, or unanchored triples from the relational knowledge ledger. (Ledger loading is performed via `LiveWikiWorkspaceAdapter.loadLedger`). | Supports `flushBeforeRead: true` to guarantee fresh read-after-write state. |
| `compileGraph`     | Compiles wiki document blocks and claims into knowledge graph card nodes and directional edges.                                                                   | Resolves blocks via `BlockIdPlugin` persistent UUIDs.                       |
| `lintWorkspace`    | Executes L1 structural integrity audit (`L1StructuralLinter`) for broken anchors and unreferenced claims, and L2 contradiction audits (`L2SemanticLinter`).       | Supports `flushBeforeAudit: true` to flush pending mutations before audit.  |
| `ingestSource`     | Ingests external source research into grounded document paragraphs with assigned persistent block IDs.                                                            | Commits blocks to Lexical AST.                                              |
| `queryAndFileBack` | Queries relational triples and grounded claims, returning structured evidence citations for agent reasoning.                                                      | Supports `flushBeforeRead: true`.                                           |

#### Transactional Read Barrier Contract (`WikiAdapterReadOptions`)

```typescript
export interface WikiAdapterReadOptions {
  signal?: AbortSignal
  timeoutMs?: number
  flushBeforeRead?: boolean
}
```

When `flushBeforeRead: true` is passed (or enabled by default in `LiveWikiWorkspaceAdapter`), the adapter executes `await flush(instanceId)` before reading payloads, dispatching `{ type: 'flush', instanceId, flushId }` to the WebSocket server to await disk settlement of in-flight writes.

---

## 6. Error Code Taxonomy & Diagnostic Mapping

CollarAgent enforces a centralized, typed error code taxonomy across all subsystems:

| Subsystem     | Prefix       | Example Code                       | Semantic Meaning & Recovery                                             |
| ------------- | ------------ | ---------------------------------- | ----------------------------------------------------------------------- |
| **Workspace** | `WORKSPACE_` | `WORKSPACE_INSTANCE_NOT_FOUND`     | Document or canvas does not exist. Call `listWorkspaceItems` to verify. |
|               |              | `WORKSPACE_BLOCK_IDENTITY_MISSING` | Block payload is corrupted. Save/normalize document.                    |
|               |              | `WORKSPACE_PAYLOAD_INVALID`        | Payload does not match document or canvas schema.                       |
|               |              | `WORKSPACE_STALE_BASE_VERSION`     | OCC sequence mismatch. Re-fetch current snapshot and retry.             |
| **System**    | `SYS_`       | `SYS_STORAGE_IO_ERROR`             | Disk read/write failure in storage daemon.                              |
|               |              | `SYS_UTILITY_PROCESS_CRASHED`      | Storage background process crashed; respawn required.                   |
| **Agent**     | `AGENT_`     | `AGENT_RECURSION_LIMIT_EXCEEDED`   | Subagent loop exceeded max step count (200).                            |
|               |              | `AGENT_TOOL_CALL_SCHEMA_ERROR`     | LLM generated invalid tool arguments. Retried with feedback.            |
| **Sync**      | `SYNC_`      | `SYNC_HANDSHAKE_TIMEOUT`           | WebSocket handshake failed to complete.                                 |
|               |              | `SYNC_COMMAND_VERSION_MISMATCH`    | Sequence version mismatch. Client re-requests snapshot.                 |
|               |              | `SYNC_DRAIN_ABORTED`               | Persistence drain or barrier aborted via cancellation token.            |
|               |              | `SYNC_DRAIN_PERSIST_FAILED`        | Single-flight disk persistence exhausted retry attempts.                |
|               |              | `SYNC_DRAIN_BARRIER_TIMEOUT`       | Barrier resolution exceeded configured timeout deadline.                |
|               |              | `SYNC_DRAIN_QUEUE_DISPOSED`        | Drain queue was disposed during active persistence.                     |
|               |              | `SYNC_DRAIN_PAYLOAD_INVALID`       | Payload failed schema validation prior to write.                        |
|               |              | `SYNC_DRAIN_WORKER_FAULTED`        | Drain worker entered unrecoverable fault state.                         |
| **Storage**   | `STORAGE_`   | `STORAGE_CHECKPOINT_NOT_FOUND`     | CAS snapshot blob unresolvable during restore. Fail-closed safeguard.   |
