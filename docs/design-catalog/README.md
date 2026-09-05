# CollarAgent Architecture Design Catalog

Welcome to the **CollarAgent Design Catalog**. This document serves as the master navigation hub and comprehensive architectural blueprint for the CollarAgent platform.

It is structured following the **C4 Level Architecture Model** (Context, Containers, Components, and Code/Dynamics), paired with **EventStorming domain workflows**, **inlined Mermaid visual specifications**, and formal **Architecture Decision Records (ADRs)**.

---

## Catalog Navigation Map

```
docs/design-catalog/
├── README.md                     # Master navigation hub with all embedded Mermaid diagrams
├── requirements.md               # Functional & non-functional requirements + constraints
├── api-requirements.md           # Formal API specifications (REST, WebSocket, IPC, Tool Calling)
├── core-engine-wiring.md         # Subsystem architectural wiring (Canvas, Editor, Agent Runtime)
├── c1-context/                   # Level 1: System Context
│   ├── context.mmd               # C1 System Context Diagram
│   └── big-picture-events.mmd    # Big-picture EventStorming domain timeline
├── c2-containers/                # Level 2: Container & Deployment Topology
│   ├── containers.mmd            # C2 Container Diagram (deployables, tech stack, protocols)
│   └── deployment.mmd            # Infrastructure / desktop process deployment map
├── c3-components/                # Level 3: Component Architecture (per container)
│   ├── component-main-host.mmd   # Electron Main Host & Process Orchestration
│   ├── component-utility-server.mmd # Storage Daemon & Express API
│   ├── component-renderer-ui.mmd # React 19 / Dockview / Canvas / Editor UI
│   └── component-agent-runtime.mmd # DeepAgent LangGraph Engine & Middleware
├── c4-code/                      # Level 4: Detailed Structural & Dynamic Design
│   ├── data/                     # Entity relationships & state models
│   │   ├── erd.mmd
│   │   ├── state-agent-turn.mmd
│   │   └── state-checkpoint.mmd
│   ├── flows/                    # Runtime sequence & interaction flows
│   │   ├── sequence-agent-chat-flow.mmd
│   │   ├── sequence-checkpoint-restore.mmd
│   │   └── sequence-websocket-canvas-sync.mmd
│   └── processes/                # Critical EventStorming deep dives
│       ├── process-canvas-mutation.mmd
│       ├── process-document-patch.mmd
│       └── process-websocket-state-sync.mmd
└── adrs/                         # Architecture Decision Records
    ├── adr-001-multi-process-electron-utility-daemon.md
    ├── adr-002-sharded-v3-cagent-storage-engine.md
    ├── adr-003-nominal-id-branding-for-graph-entities.md
    ├── adr-004-progressive-disclosure-agent-skills.md
    ├── adr-005-deterministic-inverse-command-rollback.md
    ├── adr-006-large-tool-output-eviction-protocol.md
    ├── adr-007-websocket-staged-proposal-protocol.md
    └── adr-008-hierarchical-leiden-clustering-and-spatial-layout.md
```

> [!NOTE]
> **Evaluation & Telemetry Architecture Catalog**: The deterministic evaluation suite, OpenTelemetry/Langfuse tracing, metrics taxonomy, and evaluation ADRs are organized in a dedicated catalog under [docs/evaluations/](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/README.md).

---

## 1. Requirements & Core Subsystem Specifications

- **System Requirements & Constraints**: Refer to [requirements.md](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/requirements.md) for functional requirements, quality attributes, and architectural constraints.
- **API & Protocol Specifications**: Refer to [api-requirements.md](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/api-requirements.md) for REST endpoints, WebSocket message taxonomy, Electron IPC contracts, and Workspace Tool schemas.
- **Core Engine Subsystem Wiring**: Refer to [core-engine-wiring.md](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/core-engine-wiring.md) for detailed end-to-end wiring, sequence flows, block identity weakmaps, and staging proposal mechanics connecting Graph Canvas, Document Editor, and ReAct Agent Tool Calling.
- **Evaluation & Telemetry Catalog**: Refer to [docs/evaluations/README.md](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/README.md) for the evaluation harness and telemetry architecture.

---

## 2. Level 1: System Context (C1)

The **System Context** establishes the boundaries of CollarAgent, the primary human users, and external integrations with cloud LLMs, MCP servers, and local storage.

### 2.1 System Context Diagram

```mermaid
flowchart TB
    %% C1 System Context Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    User["👤 Knowledge Worker / Engineer<br/>[Person]<br/>Creates projects, crafts documents, designs graph models, and directs AI agents"]:::person

    subgraph SystemBoundary ["CollarAgent Desktop Platform"]
        CollarAgentApp["🏢 CollarAgent<br/>[Software System]<br/>Local-first desktop agent environment providing interactive canvas, rich text editor, multi-agent orchestration, and project time-travel"]:::system
    end

    LocalFS["💾 Local Filesystem<br/>[Host OS]<br/>Stores .cagent SQLite databases (WAL mode), skills, and configuration vaults"]:::external
    LLMProviders["🧠 LLM Cloud Providers<br/>[External Systems: OpenAI, Anthropic, Google, Ollama]<br/>Executes generative completions, reasoning traces, and function calling"]:::external
    MCPServers["🔌 Model Context Protocol (MCP) Servers<br/>[External Processes / Remote Servers]<br/>Provides external tools, filesystem access, and domain integrations via STDIO/SSE"]:::external
    SearchGateway["🌐 Web Search Gateway<br/>[External API: Tavily]<br/>Performs live internet queries and web intelligence gathering"]:::external

    User -->|"Interacts via UI, Canvas, Editor, and Chat [Desktop GUI]"| CollarAgentApp
    CollarAgentApp -->|"Reads & writes local archives, skills, and encrypted keys [POSIX FS]"| LocalFS
    CollarAgentApp -->|"Dispatches prompts & receives streaming completions [HTTPS / REST]"| LLMProviders
    CollarAgentApp -->|"Discovers & executes external tool schemas [STDIO / SSE / JSON-RPC]"| MCPServers
    CollarAgentApp -->|"Fetches real-time web search results [HTTPS / REST]"| SearchGateway
```

### 2.2 Big-Picture Domain EventStorming

