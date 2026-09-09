# Event-Driven Serialized Drain System: System Architecture

## 1. Architectural Overview & Design Goals

The **Event-Driven Serialized Drain System** is the transactional core that coordinates real-time in-memory workspace mutations (Lexical rich-text documents, visual canvas DAG commands, and relational knowledge-graph ledger claims) and their persistent disk representation in CollarAgent's local-first architecture.

### Primary Architectural Goals:

1. **Single-Flight Serialization**: Guarantee that for any given instance (document, canvas, or ledger), at most one disk I/O operation is executing at any moment.
2. **Deterministic Barrier Synchronization**: Provide a `flush(instanceId)` barrier that allows autonomous AI agents and test harnesses to await complete disk synchronization before performing filesystem reads, eliminating read-after-write race conditions.
3. **Zero Hardcoded Timeout Delays**: Replace temporal debouncing (`setTimeout(..., 500)`) with an event-driven state machine that fires immediately when the I/O channel is idle and coalesces continuous modifications without artificial latency.
4. **End-to-End Cancellation Propagation**: Propagate `AbortSignal` through all asynchronous drain, barrier, and retry phases without dangling handles.
5. **Fail-Closed Diagnostic Taxonomy**: Eliminate unhandled timer rejections and silent failures; categorize all synchronization errors under the centralized `SYNC_` error code taxonomy with preserved error causes.

---

## 2. Level 1: System Context (C1)

The C1 diagram shows the primary human and autonomous actors collaborating within CollarAgent and interacting with the local persistence boundary.

```mermaid
flowchart TB
    %% C1 System Context Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    User["👤 Human Author / Engineer<br/>[Person]<br/>Performs real-time typing, creates canvas nodes, formats Markdown"]:::person
    Agent["🤖 Autonomous AI Co-Author<br/>[DeepAgent Runtime]<br/>Executes multi-step ReAct tool loops, inspects files, and mutates graphs"]:::person

    subgraph DesktopBoundary ["CollarAgent Application Boundary"]
        SyncSubsystem["⚡ Event-Driven Serialized Drain System<br/>[Subsystem: Node.js 22 / Electron Main]<br/>Maintains state machines, coalesces in-flight edits, and manages barriers"]:::system
        StorageUtility["🗄️ Storage Utility Process<br/>[Container: Node.js UtilityProcess]<br/>Runs Express 5 API, manages atomic JSON shards, and executes SQLite WAL transactions"]:::external
    end

    FileSystem["💾 Local Workspace Filesystem<br/>[Host OS]<br/>Stores .collar/ directory, SQLite databases, and content-addressed blobs"]:::external

    User -->|"Sends document & canvas mutations [WebSocket / JSON]"| SyncSubsystem
    Agent -->|"Enqueues changes & awaits barrier flush() [Node IPC]"| SyncSubsystem
    SyncSubsystem -->|"Dispatches serialized single-flight write [HTTP / REST]"| StorageUtility
    StorageUtility -->|"Writes atomic shards & commits WAL [POSIX File I/O]"| FileSystem
```

---

## 3. Level 2: Container Topology (C2)

The C2 diagram details the multi-process Electron boundaries, ports, and wire protocols connecting the Renderer, Main Host, and Utility Process.

