# SQLite Storage & Migration Architecture Catalog (V4)

Welcome to the **CollarAgent V4 SQLite Storage Architecture Catalog**. This catalog documents the technical specification, database schema, and migration strategy for transitioning CollarAgent from a sharded ZIP archive format to a **single-file embedded SQLite database (WAL mode)** serving directly as the native `.cagent` project container.

---

## 1. Quick Navigation Hub

| Document                                                                                                                                                                    | Description                                                                                            | Target Audience                    |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- | :--------------------------------- |
| 📋 [**Requirements & Invariants**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/requirements.md)                                         | Functional requirements, NFR performance budgets, and core system invariants.                          | Architects, Product Managers, SREs |
| 📑 [**Hard Requirements Spec**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/spec.md)                                                    | Six-area hard requirements specification following spec-driven development.                            | Systems & Runtime Engineers, QA    |
| 🔍 [**Current ZIP Storage Bottlenecks**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/current-zip-storage-problems.md)                   | Root-cause analysis of current ZIP storage: linear scans, close stalls, and memory bloat.              | Systems & Runtime Engineers        |
| 🗄️ [**Storage Engine Design**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/storage-engine-design.md)                                    | SQLite PRAGMA configuration, C4 Level 4 ERD, DDL SQL schemas, B-Tree indexes, and compaction routines. | Backend & Database Engineers       |
| 🔄 [**Migration Plan**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/migration-plan.md)                                                  | Automated 4-phase ETL pipeline converting legacy V2/V3 ZIP archives to V4 SQLite with zero data loss.  | Systems & Runtime Engineers        |
| 📜 [**ADR-001: SQLite Project Container**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/adrs/adr-001-sqlite-embedded-project-storage.md) | Architecture Decision Record detailing context, trade-offs, evaluated alternatives, and consequences.  | Lead Architects & Stakeholders     |
| 🗺️ [**Implementation Plan**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/tasks/plan.md)                                                 | Component dependency graph, vertical slices, and architectural decisions.                              | Systems & Runtime Engineers        |
| ✅ [**Task Breakdown (Todo)**](file:///Users/goldenfung/Documents/collaragent/docs/sqlite-storage-architecture/tasks/todo.md)                                               | Granular 13-task checklist across 5 implementation phases.                                             | Systems & Runtime Engineers        |

---

## 2. C2 Container Architecture

The diagram below illustrates the updated multi-process topology. Note that the **Chromium Renderer** and **WebSocket Server** continue operating without any breaking protocol or code changes:

```mermaid
flowchart TB
    subgraph UI ["Chromium Renderer Process (React 19 + Dockview)"]
        CanvasComponent["Canvas Component<br/>(Infinite Visual Graph)"]
        LexicalEditor["Lexical Document Editor<br/>(Markdown / Math / KaTeX)"]
        ChatInterface["Co-Pilot Chat Interface<br/>(Multi-turn ReAct UI)"]
    end

    subgraph SyncRelay ["WebSocket Server (src/main/server/ws/ws-server.ts)"]
        SyncHub["Editor & Canvas Sync Hub<br/>(In-memory buffer & tab broadcast)"]
    end

    subgraph MainHost ["Electron Main Process (src/main/index.ts)"]
        WindowManager["Window & Project Session Lifecycle"]
        AgentFactory["AgentFactory & Telemetry Manager"]
        LangGraphRuntime["LangGraph ReAct Agent Runtime"]
    end

    subgraph Daemon ["UtilityProcess File Server (src/main/server/fileServer/process.ts)"]
        ExpressRouter["filesystemAPI.ts<br/>(Express Local Loopback :0)"]

        subgraph SqliteLayer ["Embedded V4 SQLite Storage Layer"]
            SqliteStore["SqliteStorageEngine<br/>(Replaces CagentStorage)"]
            SqliteSaver["SqliteCheckpointStore<br/>(Replaces FileCheckpointStore)"]
            Migrator["StorageMigrationEngine<br/>(Legacy ZIP -> SQLite V4)"]
        end
    end

    subgraph Disk ["Single Project File On Disk"]
        CagentFile["my_research.cagent<br/>(Native SQLite Database)"]
        WALFile["my_research.cagent-wal<br/>(High-Speed Append Journal)"]
    end

    CanvasComponent <-->|"WS [JSON-RPC / Diff]"| SyncHub
    LexicalEditor <-->|"WS [Update / Delta]"| SyncHub
    SyncHub -->|"HTTP PATCH /api/instances/:id"| ExpressRouter

    ChatInterface -->|"IPC [agentIPC]"| LangGraphRuntime
    LangGraphRuntime -->|"HTTP /api/persistence/checkpoints"| ExpressRouter

    ExpressRouter --> SqliteStore
    ExpressRouter --> SqliteSaver
    Migrator -.->|"Atomic Upgrade"| CagentFile

    SqliteStore -->|"ACID B-Tree Write"| WALFile
    SqliteSaver -->|"Indexed Insert (<1.5ms)"| WALFile
    WALFile -.->|"Incremental Checkpoint"| CagentFile

    classDef ui fill:#1e293b,stroke:#38bdf8,color:#f8fafc;
    classDef sync fill:#1e293b,stroke:#a855f7,color:#f8fafc;
    classDef daemon fill:#1e293b,stroke:#34d399,color:#f8fafc;
    classDef storage fill:#0f172a,stroke:#f59e0b,color:#f8fafc;
    class UI,CanvasComponent,LexicalEditor,ChatInterface ui;
    class SyncRelay,SyncHub sync;
    class Daemon,ExpressRouter,SqliteLayer,SqliteStore,SqliteSaver,Migrator daemon;
    class Disk,CagentFile,WALFile storage;
```

---

## 3. Comparative Architecture Matrix (V3 vs. V4)

| Architectural Dimension          | V3 Sharded ZIP Architecture                                    | V4 Native SQLite Architecture                           |
| :------------------------------- | :------------------------------------------------------------- | :------------------------------------------------------ |
| **Physical File Representation** | ZIP file unpacked into adjacent `<name>.collar/` directory     | **Single `.cagent` file** (SQLite database in WAL mode) |
| **Workspace Mount Time**         | $O(N)$ unpack ($3,500 - 8,000\text{ms}$)                       | **$O(1)$ direct connect ($< 15\text{ms}$)**             |
| **Window Close / Shutdown**      | $O(N)$ zip compression ($2,000 - 15,000\text{ms}$)             | **$O(1)$ connection close ($< 10\text{ms}$)**           |
| **Checkpoint Point Reads**       | Linear directory traversal of JSON files ($50 - 250\text{ms}$) | **B-Tree indexed point query ($< 1.5\text{ms}$)**       |
| **Crash Durability**             | Risk of half-written files across directory tree               | **Full ACID transactional crash recovery (WAL)**        |
| **Memory Consumption**           | Monolithic in-memory JSON state + eager card load              | **Lazy loading of document/canvas BLOBs on demand**     |
| **File Transfer & Portability**  | Single `.cagent` archive (manual re-zipping required)          | **Single `.cagent` file** (always ready to share/move)  |
| **WebSocket Server Impact**      | None                                                           | **Zero breaking changes**                               |

---

## 4. Implementation Roadmap Summary

```mermaid
gantt
    title SQLite Storage Engine & Migration Rollout
    dateFormat  YYYY-MM-DD
    section Phase 1: Database Engine
    DDL Schema & PRAGMA Setup         :p1_1, 2026-09-04, 3d
    SqliteCheckpointStore Implementation:p1_2, after p1_1, 4d
    SqliteStorageEngine Integration     :p1_3, after p1_2, 4d
    section Phase 2: Migration Engine
    Header Sniffing & Backup Logic    :p2_1, after p1_3, 2d
    ETL Ingestion & Validation Gates   :p2_2, after p2_1, 4d
    section Phase 3: Integration & QA
    UtilityProcess Process Wiring      :p3_1, after p2_2, 3d
    End-to-End Persistence Benchmarks  :p3_2, after p3_1, 3d
```