```mermaid
flowchart LR
    %% EventStorming Semantic Styling
    classDef event fill:#ff9800,stroke:#e65100,color:#000
    classDef command fill:#2196f3,stroke:#0d47a1,color:#fff
    classDef actor fill:#ffeb3b,stroke:#f57f17,color:#000
    classDef system fill:#9c27b0,stroke:#4a148c,color:#fff
    classDef aggregate fill:#4caf50,stroke:#1b5e20,color:#fff
    classDef policy fill:#e91e63,stroke:#880e4f,color:#fff
    classDef hotspot fill:#f44336,stroke:#b71c1c,color:#fff

    User[👤 Knowledge Worker]:::actor

    %% 1. Workspace Initialization
    CmdCreateWS[Create Workspace]:::command
    EvtWSCreated[Workspace Created]:::event
    AggWS[Workspace Aggregate]:::aggregate
    PolInitWS[Whenever Workspace Created -> Initialize SQLite Database]:::policy
    SysUtility[Storage Utility Process]:::system

    User --> CmdCreateWS
    CmdCreateWS --> EvtWSCreated
    EvtWSCreated --> AggWS
    AggWS --> SysUtility
    EvtWSCreated --> PolInitWS

    %% 2. User Editing & Visual Modeling
    CmdAddNode[Add Card Node / Connect]:::command
    EvtCanvasMutated[Canvas State Mutated]:::event
    AggGraph[Graph Aggregate]:::aggregate
    PolBroadcast[Whenever Canvas Mutated -> Broadcast via WebSocket]:::policy
    SysWSServer[In-Process WS Server]:::system

    User --> CmdAddNode
    CmdAddNode --> EvtCanvasMutated
    EvtCanvasMutated --> AggGraph
    AggGraph --> SysWSServer
    EvtCanvasMutated --> PolBroadcast

    %% 3. Agent Invocation & Turn Execution
    CmdSendPrompt[Submit Agent Prompt]:::command
    EvtPromptSent[Prompt Submitted]:::event
    SysLLM[LLM Cloud Provider]:::system

    User --> CmdSendPrompt
    CmdSendPrompt --> EvtPromptSent
    EvtPromptSent --> SysLLM

    %% 4. Post-Turn Checkpoint & Bundle Capture
    EvtTurnFinished[Assistant Turn Finished]:::event
    PolPostTurnCheck[Whenever Turn Finished -> Capture Post-Turn Checkpoint]:::policy
    EvtCheckSaved[Checkpoint Bundle Captured]:::event
    AggCheck[Checkpoint Aggregate]:::aggregate

    EvtTurnFinished --> PolPostTurnCheck
    PolPostTurnCheck --> EvtCheckSaved
    EvtCheckSaved --> AggCheck

    %% 4. Agent Tool Execution & Staged Proposals
    EvtPromptSent --> SysLLM
    SysLLM --> EvtToolCalled[Agent Tool Call Emitted]:::event
    CmdStageProp[Stage Workspace Proposal]:::command
    EvtPropStaged[Workspace Proposal Staged]:::event
    AggProposal[Proposal Review Aggregate]:::aggregate
    HotspotConflict[? Concurrent Local & Agent Edit Conflict]:::hotspot

    EvtToolCalled --> CmdStageProp
    CmdStageProp --> EvtPropStaged
    EvtPropStaged --> AggProposal
    EvtPropStaged -.conflict.- HotspotConflict

    %% 5. Proposal Acceptance & Commit
    CmdAccept[Accept Changes]:::command
    EvtPropCommitted[Proposal Committed to Graph]:::event
    User --> CmdAccept
    CmdAccept --> EvtPropCommitted
    EvtPropCommitted --> AggGraph

    %% 6. Time-Travel Restore
    CmdRestore[Restore Checkpoint]:::command
    EvtQuiesced[Workspace Quiesced]:::event
    EvtStateRestored[Workspace State & Chat Head Restored]:::event
    PolResume[Whenever Restored -> Resume Sync & Refresh UI]:::policy

    User --> CmdRestore
    CmdRestore --> EvtQuiesced
    EvtQuiesced --> EvtStateRestored
    EvtStateRestored --> AggCheck
    EvtStateRestored --> PolResume
```

---

## 3. Level 2: Containers (C2)

The **Container** diagram decomposes the system into separately runnable processes and stores, defining explicit network and IPC protocols.

### 3.1 Container Topology Diagram

```mermaid
flowchart TB
    %% C2 Container Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef container fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    User["👤 Desktop User<br/>[Person]"]:::person

    subgraph DesktopProcessBoundary ["CollarAgent Application Boundary (Electron Multi-Process)"]

        RendererUI["💻 Renderer Process (Chromium)<br/>[Container: React 19 / Vite / Tailwind v4 / Dockview]<br/>Renders 3-pane layout, graph canvas, Lexical editor, streaming chat, and state trees"]:::container

        PreloadBridge["🔒 Preload Security Bridge<br/>[Container: contextBridge / AsyncGenerators]<br/>Provides isolated, typed IPC channels and stream unbuffering"]:::container

        MainHost["⚙️ Main Host Process<br/>[Container: Node.js / Electron Main]<br/>Manages window lifecycle, secure storage vault, agent factory, and IPC routing"]:::container

        WSServer["⚡ In-Process WebSocket Server<br/>[Container: Node.js / ws]<br/>Per-window real-time synchronization server for editor diffs and canvas commands"]:::container

        UtilityServer["🗄️ Storage Utility Process (Daemon)<br/>[Container: Node.js / Express 5]<br/>Per-workspace background worker hosting REST API, SqliteStorageEngine, and SqliteCheckpointStore"]:::container

        LocalVault[("🔐 Secure Storage Vault<br/>[Host: OS Keychain / DPAPI / Secret Service]<br/>Stores encrypted LLM and Tavily API keys (~/.collaragent/secrets.json)")]:::database

        ProjectStore[("📦 Embedded SQLite Database (.cagent in WAL Mode)<br/>[Container: better-sqlite3 + MessagePack]<br/>Stores relational schema, instance BLOBs, indexed checkpoints, and chat history")]:::database
    end

    ExternalLLM["🧠 LLM Cloud APIs<br/>[External: OpenAI / Anthropic / Gemini / Ollama]"]:::external
    ExternalMCP["🔌 External MCP Servers<br/>[External: STDIO / SSE / HTTP]"]:::external

    User -->|"Interacts via Mouse, Keyboard, Drag & Drop"| RendererUI
    RendererUI -->|"Invokes typed APIs & receives stream chunks"| PreloadBridge
    PreloadBridge -->|"Bi-directional IPC [Electron IPC]"| MainHost
    RendererUI <-->|"Bi-directional State Sync & Proposal Diffs [WebSocket / JSON-RPC]"| WSServer
    RendererUI -->|"Queries instances, sessions & snapshots [HTTP / REST :fsPort]"| UtilityServer

    MainHost -->|"Forks & supervises via parentPort [Node IPC]"| UtilityServer
    MainHost -->|"Spawns & triggers flush [In-Memory Call]"| WSServer
    MainHost -->|"Encrypts / decrypts API credentials [safeStorage]"| LocalVault
    MainHost -->|"Streams agent completions & tool calls [HTTPS / REST]"| ExternalLLM
    MainHost -->|"Spawns sub-processes & discovers tools [STDIO / SSE]"| ExternalMCP

    UtilityServer -->|"Executes atomic transactions & B-Tree indexed queries [better-sqlite3]"| ProjectStore
```

### 3.2 Desktop Process Deployment Topology