```mermaid
flowchart TB
    %% C2 Container Styling
    classDef container fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef process fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef database fill:#0f766e,stroke:#115e59,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph RendererProcess ["Chromium Renderer Process [React 19 / Dockview]"]
        SyncClient["SyncClient<br/>[Component: TypeScript]<br/>Bi-directional WS sync with AbortSignal ack tracking"]:::container
        EditorUI["Lexical Rich-Text Editor<br/>[Component: React]<br/>Captures keystrokes, emits blocks & claim badges"]:::container
        CanvasUI["Visual Concept Canvas<br/>[Component: React Flow / D3]<br/>Captures node movements, edge links, and Dagre layouts"]:::container
    end

    subgraph MainProcess ["Electron Main Process [Node.js 22]"]
        WsServer["ws-server.ts<br/>[Component: WebSocketServer]<br/>Listens on dynamic port :0; routes real-time client traffic"]:::process
        DrainQueue["SerializedDrainQueue<br/>[Component: TypeScript]<br/>Per-instance single-flight queue, dirty coalescing, and barrier manager"]:::process
        RelationalLedger["RelationalLedgerStore<br/>[Component: In-Memory Graph]<br/>Maintains bidirectional relational ledger triples and cycle detection"]:::process
        DeepAgent["Agent Runtime (LangGraph)<br/>[Component: LangGraph]<br/>Executes agent tool calls with barrier flush() coordination"]:::process
    end

    subgraph UtilityProcess ["Utility Process: File Server [Node.js UtilityProcess]"]
        ExpressServer["filesystemAPI.ts<br/>[Component: Express 5 Server]<br/>Binds on dynamic port :0; normalizes payloads and handles locks"]:::process
        StorageEngine["SqliteStorageEngine<br/>[Component: better-sqlite3]<br/>Atomic transactional storage and sharded JSON storage"]:::database
    end

    EditorUI -->|"Dispatch block changes"| SyncClient
    CanvasUI -->|"Dispatch graph commands"| SyncClient
    SyncClient -->|"Bi-directional sync commands [WSS / JSON]"| WsServer
    WsServer -->|"Enqueues DrainTrigger"| DrainQueue
    WsServer -->|"Syncs document wiki claims"| RelationalLedger
    DeepAgent -->|"Awaits flush(instanceId) barrier before read [In-Memory Promise]"| DrainQueue
    DrainQueue -->|"Executes single-flight PATCH /api/instances/:id [HTTP / REST]"| ExpressServer
    ExpressServer -->|"Executes atomic write transactions [SQLite WAL / POSIX]"| StorageEngine
```

---

## 4. Level 3: Component Architecture (C3)

The C3 diagram zooms into the internal components of the `SerializedDrainQueue` subsystem within the Main Process.

```mermaid
flowchart TB
    %% C3 Component Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef core fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph DrainQueueContainer ["SerializedDrainQueue Subsystem"]
        QueueFacade["SerializedDrainQueue<br/>[Component: Gateway & Lifecycle Coordinator]<br/>Exposes enqueue(), flush(), getState(), and dispose()"]:::core

        subgraph WorkerPool ["Instance Worker Map (Map<string, InstanceDrainWorker>)"]
            WorkerA["InstanceDrainWorker (doc-1)<br/>[Component: State Machine]<br/>Owns IDLE/DRAINING/COALESCING state, active Promise, dirty flag"]:::component
            WorkerB["InstanceDrainWorker (canvas-1)<br/>[Component: State Machine]<br/>Owns IDLE/DRAINING/COALESCING state, active Promise, dirty flag"]:::component
            WorkerLedger["InstanceDrainWorker (relational-ledger)<br/>[Component: State Machine]<br/>Owns IDLE/DRAINING/COALESCING state, active Promise, dirty flag"]:::component
        end

        subgraph BarrierModule ["Barrier & Promise Coordination"]
            BarrierRegistry["TransactionalBarrierRegistry<br/>[Component: Deferred Promise Hub]<br/>Maintains waiting barrier promises; resolves on transition to IDLE"]:::component
        end

        subgraph ResilienceModule ["Resilience & Observation"]
            BackoffEngine["BackoffPolicyEngine<br/>[Component: Exponential Retry]<br/>Computes non-blocking event-driven retry intervals without thread sleep"]:::component
            LifecycleEmitter["DrainLifecycleEventEmitter<br/>[Component: Typed Event Emitter]<br/>Emits drain:started, drain:coalesced, drain:completed, drain:failed"]:::component
        end
    end

    WsServerComponent["ws-server.ts Handlers"]:::component
    HttpPersistenceClient["HttpPersistenceClient (PATCH /api/instances/:id)"]:::component

    WsServerComponent -->|"enqueue(trigger)"| QueueFacade
    WsServerComponent -->|"flush(instanceId, signal)"| QueueFacade
    QueueFacade -->|"Locates or instantiates"| WorkerPool
    WorkerA -->|"Registers barrier"| BarrierRegistry
    WorkerA -->|"Dispatches write"| HttpPersistenceClient
    HttpPersistenceClient -->|"On network error"| BackoffEngine
    WorkerA -->|"Emits telemetry"| LifecycleEmitter
    BarrierRegistry -->|"Resolves when clean"| WsServerComponent
```