```mermaid
flowchart TB
    %% Deployment Styling
    classDef node fill:#1e293b,stroke:#3b82f6,color:#fff,stroke-width:2px;
    classDef process fill:#0f172a,stroke:#64748b,color:#fff;
    classDef file fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef cloud fill:#475569,stroke:#94a3b8,color:#fff;

    subgraph HostOS ["🖥️ Host Operating System (macOS / Windows / Linux)"]

        subgraph ElectronApp ["Electron Runtime (v43)"]

            subgraph MainProc ["Main Process [Node.js Runtime]"]
                HostMain["index.js / WindowManager<br/>• AgentFactory & LangGraph<br/>• SecureStorage & Config<br/>• In-Process WS Server (:wsPort)"]:::process
            end

            subgraph RendererProc ["BrowserWindow Process [Chromium]"]
                WebUI["Renderer SPA (React 19)<br/>• Dockview & Infinite Canvas<br/>• Lexical CardEditor<br/>• Web Worker (Leiden Clustering)"]:::process
            end

            subgraph UtilityProc ["UtilityProcess (Forked Node.js Daemon)"]
                Daemon["process.js<br/>• Express 5 REST API (:fsPort)<br/>• SqliteStorageEngine<br/>• SqliteCheckpointStore<br/>• WAL Engine & Lock Manager"]:::process
            end
        end

        subgraph LocalDisk ["Host Filesystem & OS Vault"]
            ConfigDir["~/.collaragent/<br/>• config.json<br/>• secrets.json (safeStorage 0o600)<br/>• window-state.json"]:::file
            SkillsDir["~/.deepagents/skills/<br/>• SKILL.md bundles"]:::file
            ProjectDir["Single-File SQLite Workspace (*.cagent / *.cagent.lock)<br/>• WAL Journal (*-wal, *-shm)<br/>• Relational Tables & BLOBs<br/>• B-Tree Checkpoint Index"]:::file
        end
    end

    subgraph CloudServices ["External Cloud Infrastructure"]
        OpenAICloud["OpenAI API [HTTPS]"]:::cloud
        AnthropicCloud["Anthropic API [HTTPS]"]:::cloud
        GoogleCloud["Google GenAI API [HTTPS]"]:::cloud
        TavilyAPI["Tavily Search API [HTTPS]"]:::cloud
    end

    RendererProc <-->|"contextBridge IPC"| MainProc
    RendererProc <-->|"WebSocket [ws://127.0.0.1:wsPort]"| HostMain
    RendererProc -->|"REST API [http://127.0.0.1:fsPort]"| Daemon
    MainProc <-->|"Node parentPort IPC"| Daemon

    MainProc -->|"Reads/Writes"| ConfigDir
    MainProc -->|"Reads"| SkillsDir
    Daemon -->|"Atomic Transactions & WAL Checkpoints"| ProjectDir

    MainProc -->|"Streams Prompts/Completions"| OpenAICloud
    MainProc -->|"Streams Prompts/Completions"| AnthropicCloud
    MainProc -->|"Streams Prompts/Completions"| GoogleCloud
    MainProc -->|"Queries Search"| TavilyAPI
```

---

## 4. Level 3: Components (C3)

### 4.1 Electron Main Host Process (`src/main`)

```mermaid
flowchart TB
    %% C3 Main Host Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph MainProcessHost ["Electron Main Process Host"]
        WinMgr["🪟 WindowManager<br/>[Component]<br/>Manages BrowserWindows, linked utility processes, and WS servers"]:::component
        ConfigMgr["⚙️ ConfigManager & SecureStorage<br/>[Component]<br/>Manages ~/.collaragent/config.json and OS safeStorage secrets"]:::component
        ModelMgr["🧠 ModelManager<br/>[Component]<br/>Catalog of supported LLMs, parameters, and context limits"]:::component
        AgentFac["🏭 AgentFactory<br/>[Component]<br/>Compiles DeepAgent instances with cached model clients and tools"]:::component
        MCPLoader["🔌 MCPLoader<br/>[Component]<br/>Manages MultiServerMCPClient, STDIO subprocesses, and tool caching"]:::component
        IPCRouter["📡 IPC Handlers Router<br/>[Component]<br/>Dispatches agent, checkpoint, config, file, and skill IPC requests"]:::component
        StreamCtrl["🌊 StreamController<br/>[Component]<br/>Throttles token/reasoning streams and chunks IPC pushes"]:::component
        CheckOrch["⏱️ CheckpointOrchestrator<br/>[Component]<br/>Coordinates multi-domain snapshots (Agent + Workspace + Chat + Files)"]:::component
    end

    subgraph ExternalContainers ["Adjacent Containers"]
        RendererUI["💻 Renderer Process (Chromium)"]:::external
        UtilityServer["🗄️ Storage Utility Process (Express 5)"]:::external
        LocalVault[("🔐 OS Secure Storage Vault")]:::database
    end

    RendererUI -->|"IPC Invocations"| IPCRouter
    IPCRouter -->|"Loads/Saves configuration"| ConfigMgr
    IPCRouter -->|"Queries model specs"| ModelMgr
    ConfigMgr -->|"Encrypts/Decrypts keys"| LocalVault
    IPCRouter -->|"Instantiates runtime agents"| AgentFac
    AgentFac -->|"Connects external tool servers"| MCPLoader
    IPCRouter -->|"Streams execution output"| StreamCtrl
    StreamCtrl -->|"IPC Push Chunks"| RendererUI
    IPCRouter -->|"Triggers unified snapshot/restore"| CheckOrch
    CheckOrch -->|"Persists checkpoints over REST"| UtilityServer
    WinMgr -->|"Supervises via parentPort"| UtilityServer
```

---

### 4.2 Storage Utility Daemon Process (`src/main/server/fileServer`)

```mermaid
flowchart TB
    %% C3 Utility Server Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph UtilityProcessDaemon ["Storage Utility Process (Daemon)"]
        ProcEntry["🚪 process.ts / ParentPort Handler<br/>[Component]<br/>Sniffs format, runs migrations, manages <10ms WAL truncate lifecycle"]:::component
        FSApi["🌐 Filesystem API (Express 5)<br/>[Component]<br/>Zod-validated REST router for instances, checkpoints, chat history & projects"]:::component
        SqliteEngine["🗄️ SqliteStorageEngine<br/>[Component]<br/>IStorageEngine implementation: lazy MessagePack BLOBs, granular chat, snapshots"]:::component
        CheckpointStore["⏱️ SqliteCheckpointStore<br/>[Component]<br/>ICheckpointStore: B-Tree point queries (<1.5ms), 3-turn writes pruning, ADR-006"]:::component
        DbManager["💾 SqliteDatabase<br/>[Component]<br/>better-sqlite3 connection, WAL mode, PRAGMAs, migrations & transactions"]:::component
        LockManager["🔒 ProjectLockManager<br/>[Component]<br/>Single-writer <path>.cagent.lock with dead PID auto-recovery"]:::component
        MigrationEngine["📦 StorageMigrationEngine<br/>[Component]<br/>Non-destructive V2/V3 to V4 ETL pipeline with 5 integrity verification gates"]:::component
    end

    subgraph ExternalContainers ["Adjacent Containers"]
        MainHost["⚙️ Main Host Process"]:::external
        RendererUI["💻 Renderer Process (Chromium)"]:::external
        ProjectDb[("📦 Single-File SQLite Database (.cagent in WAL Mode)")]:::database
    end

    MainHost -->|"ParentPort Messages (start, prepare-close)"| ProcEntry
    RendererUI -->|"REST HTTP Queries (:fsPort)"| FSApi

    ProcEntry -->|"Acquires / Releases Lock"| LockManager
    ProcEntry -->|"Executes ETL if V2/V3 detected"| MigrationEngine
    ProcEntry -->|"Initializes & Configures"| FSApi
    ProcEntry -->|"Flushes WAL & closes (<10ms)"| DbManager

    FSApi -->|"Delegates instance & chat persistence"| SqliteEngine
    FSApi -->|"Delegates LangGraph checkpoints"| CheckpointStore

    MigrationEngine -->|"Migrates into staging DB"| DbManager
    SqliteEngine -->|"Executes SQL queries & BLOB packs"| DbManager
    CheckpointStore -->|"Executes indexed queries & writes"| DbManager

    DbManager -->|"better-sqlite3 WAL read/write transactions"| ProjectDb
    LockManager -->|"Creates / removes .lock file"| ProjectDb
```

---

### 4.3 Renderer UI & Workspace Engine (`src/renderer` & `src/workspace`)

```mermaid
flowchart TB
    %% C3 Renderer UI Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef store fill:#0d9488,stroke:#115e59,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph RendererWorkspaceBoundary ["Renderer UI & Workspace Engine"]

        subgraph StateLayer ["State Management & Contexts"]
            ChatStore["📦 useChatStore (Zustand)<br/>[Store]<br/>Thread-keyed messages, stream chunks, reasoning traces, subagent tasks"]:::store
            ConfigStore["📦 useConfigStore (Zustand)<br/>[Store]<br/>Cached application configuration, models, and tool settings"]:::store
            SessionCtx["🌐 ProjectSessionContext<br/>[Context]<br/>Resolves apiPort/wsPort, manages session lifecycle & reload sockets"]:::store
            InstanceCtx["📑 InstanceContext<br/>[Context]<br/>TanStack Query cache & live /ws/instances watcher"]:::store
            CanvasStore["🎨 CanvasProvider (useReducer)<br/>[Reducer Store]<br/>Manages Domain, Layout, UI, and History undo/redo stacks"]:::store
        end

        subgraph ViewLayer ["Visual Component Tree"]
            DockviewHost["🗔 Workspace (Dockview)<br/>[Component]<br/>Multi-dock tabbed container hosting Canvas, Document, and Skill views"]:::component

            subgraph CanvasView ["Graph Canvas Subsystem"]
                CanvasViewport["🖼️ Canvas Viewport<br/>[Component]<br/>SVG cubic bezier edge layer, pan/zoom engine, and node renderer"]:::component
                CanvasNodeComp["🔲 CanvasNode<br/>[Component]<br/>4-cardinal port handles (N, E, S, W), title editor, resize handles"]:::component
                MemoEditor["📝 MemoEditor (Lexical)<br/>[Component]<br/>Compact markdown editor embedded within canvas cards"]:::component
                LeidenWorker["🔬 Leiden Clustering Engine<br/>[Web Worker]<br/>Hierarchical community detection and automatic graph partitioning"]:::component
            end

            subgraph DocumentView ["Rich Document Subsystem"]
                CardEditor["📄 CardEditor (Lexical)<br/>[Component]<br/>Full document editor: typography, GFM tables, math (KaTeX), code blocks"]:::component
                DocxExporter["📑 DocxExporter<br/>[Component]<br/>Compiles DocumentPayload block AST directly into Word (.docx)"]:::component
            end

            subgraph ChatView ["Agent Chat & Streaming Subsystem"]
                ChatEngine["💬 Chat Engine<br/>[Component]<br/>Streaming lifecycle manager, mention popover (@), checkpoint markers"]:::component
                MessageListComp["📜 MessageList<br/>[Component]<br/>Renders reasoning cards, tool call diffs, and token metrics"]:::component
                SubagentPane["🤖 SubagentStreamPane<br/>[Component]<br/>Dedicated slide-in drawer for deep subagent trace inspection"]:::component
            end
        end

        subgraph SyncLayer ["Real-Time Synchronization Plugins"]
            CanvasSync["⚡ CanvasWebSocketSyncPlugin<br/>[Component]<br/>Syncs graph commands and viewport changes over /ws/canvas/:id"]:::component
            EditorSync["⚡ EditorWebSocketSyncPlugin<br/>[Component]<br/>Syncs Lexical AST, diff reviews, and staged agent proposals"]:::component
        end
    end

    SessionCtx --> InstanceCtx
    InstanceCtx --> DockviewHost
    DockviewHost --> CanvasViewport
    DockviewHost --> CardEditor
    CanvasViewport --> CanvasNodeComp
    CanvasNodeComp --> MemoEditor
    CanvasViewport -.-> LeidenWorker

    CardEditor --> DocxExporter
    ChatEngine --> MessageListComp
    ChatEngine --> SubagentPane

    ChatEngine <--> ChatStore
    CanvasViewport <--> CanvasStore
    CanvasStore <--> CanvasSync
    CardEditor <--> EditorSync
```

---

### 4.4 Agent Runtime & Tooling Architecture (`src/collaragent`)