### Component Responsibilities:

- **`SerializedDrainQueue` (Gateway - `ISerializedDrainQueue`)**: The central access point. Routes triggers to per-instance workers, manages worker lifecycle (instantiation, clean eviction via `evict(instanceId)` or `trigger:instance_deleted` to prevent memory leaks), and coordinates global or per-instance `flush(instanceId?, options?: FlushOptions)` barriers.
- **`InstanceDrainWorker` (State Machine Engine - `IInstanceDrainWorker`)**: Owns the lifecycle for a single instance. Maintains the active drain promise, current in-memory `InstancePayload` (supporting rich-text `DocumentPayload`, canvas `GraphCanvasDTO`, and relational ledger edges), dirty bit, and failure retry counter.
- **`TransactionalBarrierRegistry` (`ITransactionalBarrierRegistry`)**: Manages collections of deferred promises created by `flush()` calls with `FlushOptions` (`AbortSignal` cancellation and optional timeout deadline). When an instance reaches the `IDLE` state with no dirty state remaining, all associated barrier promises resolve concurrently.
- **`BackoffPolicyEngine` (`IBackoffPolicyEngine`)**: Pure mathematical module calculating exponential retry delays with jitter based on `BackoffPolicyConfig`. Never calls `sleep()`; yields a retry signal used by the worker's asynchronous event loop.
- **`DrainLifecycleEventEmitter`**: Strictly typed EventEmitter broadcasting diagnostic events (`drain:started`, `drain:coalesced`, `drain:completed`, `drain:failed`, `drain:retrying`, `drain:idle`) for testing, auditing, and Langfuse/OpenTelemetry telemetry.

---

## 5. Level 4: Code & Detailed Dynamics (C4)

### 5.1 Finite State Machine: `InstanceDrainWorker`

```mermaid
stateDiagram-v2
    [*] --> IDLE : Worker Initialized

    IDLE --> DRAINING : trigger:mutation [isDirty := false] / executeWrite()

    DRAINING --> COALESCING : trigger:mutation [isDirty := true, snapshot updated]
    COALESCING --> COALESCING : trigger:mutation [snapshot updated]

    DRAINING --> IDLE : writeCompleted [isDirty == false] / resolveBarriers()

    COALESCING --> DRAINING : writeCompleted [isDirty == true] / isDirty := false, executeWrite()

    DRAINING --> RETRYING : writeFailed [retries < maxRetries] / scheduleRetry()
    RETRYING --> DRAINING : retryTriggered / executeWrite()

    RETRYING --> FAULTED : maxRetriesExceeded / rejectBarriers(SyncError)
    FAULTED --> IDLE : reset() / clearDirty()

    IDLE --> [*] : dispose()
```

### State Machine Transition Rules:

| Current State               | Inbound Trigger / Event                        | Guard Condition            | Next State       | Action / Side Effect                                                                                |
| :-------------------------- | :--------------------------------------------- | :------------------------- | :--------------- | :-------------------------------------------------------------------------------------------------- |
| **`IDLE`**                  | `trigger:mutation` / `trigger:document_edit`   | None                       | **`DRAINING`**   | Set `isDirty = false`, store latest snapshot, launch active write promise.                          |
| **`IDLE`**                  | `trigger:canvas_snapshot`                      | None                       | **`DRAINING`**   | Set `isDirty = false`, store latest `GraphCanvasDTO` snapshot, launch active write promise.         |
| **`IDLE`**                  | `trigger:flush_barrier`                        | `isDirty == false`         | **`IDLE`**       | Immediately resolve barrier promise (already consistent).                                           |
| **`DRAINING`**              | `trigger:mutation` / `trigger:canvas_snapshot` | Active write in-flight     | **`COALESCING`** | Set `isDirty = true`, overwrite in-memory pending snapshot with latest payload.                     |
| **`DRAINING`**              | `trigger:flush_barrier`                        | None                       | **`DRAINING`**   | Register deferred promise in barrier registry for current cycle.                                    |
| **`DRAINING`**              | `writeCompleted`                               | `isDirty == false`         | **`IDLE`**       | Resolve all registered barrier promises; emit `drain:completed`.                                    |
| **`DRAINING`**              | `writeCompleted`                               | `isDirty == true`          | **`DRAINING`**   | Reset `isDirty = false`; immediately trigger new write promise with coalesced payload.              |
| **`DRAINING`**              | `writeFailed`                                  | `retryCount < maxRetries`  | **`RETRYING`**   | Increment `retryCount`; schedule next event-driven retry; emit `drain:failed` and `drain:retrying`. |
| **`COALESCING`**            | `trigger:mutation` / `trigger:canvas_snapshot` | None                       | **`COALESCING`** | Update latest in-memory payload (coalesce newest state).                                            |
| **`COALESCING`**            | `writeCompleted`                               | None                       | **`DRAINING`**   | Active write resolved; reset `isDirty = false`; fire next write immediately.                        |
| **`RETRYING`**              | `retryTriggered`                               | None                       | **`DRAINING`**   | Dispatch write attempt to storage HTTP API.                                                         |
| **`RETRYING`**              | `maxRetriesExceeded`                           | `retryCount >= maxRetries` | **`FAULTED`**    | Reject all waiting barriers with `SYNC_DRAIN_PERSIST_FAILED`; emit `drain:failed`.                  |
| **`ANY (Except DISPOSED)`** | `trigger:instance_deleted` / `evict(id)`       | None                       | **`DISPOSED`**   | Reject pending barriers with `SYNC_DRAIN_QUEUE_DISPOSED`, clear in-memory buffers, teardown worker. |

---

### 5.2 Runtime Sequence Flow 1: High-Frequency Keystroke Coalescing

This sequence illustrates how continuous user typing (keystrokes A, B, C in rapid succession) is safely coalesced into exactly two single-flight writes without temporal timers.

```mermaid
sequenceDiagram
    autonumber
    actor User as Author (UI)
    participant WS as ws-server.ts
    participant Queue as SerializedDrainQueue
    participant Worker as InstanceDrainWorker
    participant Storage as Express Utility Daemon

    Note over User,Storage: User types 'A' (Queue is IDLE)
    User->>WS: { type: "update", instanceId: "doc-1", payload: "A" }
    WS->>Queue: enqueue(trigger:doc_edit, payload: "A")
    Queue->>Worker: handleTrigger("A")
    activate Worker
    Worker->>Worker: State -> DRAINING (isDirty = false)
    Worker->>Storage: PATCH /api/instances/doc-1 (Payload: "A")
    activate Storage

    Note over User,Storage: While Write "A" is in flight, User types 'B' and 'C'
    User->>WS: { type: "update", instanceId: "doc-1", payload: "B" }
    WS->>Queue: enqueue(trigger:doc_edit, payload: "B")
    Queue->>Worker: handleTrigger("B")
    Worker->>Worker: State -> COALESCING (isDirty = true, pendingPayload = "B")

    User->>WS: { type: "update", instanceId: "doc-1", payload: "C" }
    WS->>Queue: enqueue(trigger:doc_edit, payload: "C")
    Queue->>Worker: handleTrigger("C")
    Worker->>Worker: State -> COALESCING (isDirty = true, pendingPayload = "C")

    Note over User,Storage: Write "A" finishes on disk
    Storage-->>Worker: 200 OK (Write "A" Persisted)
    deactivate Storage
    Worker->>Worker: Check isDirty? YES (isDirty == true, payload == "C")
    Worker->>Worker: State -> DRAINING (isDirty = false)

    Note over User,Storage: Immediately fires Write "C" without waiting for timer
    Worker->>Storage: PATCH /api/instances/doc-1 (Payload: "C")
    activate Storage
    Storage-->>Worker: 200 OK (Write "C" Persisted)
    deactivate Storage

    Worker->>Worker: Check isDirty? NO (isDirty == false)
    Worker->>Worker: State -> IDLE
    Worker-->>Queue: drainCompleted(instanceId: "doc-1")
    deactivate Worker
```