```mermaid
flowchart TB
    %% C3 Agent Runtime Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef middleware fill:#7c3aed,stroke:#5b21b6,color:#fff;
    classDef backend fill:#059669,stroke:#047857,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph DeepAgentRuntime ["DeepAgent Execution Engine (LangGraph Core)"]

        DeepAgentFac["🤖 createDeepAgent<br/>[Runtime Factory]<br/>Assembles ReAct execution loop, middleware stack, and state reducers"]:::component

        subgraph MiddlewarePipeline ["Ordered Middleware Interceptor Stack"]
            PatchToolMW["🔧 PatchToolCallsMiddleware<br/>[Middleware]<br/>Appends synthetic cancellation ToolMessages for dangling calls"]:::middleware
            SkillsMW["📚 SkillsMiddleware<br/>[Middleware]<br/>Progressive disclosure catalog injection & on-demand skill reading"]:::middleware
            MemoryMW["🧠 Memory & AgentMemoryMiddleware<br/>[Middleware]<br/>Loads AGENTS.md, ~/.deepagents/agent.md, and project memory"]:::middleware
            FSMiddleware["📁 FilesystemMiddleware<br/>[Middleware]<br/>Filesystem tool guides, sandbox validation, large output eviction"]:::middleware
            SubAgentMW["👥 SubAgentMiddleware<br/>[Middleware]<br/>Manages task / dynamic_task delegation and state isolation"]:::middleware
            TodoMW["📋 TodoListMiddleware<br/>[Middleware]<br/>write_todos tool injection & anti-parallelism guardrails"]:::middleware
            ContextMW["✂️ ContextEditing & Summarization<br/>[Middleware]<br/>Prunes tool outputs (>100k tokens) and summarizes history (>120k)"]:::middleware
        end

        subgraph DiffAndPatchEngines ["Deterministic Mutation & Inversion Engines"]
            CanvasDiff["🎨 CanvasDiffEngine<br/>[Component]<br/>Diffs declarative GraphSpec vs current state to emit atomic CanvasCommands"]:::component
            DocDiff["📄 DocumentDiffEngine<br/>[Component]<br/>Diffs Lexical DocumentPayloads to emit atomic EditorCommands"]:::component
            PatchEngine["🧩 PatchCommandEngine<br/>[Component]<br/>Applies structured JSON patch operations against HTML patch views"]:::component
            InverseEngine["🔄 InverseCommandEngine<br/>[Component]<br/>Inverts executed workspace commands into atomic Undo commands"]:::component
        end

        subgraph StorageBackends ["Pluggable Storage Backends"]
            CompositeBE["🔀 CompositeBackend<br/>[Backend]<br/>Prefix-based router (/memories -> StoreBackend, / -> FilesystemBackend)"]:::backend
            FSBackend["💾 FilesystemBackend<br/>[Backend]<br/>POSIX disk access with virtual sandboxing and O_NOFOLLOW symlink safety"]:::backend
            StateBE["⚡ StateBackend<br/>[Backend]<br/>Ephemeral in-memory storage residing in LangGraph state (`files` channel)"]:::backend
            StoreBE["🗄️ StoreBackend<br/>[Backend]<br/>Cross-thread persistent storage backed by LangGraph BaseStore"]:::backend
        end
    end

    DeepAgentFac --> PatchToolMW
    PatchToolMW --> SkillsMW
    SkillsMW --> MemoryMW
    MemoryMW --> FSMiddleware
    FSMiddleware --> SubAgentMW
    SubAgentMW --> TodoMW
    TodoMW --> ContextMW

    FSMiddleware --> CompositeBE
    CompositeBE --> FSBackend
    CompositeBE --> StateBE
    CompositeBE --> StoreBE

    DeepAgentFac --> CanvasDiff
    DeepAgentFac --> DocDiff
    DeepAgentFac --> PatchEngine
    DeepAgentFac --> InverseEngine
```

---

## 5. Level 4: Code & Detailed Dynamics (C4)

### 5.1 Data Model (ERD)

```mermaid
erDiagram
    %% Graph Canvas Domain
    GRAPH ||--o{ NODE_ENTITY : contains
    GRAPH ||--o{ RELATIONSHIP_ENTITY : contains
    NODE_ENTITY ||--o{ PORT_ENTITY : exposes
    NODE_ENTITY ||--|| NODE_LAYOUT : positioned_by
    RELATIONSHIP_ENTITY }o--|| PORT_ENTITY : "from / to"

    %% Document AST Domain
    DOCUMENT_PAYLOAD ||--o{ BLOCK : contains
    DOCUMENT_PAYLOAD ||--o{ COMMENT : has
    BLOCK ||--o{ INLINE_RUN : renders
    BLOCK ||--o{ TABLE_ROW : organizes
    TABLE_ROW ||--o{ TABLE_CELL : contains
    TABLE_CELL ||--o{ INLINE_RUN : contains
    INLINE_RUN }o--o{ COMMENT : references

    %% Unified Checkpoint & Ledger Domain
    CHECKPOINT_BUNDLE ||--o{ INSTANCE_RESTORE_POINT : captures
    CHECKPOINT_BUNDLE ||--|| CHAT_CHECKPOINT : references
    WORKSPACE_SNAPSHOT ||--|| INSTANCE_RESTORE_POINT : targets
    WORKSPACE_COMMAND_LOG ||--|| INSTANCE_LOG_POSITION : indexed_at

    %% Entity Definitions
    GRAPH {
        GraphId id PK
        Record nodesById
        Record relationshipsById
        Record outgoingByNodeId
        Record incomingByNodeId
    }

    NODE_ENTITY {
        NodeId id PK
        string type "card"
        string name
        Record attrs "clusterId, clusterPath, tags"
    }

    PORT_ENTITY {
        PortId id PK
        Point relativePosition "x, y"
        Vector normalVector "x, y"
        string type "source | target | bi-directional"
    }

    NODE_LAYOUT {
        NodeId nodeId PK, FK
        number x
        number y
        number width
        number height
    }

    RELATIONSHIP_ENTITY {
        RelationshipId id PK
        Endpoint from "nodeId, portId"
        Endpoint to "nodeId, portId"
        Record attrs "label, weight, directional"
    }

    DOCUMENT_PAYLOAD {
        Block[] blocks
        Record comments
    }

    BLOCK {
        string id PK
        string type "h1|h2|paragraph|code|quote|table"
        string align "left|center|right|justify"
        string language
        InlineRun[] children
    }

    INLINE_RUN {
        string text
        boolean bold
        boolean italic
        string equation "LaTeX Formula"
        string[] commentIds FK
    }

    CHECKPOINT_BUNDLE {
        string id PK
        string sessionId FK
        string threadId FK
        string projectId FK
        string chatMessageId FK
        string agentCheckpointId FK
        string createdAt
        string reason "auto | restore"
        string label
    }

    INSTANCE_RESTORE_POINT {
        string instanceId PK
        string instanceType "graph-canvas | document"
        string snapshotId FK
        InstanceLogPosition targetCursor
    }

    WORKSPACE_COMMAND_LOG {
        string instanceId PK
        InstanceLogPosition cursor
        string source "ui | agent | sync"
        Command command
        Record previousState
    }
```

---

### 5.2 State Transitions

#### A. Agent Turn State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle : Application Ready
    Idle --> TurnInitializing : User submits message (@mentions attached)

    TurnInitializing --> PromptAssembling : Prepare prompt & active tool definitions
    PromptAssembling --> ModelStreaming : Inject Date, Skills catalog, Memory, Tools

    state ModelStreaming {
        [*] --> ReceivingChunks
        ReceivingChunks --> EmittingReasoning : Reasoning tokens detected
        ReceivingChunks --> EmittingContent : Text tokens detected
        ReceivingChunks --> ToolCallDetected : Structured tool call emitted
        EmittingReasoning --> ReceivingChunks
        EmittingContent --> ReceivingChunks
    }

    ModelStreaming --> EvictingLargeTool : Tool output > 20,000 tokens (~80KB)
    EvictingLargeTool --> ToolExecuting : Evict to /large_tool_results/
    ModelStreaming --> ToolExecuting : Standard tool output

    state ToolExecuting {
        [*] --> DispatchTool
        DispatchTool --> ExecutingWorkspaceTool : manageGraph / editDocument
        DispatchTool --> ExecutingFilesystemTool : read_file / write_file
        DispatchTool --> ExecutingSubagent : task / dynamic_task

        ExecutingWorkspaceTool --> StageProposal : Broadcast with staged: true
        ExecutingSubagent --> SubagentRecursion : Run isolated ReactAgent (limit 200)
        SubagentRecursion --> ReturnSynthesis : Merge final synthesis
    }

    ToolExecuting --> ModelStreaming : Tool result fed back to Model node
    ModelStreaming --> TurnCompleted : Stop token / No more tool calls
    TurnCompleted --> PostTurnCheckpointing : Commit assistant message to ChatStore & SQLite
    PostTurnCheckpointing --> Idle : window.checkpointIPC.create() & refresh CheckpointMarkers
```

#### B. Checkpoint & Time-Travel State Machine

```mermaid
stateDiagram-v2
    [*] --> ActiveEditing : Live Workspace & Agent Interaction

    ActiveEditing --> Quiescing : CheckpointCreateRequested (Manual or Auto)
    Quiescing --> SnapshotCapturing : Suppress WebSocket echo (SyncPause lock)

    state SnapshotCapturing {
        [*] --> FlushWSBuffers : wsServer.flush()
        FlushWSBuffers --> CaptureLangGraphHead : Persist ChatCheckpointSaver tuple
        CaptureLangGraphHead --> CaptureWorkspaceState : Serialize DTO & Idempotent MsgPack snapshot
        CaptureWorkspaceState --> BundleMetadata : Create CheckpointBundle record with projectId & chat.messageId
    }

    SnapshotCapturing --> ActiveEditing : Release SyncPause & resume editing

    ActiveEditing --> RestoreRequested : User clicks CheckpointMarker in Chat
    RestoreRequested --> QuiescingRestore : Freeze UI & WS syncing

    state QuiescingRestore {
        [*] --> RollbackChat : Clear session (__start__) OR truncate to messageId
        RollbackChat --> ResetBranchRegistry : agentCheckpointRegistry.setPendingBranch()
        ResetBranchRegistry --> RestoreSnapshots : Reconstitute instances from MsgPack
        RestoreSnapshots --> InvertCommandLogs : Apply InverseCommandEngine deltas
    }

    QuiescingRestore --> ActiveEditing : Broadcast state:reset to UI & resume
```

---

### 5.3 Runtime Interaction Sequences

#### Sequence 1: Agent Chat Turn & Staged Proposal Review

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant UI as 💻 Renderer (Chat / Editor)
    participant Preload as 🔒 Preload Bridge
    participant Main as ⚙️ Electron Main Host
    participant Agent as 🤖 DeepAgent Runtime
    participant WSS as ⚡ WebSocket Server
    participant ExtLLM as 🧠 External LLM Provider

    User->>UI: Types "@Canvas add auth node" & clicks Send
    UI->>UI: Append optimistic user message to useChatStore
    UI->>Preload: window.agentIPC.stream({ message, streamId, threadId })
    Preload->>Main: IPC send(AGENT_STREAM, req)
    Main->>Agent: Invoke createDeepAgent ReAct loop
    Agent->>ExtLLM: Stream prompt + injected skills catalog

    loop Token Streaming
        ExtLLM-->>Agent: Token / Reasoning chunk
        Agent-->>Main: Stream chunk
        Main-->>Preload: IPC send(agent:stream:streamId, chunk)
        Preload-->>UI: Yield AsyncGenerator chunk -> Update AgentStream UI
    end

    ExtLLM-->>Agent: ToolCall: manageGraph(action: "writeGraph", spec: {...})
    Agent->>Agent: CanvasDiffEngine computes atomic CanvasCommands
    Agent->>WSS: Broadcast command with { staged: true }
    WSS-->>UI: WebSocket push: 'graph:add_node' (staged)
    UI->>UI: Render Proposal Banner ("Agent modified canvas: 1 node added")

    ExtLLM-->>Agent: Final synthesis text
    Agent-->>Main: Turn finished & persist assistant message
    Main-->>Preload: IPC send(agent:stream:streamId:end)
    Preload-->>UI: Finalize assistant message in useChatStore

    %% Post-Turn Checkpoint Creation
    UI->>Preload: window.checkpointIPC.create({ threadId, projectId, reason: 'auto' })
    Preload->>Main: IPC invoke(CHECKPOINT_CREATE)
    Main-->>Preload: CheckpointBundleSummary { id: "chk-turn-101", projectId }
    Preload-->>UI: Checkpoint stored
    UI->>Preload: window.checkpointIPC.list({ threadId, projectId })
    Preload-->>UI: CheckpointBundles -> Render CheckpointMarker under completed turn

    User->>UI: Clicks "Accept Changes"
    UI->>WSS: WebSocket send: { type: 'accept-changes', instanceId }
    WSS-->>UI: Commit staged commands to CanvasProvider history
```

#### Sequence 2: Multi-Domain Point-in-Time Checkpoint Restore

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant UI as 💻 Renderer (Chat Timeline)
    participant Preload as 🔒 Preload Bridge
    participant Main as ⚙️ Main Host (CheckpointOrchestrator)
    participant Registry as ⏱️ AgentCheckpointRegistry
    participant Server as 🗄️ Storage Utility Process
    participant Storage as 📦 SqliteStorageEngine

    User->>UI: Clicks "Restore to this point" on CheckpointMarker
    UI->>Preload: window.checkpointIPC.restore({ threadId, bundleId })
    Preload->>Main: IPC invoke(CHECKPOINT_RESTORE)

    Main->>UI: IPC send(checkpoint:quiesce) -> Activate SyncPause mutex
    Main->>Main: abortAgentStream(threadId)
    Main->>Registry: setPendingBranch(threadId, agentCheckpointId)
    Main->>Registry: setEffective(threadId, agentCheckpointId)
    Main->>Server: POST /api/checkpoints/restore { bundleId, threadId, projectId }

    Server->>Storage: Read CheckpointBundle & target snapshot MsgPack
    Storage-->>Server: Hydrated Snapshot + Log Cursors

    alt bundle.chat.messageId === '__start__'
        Server->>Storage: Clear full chat session (clearChatSession)
    else Regular Message ID
        Server->>Storage: Truncate chat messages to bundle.chat.messageId (truncateChatSession)
    end
    Server->>Storage: Set restore head in SqliteCheckpointStore
    Server-->>UI: WebSocket broadcast: update instance & chat:restored
    Server-->>Main: Restore completed { status: "restored", bundleId }

    Main->>UI: IPC send(checkpoint:resume) -> Release SyncPause
    Main-->>Preload: Restore response
    Preload-->>UI: Success

    UI->>UI: Reload messages via ChatService.getMessages & refreshBundles()
    UI->>UI: Re-render Canvas and Lexical Editor at exact historical state