---

### 5.3 Runtime Sequence Flow 2: Autonomous AI Agent Read Barrier (`flush()`)

This sequence illustrates how an AI Agent tool call eliminates read-after-write race conditions by awaiting `flush()` before inspecting the filesystem.

```mermaid
sequenceDiagram
    autonumber
    actor User as Author (UI)
    participant WS as ws-server.ts
    participant Queue as SerializedDrainQueue
    participant Storage as Express Utility Daemon
    participant Agent as DeepAgent Tool (Wiki Linter)
    participant FS as Local Filesystem (.collar/)

    User->>WS: { type: "update", instanceId: "doc-1", payload: "New Claim" }
    WS->>Queue: enqueue(trigger:doc_edit)
    Queue->>Storage: PATCH /api/instances/doc-1 (Active Write Started)
    activate Storage

    Note over Agent,FS: Agent executes structural audit tool
    Agent->>WS: getDocument("doc-1")
    Note over Agent,WS: Agent requests transactional barrier
    Agent->>WS: await wsHandle.flush("doc-1", { signal })
    WS->>Queue: flush("doc-1", { signal })
    Queue->>Queue: Active write in-flight? YES -> Register Barrier Promise
    activate Queue

    Note over Storage,Queue: Active write finishes
    Storage-->>Queue: 200 OK (Persisted to Disk)
    deactivate Storage
    Queue->>Queue: Check pending dirty writes? NONE
    Queue-->>WS: Barrier Promise Resolved (Disk Consistent!)
    deactivate Queue
    WS-->>Agent: flush() Completed

    Note over Agent,FS: Agent reads disk safely with 100% guaranteed fresh state
    Agent->>FS: fs.readFile(".collar/instances/doc-1.json")
    FS-->>Agent: Returns "New Claim" (Zero Stale Read!)
```

---

### 5.4 Runtime Sequence Flow 3: Error Backpressure & Non-Blocking Retry

This sequence illustrates how the system handles transient disk or network errors without blocking threads or losing data.

```mermaid
sequenceDiagram
    autonumber
    participant Worker as InstanceDrainWorker
    participant Policy as BackoffPolicyEngine
    participant Storage as Express Utility Daemon
    participant Emitter as DrainLifecycleEventEmitter

    Worker->>Storage: PATCH /api/instances/doc-1
    activate Storage
    Storage-->>Worker: 500 Internal Server Error (EACCES / Locked)
    deactivate Storage

    Worker->>Worker: State -> RETRYING
    Worker->>Policy: getNextRetryDelay(attempt: 1)
    Policy-->>Worker: Delay: 50ms (computed with jitter)
    Worker->>Emitter: emit("drain:failed", { instanceId, error, retryCount: 1 })
    Worker->>Emitter: emit("drain:retrying", { instanceId, cycleId, attempt: 1, delayMs: 50 })

    Note over Worker: Non-blocking event-driven retry trigger
    Worker->>Worker: onRetryTrigger()
    Worker->>Worker: State -> DRAINING
    Worker->>Storage: PATCH /api/instances/doc-1 (Attempt 2)
    activate Storage
    Storage-->>Worker: 200 OK (Persisted Successfully)
    deactivate Storage

    Worker->>Worker: State -> IDLE (retries reset to 0)
    Worker->>Emitter: emit("drain:completed", { instanceId, durationMs })
```