```

#### Sequence 3: WebSocket Canvas Synchronization & Staged Proposal Review

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Knowledge Worker
    participant CanvasUI as 💻 Canvas UI (CanvasWebSocketSyncPlugin)
    participant WSS as ⚡ WebSocket Server (:wsPort)
    participant AgentTool as 🤖 Agent Tool (manageGraph.ts)
    participant DiffEngine as 🎨 CanvasDiffEngine
    participant RESTServer as 🗄️ Storage Daemon (:fsPort)

    %% Step 1: Agent Invocation & Ephemeral Connection
    Note over AgentTool: LLM calls writeGraph(instanceName, spec)
    AgentTool->>WSS: Connects SyncClient to /ws/canvas/:instanceId
    AgentTool->>WSS: Send { type: 'join', clientId: 'client-xyz' }
    AgentTool->>WSS: Send { type: 'sync-request' }
    WSS-->>AgentTool: Return { type: 'sync-snapshot', graph, layout }

    %% Step 2: Diff Computation
    Note over AgentTool,DiffEngine: resolveGraphSpecIdentity (Alias -> UUID)
    AgentTool->>DiffEngine: computeDiff(currentSnapshot, resolvedSpec)
    Note over DiffEngine: 1. Remove obsolete relationships<br/>2. Remove deleted nodes<br/>3. Add new nodes + cardinal ports<br/>4. Update node attrs & layouts<br/>5. Add new relationships
    DiffEngine-->>AgentTool: Return atomic CanvasCommand[]

    %% Step 3: Staged Transmission
    Note over AgentTool: Tag commands with { staged: true }
    loop For each CanvasCommand in batch
        AgentTool->>WSS: Send { type: 'sync-command', command: { ...cmd, staged: true }, version: 1 }

        %% Step 4: Server Mutation & Staging
        WSS->>WSS: validateIncomingCanvasCommand(cmd)
        WSS->>WSS: applyCommandToDto() & capture previousState
        WSS->>WSS: proposals.get(instanceId).push({ ...cmd, previousState })
        WSS->>WSS: nextSeq = commandSequences++

        WSS-->>AgentTool: Send { type: 'sync-ack', version: nextSeq, clientVersion: 1 }

        par Real-time Broadcast & Logging
            WSS-->>CanvasUI: Broadcast { type: 'sync-command', command, version: nextSeq }
            WSS-->>CanvasUI: Broadcast { type: 'sync-changes', instanceId, commands: bufferedProposals }
            WSS->>RESTServer: POST /api/checkpoints/workspace/logs (Audit Trail)
        end
    end
    AgentTool->>AgentTool: Disconnect ephemeral SyncClient

    %% Step 5: UI Proposal Banner
    Note over CanvasUI: CanvasProvider updates visual DOM & displays Proposal Banner

    %% Step 6: User Accept/Reject
    alt User clicks "Keep" (Accept Changes)
        User->>CanvasUI: Clicks "Accept Changes"
        CanvasUI->>WSS: Send { type: 'accept-changes', instanceId, clientId }
        WSS->>WSS: proposals.delete(instanceId)
        WSS-->>CanvasUI: Broadcast { type: 'sync-changes', instanceId, commands: [] }
        WSS->>RESTServer: 500ms debouncedSave() persists committed state
    else User clicks "Undo" (Reject Changes)
        User->>CanvasUI: Clicks "Reject Changes"
        CanvasUI->>WSS: Send { type: 'reject-changes', instanceId, clientId }
        WSS->>WSS: Replay proposals in reverse using captured previousState
        WSS->>WSS: proposals.delete(instanceId)
        WSS-->>CanvasUI: Broadcast { type: 'sync-snapshot', graph, layout, from: 'agent-proposal-reverted' }
        WSS-->>CanvasUI: Broadcast { type: 'sync-changes', instanceId, commands: [] }
        WSS->>RESTServer: 500ms debouncedSave() persists restored state
    end
```

---

### 5.4 Critical Process Deep Dives

#### Process 1: Canvas Graph Spec Diffing & Execution

```mermaid
flowchart LR
    %% Process EventStorming Styling
    classDef event fill:#ff9800,stroke:#e65100,color:#000
    classDef command fill:#2196f3,stroke:#0d47a1,color:#fff
    classDef actor fill:#ffeb3b,stroke:#f57f17,color:#000
    classDef system fill:#9c27b0,stroke:#4a148c,color:#fff
    classDef aggregate fill:#4caf50,stroke:#1b5e20,color:#fff
    classDef policy fill:#e91e63,stroke:#880e4f,color:#fff
    classDef hotspot fill:#f44336,stroke:#b71c1c,color:#fff

    Agent[🤖 DeepAgent ReAct Loop]:::actor

    CmdWriteGraph[Command: writeGraph<br/>spec: WriteGraphSpec]:::command
    EvtSpecReceived[Event: GraphSpec Received]:::event
    AggDiffEngine[Aggregate: CanvasDiffEngine]:::aggregate

    PolDiff[Policy: Whenever Spec Received -> Diff vs CanvasSnapshot & Order Commands]:::policy

    EvtCmdsGenerated[Event: Atomic CanvasCommands Generated<br/>1. Remove links<br/>2. Remove nodes<br/>3. Add nodes<br/>4. Update attrs/layout<br/>5. Add links]:::event

    CmdBroadcastStaged[Command: Broadcast Staged Commands]:::command
    SysWS[System: In-Process WS Server]:::system
    EvtStagedOnUI[Event: Proposal Banner Displayed in UI]:::event

    User[👤 Knowledge Worker]:::actor
    CmdAccept[Command: Accept Changes]:::command
    EvtCommitted[Event: Changes Committed to History Stack]:::event
    AggGraph[Aggregate: Graph Aggregate]:::aggregate

    Agent --> CmdWriteGraph
    CmdWriteGraph --> EvtSpecReceived
    EvtSpecReceived --> PolDiff
    PolDiff --> AggDiffEngine
    AggDiffEngine --> EvtCmdsGenerated
    EvtCmdsGenerated --> CmdBroadcastStaged
    CmdBroadcastStaged --> SysWS
    SysWS --> EvtStagedOnUI

    User --> CmdAccept
    CmdAccept --> EvtCommitted
    EvtCommitted --> AggGraph
```

#### Process 2: Document JSON Patching & Inline Review

```mermaid
flowchart LR
    %% Process EventStorming Styling
    classDef event fill:#ff9800,stroke:#e65100,color:#000
    classDef command fill:#2196f3,stroke:#0d47a1,color:#fff
    classDef actor fill:#ffeb3b,stroke:#f57f17,color:#000
    classDef system fill:#9c27b0,stroke:#4a148c,color:#fff
    classDef aggregate fill:#4caf50,stroke:#1b5e20,color:#fff
    classDef policy fill:#e91e63,stroke:#880e4f,color:#fff
    classDef hotspot fill:#f44336,stroke:#b71c1c,color:#fff

    Agent[🤖 DeepAgent ReAct Loop]:::actor

    CmdEditDoc[Command: editDocument<br/>operations: JSONPatch[]]:::command
    EvtPatchReceived[Event: Document Patch Received]:::event
    AggPatchEngine[Aggregate: PatchCommandEngine]:::aggregate

    PolValidate[Policy: Whenever Patch Received -> Validate Block Existence & Compute Diffs]:::policy

    EvtEditorCmds[Event: Atomic EditorCommands Emitted<br/>• editor:update_block<br/>• editor:insert_block<br/>• editor:remove_block]:::event

    CmdStagedWS[Command: Stage Over WebSocket /ws/editor/:id]:::command
    SysWS[System: WebSocket Sync Engine]:::system
    EvtDiffView[Event: Visual Inline Diff Rendered in Lexical]:::event

    User[👤 Knowledge Worker]:::actor
    CmdReview[Command: Review & Commit Proposal]:::command
    EvtDocUpdated[Event: Document AST Updated & Persisted]:::event
    AggDoc[Aggregate: Document Payload Aggregate]:::aggregate

    Agent --> CmdEditDoc
    CmdEditDoc --> EvtPatchReceived
    EvtPatchReceived --> PolValidate
    PolValidate --> AggPatchEngine
    AggPatchEngine --> EvtEditorCmds
    EvtEditorCmds --> CmdStagedWS
    CmdStagedWS --> SysWS
    SysWS --> EvtDiffView

    User --> CmdReview
    CmdReview --> EvtDocUpdated
    EvtDocUpdated --> AggDoc
```

#### Process 3: WebSocket Real-Time State Sync & Staged Proposal Review

```mermaid
flowchart LR
    %% Process EventStorming Styling
    classDef event fill:#ff9800,stroke:#e65100,color:#000
    classDef command fill:#2196f3,stroke:#0d47a1,color:#fff
    classDef actor fill:#ffeb3b,stroke:#f57f17,color:#000
    classDef system fill:#9c27b0,stroke:#4a148c,color:#fff
    classDef aggregate fill:#4caf50,stroke:#1b5e20,color:#fff
    classDef policy fill:#e91e63,stroke:#880e4f,color:#fff
    classDef hotspot fill:#f44336,stroke:#b71c1c,color:#fff

    Agent[🤖 Agent Tool / Client]:::actor

    CmdSyncCmd[Command: sync-command<br/>{ command, staged: true, clientId }]:::command
    EvtCmdReceived[Event: Staged Command Received]:::event
    AggWSServer[Aggregate: WsServer In-Memory DTO]:::aggregate

    PolValidate[Policy: Whenever sync-command received -> validateCanonicalNodeId & applyCommandToDto]:::policy

    EvtStateMutated[Event: DTO Mutated & previousState Captured]:::event
    EvtBuffered[Event: Command Buffered in proposals Map]:::event

    CmdBroadcast[Command: Broadcast sync-command & sync-changes]:::command
    SysWSChannel[System: /ws/canvas/:instanceId Channel]:::system

    EvtUIReflected[Event: UI Renders New Nodes & Shows Proposal Banner]:::event
    User[👤 Knowledge Worker]:::actor

    CmdDecision[Command: accept-changes OR reject-changes]:::command
    PolResolve[Policy: If accept -> clear buffer & save; If reject -> revert via previousState & broadcast snapshot]:::policy
    EvtFinalized[Event: Workspace State Finalized & Persisted to Disk]:::event

    Agent --> CmdSyncCmd
    CmdSyncCmd --> EvtCmdReceived
    EvtCmdReceived --> PolValidate
    PolValidate --> AggWSServer
    AggWSServer --> EvtStateMutated
    EvtStateMutated --> EvtBuffered
    EvtBuffered --> CmdBroadcast
    CmdBroadcast --> SysWSChannel
    SysWSChannel --> EvtUIReflected
    User --> CmdDecision
    CmdDecision --> PolResolve
    PolResolve --> EvtFinalized
```

---

## 6. Architecture Decision Records (ADRs)

| ADR                                                                                                                                             | Title                                                                                              | Decision & Key Rationale                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-001-multi-process-electron-utility-daemon.md)             | **Multi-Process Electron Host with Forked Utility Daemons**                                        | Fork heavy project file I/O, compression, and Express REST server into independent `UtilityProcess` instances to keep the Main process and UI rendering at 60 FPS.                                                                                                   |
| [ADR-002](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-002-sharded-v3-cagent-storage-engine.md)                  | **Sharded V3 Storage Engine (Superseded by V4 SQLite Engine)**                                     | Historical V3 sharded layout (`manifest.json`, `instances/*.json`, `snapshots/*.msgpack`). Superseded by V4 single-file SQLite database with WAL journaling and B-Tree indexing.                                                                                     |
| [ADR-003](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-003-nominal-id-branding-for-graph-entities.md)            | **Nominal ID Branding for Graph Entities**                                                         | Brand `NodeId`, `RelationshipId`, `PortId`, and `GraphId` nominal types to eliminate accidental identifier cross-assignment bugs at compile time.                                                                                                                    |
| [ADR-004](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-004-progressive-disclosure-agent-skills.md)               | **Progressive Disclosure Architecture for Agent Skills**                                           | Inject only a compact YAML frontmatter catalog into system prompts; agent loads complete `SKILL.md` files on-demand via `read_file`, cutting token overhead by ~85%.                                                                                                 |
| [ADR-005](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-005-deterministic-inverse-command-rollback.md)            | **Deterministic Inverse Command Rollback Engine**                                                  | Capture `previousState` on every mutation to mathematically compute inverse commands, powering unified Undo/Redo, proposal rejection, and checkpoint restoration.                                                                                                    |
| [ADR-006](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-006-large-tool-output-eviction-protocol.md)               | **Large Tool Output Eviction Protocol**                                                            | Automatically evict tool results exceeding 20,000 tokens to `/large_tool_results/` and replace prompt messages with truncated previews to prevent LLM context exhaustion.                                                                                            |
| [ADR-007](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-007-websocket-staged-proposal-protocol.md)                | **WebSocket Real-Time Synchronization & Staged Proposal Protocol**                                 | Stream real-time canvas mutations over dedicated WebSocket channels with `staged: true` buffering, monotonic sequence acks, and one-click accept/revert capabilities.                                                                                                |
| [ADR-008](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-008-hierarchical-leiden-clustering-and-spatial-layout.md) | **Hierarchical Leiden Community Detection, Derived Group Enclosures, and Two-Tier Spatial Layout** | Adopt Option A (derived cluster layer in `node.attrs`) with a two-tier spatial layout engine (intra-cluster Dagre/grid + inter-cluster shelf-packing), off-thread WebWorker delta patching for concurrency safety, and granular transactional WebSocket persistence. |

---

## 7. Architectural Checklist & Quality Verification

- [x] **C1 System Context**: Documented personas, primary system boundaries, and external cloud/MCP integrations.
- [x] **C2 Containers**: Defined deployable processes (`Main Host`, `UtilityProcess`, `Chromium Renderer`, `WebSocket Server`) with explicit network protocols (`[IPC]`, `[WebSocket]`, `[REST/HTTP]`, `[STDIO/SSE]`).
- [x] **C3 Components**: Decomposed Main host orchestrators, storage utility daemons, renderer UI tree, and DeepAgent LangGraph middleware pipelines.
- [x] **C4 Code & Dynamics**: Formalized domain ERD schemas, state machines, sequence diagrams, and process EventStorming flows.
- [x] **Standardized Design Catalog**: All assets generated under `docs/design-catalog/` adhering to the standard hierarchy.
