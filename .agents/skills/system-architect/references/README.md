# Collargraph System Architecture Design Catalog (C4 Model)

## Master Architecture Navigation Hub

This document is the master architectural design catalog for **Collargraph**, organized hierarchically according to the **C4 Model** (Context, Containers, Components, Code) paired with **EventStorming domain modeling**, **runtime sequence diagrams**, and **Architecture Decision Records (ADRs)**.

---

## 1. Executive Summary & System Requirements

- **System Purpose**: Next-generation task graph orchestration, context engineering, and autonomous agent platform.
- **Core Strategy**: Unified Cordis capability spine, zero-framework nominal Graph IR, topological scheduler, fail-closed OS sandboxing, and real-time WebSocket JSON-RPC synchronization.
- **Requirements Specification**: [`requirements.md`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/requirements.md)
- **Agent Lifecycle Specification**: [`../architecture/agent-life-cycle.md`](file:///Users/goldenfung/Documents/collargraph/docs/architecture/agent-life-cycle.md)
- **UI Design System & Tokens**: [`../../DESIGN.md`](file:///Users/goldenfung/Documents/collargraph/DESIGN.md)

---

## 2. Level 1: System Context (C1)

The System Context level defines the boundary of the Collargraph platform, human personas, and external platform dependencies.

### 2.1 System Context Diagram
*Source file: [`c1-context/context.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c1-context/context.mmd)*

```mermaid
flowchart TB
    %% C1 System Context Diagram for Collargraph
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef external fill:#475569,stroke:#334155,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    Developer["👤 AI Engineer / Developer<br/>[Person]<br/>Authors graphs, prompts, and monitors agent workflows"]:::person
    Approver["👤 Human Operator / Approver<br/>[Person]<br/>Reviews privilege escalation requests and human-gate checkpoints"]:::person

    subgraph CollargraphBoundary ["Collargraph System Boundary"]
        CollargraphSystem["🏢 Collargraph Platform<br/>[Software System]<br/>Provides task graph execution, agent harness, context slicing, visual studio, and CLI runtime"]:::system
    end

    LLMProviders["🤖 External LLM Providers<br/>[External System]<br/>DeepSeek, Google Gemini, OpenAI, Anthropic via Pi-AI"]:::external
    LocalFilesystem["📁 Local Workspace & Filesystem<br/>[External System / OS Boundary]<br/>Project code, artifacts, skills, and configuration files"]:::external
    LocalOSShell["💻 Local Shell Runtime<br/>[External System / OS Boundary]<br/>Sandboxed bash processes and background jobs"]:::external

    Developer -->|"Designs graphs, chats, and configures agents [Desktop GUI / CLI]"| CollargraphSystem
    Approver -->|"Approves mutations and resolves gates [Desktop UI]"| CollargraphSystem

    CollargraphSystem -->|"Streams prompts & receives completions via [HTTPS / SSE]"| LLMProviders
    CollargraphSystem -->|"Reads/writes project files within sandbox via [Local OS File APIs]"| LocalFilesystem
    CollargraphSystem -->|"Spawns sandboxed commands via [OS Process / Seatbelt / bwrap]"| LocalOSShell
```

### 2.2 Big-Picture Domain EventStorming
*Source file: [`c1-context/big-picture-events.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c1-context/big-picture-events.mmd)*

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

    User[Developer / User]:::actor
    Orch[Orchestrator Agent]:::actor
    Approver[Human Approver]:::actor

    CmdStart[Start Session / Submit Objective]:::command
    EvtSessionStarted[Session Initialized]:::event
    AggSession[Session Aggregate]:::aggregate
    PolInit[Whenever Session Initialized -> Mount Presets & Scope]:::policy

    CmdCreateGraph[Decompose Objective Into Graph]:::command
    EvtGraphCreated[Task Graph Defined]:::event
    AggGraph[Graph Aggregate]:::aggregate
    PolSchedule[Whenever Graph Ready -> Schedule Topological Wavefront]:::policy

    CmdRunNode[Execute Task Node]:::command
    EvtNodeRunning[Node Execution Started]:::event
    AggNode[Node Runner Aggregate]:::aggregate
    SysLLM[External LLM Provider]:::system

    EvtWriteDenied[Sandbox Mutation Denied]:::event
    PolEscalate[Whenever Out-of-Workspace Mutation -> Request HITL Approval]:::policy
    CmdDecide[Decide Approval Request]:::command
    EvtApproved[Privilege Escalation Granted]:::event

    EvtNodeCompleted[Node Execution Finished]:::event
    PolPropagate[Whenever Node Finished -> Pipe Port Data & Ingest Triples]:::policy
    AggKG[Knowledge Graph Aggregate]:::aggregate
    EvtGraphCompleted[Task Graph Execution Completed]:::event

    User --> CmdStart
    CmdStart --> EvtSessionStarted
    EvtSessionStarted --> AggSession
    AggSession --> PolInit

    PolInit --> CmdCreateGraph
    Orch --> CmdCreateGraph
    CmdCreateGraph --> EvtGraphCreated
    EvtGraphCreated --> AggGraph
    AggGraph --> PolSchedule

    PolSchedule --> CmdRunNode
    CmdRunNode --> EvtNodeRunning
    EvtNodeRunning --> AggNode
    AggNode --> SysLLM

    AggNode --> EvtWriteDenied
    EvtWriteDenied --> PolEscalate
    PolEscalate --> CmdDecide
    Approver --> CmdDecide
    CmdDecide --> EvtApproved
    EvtApproved --> AggNode

    AggNode --> EvtNodeCompleted
    EvtNodeCompleted --> PolPropagate
    PolPropagate --> AggKG
    PolPropagate --> EvtGraphCompleted
```

---

## 3. Level 2: Containers & Deployment Topology (C2)

The Container level details the deployable processes, tech stacks, and inter-container communication protocols.

### 3.1 Container Topology Diagram
*Source file: [`c2-containers/containers.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c2-containers/containers.mmd)*

```mermaid
flowchart TB
    %% C2 Container Diagram for Collargraph
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef container fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#475569,stroke:#334155,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    User["👤 Developer / Approver<br/>[Person]"]:::person

    subgraph CollargraphBoundary ["Collargraph System Boundary"]
        DesktopApp["💻 Desktop IDE & Studio<br/>[Container: Tauri 2.0 / React 19 / Vite]<br/>Provides React Flow canvas, CodeMirror editor, chat stream, and settings UI"]:::container
        
        CLIDaemon["⚙️ CLI & Background Sync Daemon<br/>[Container: Node.js / TypeScript CLI]<br/>Hosts SyncServer, JSON-RPC dispatcher, and batch execution commands"]:::container

        CapabilitySpine["🧠 Capability Harness & Graph Engine<br/>[Container: Cordis Plugin Substrate]<br/>Hosts graph scheduler, relational memory, agent loop, tool sandbox, and Pi-AI routing"]:::container

        SQLiteDB[("🗄️ Session Persistence Database<br/>[Container: SQLite WAL]<br/>Durable append-only event log & message journals")]:::database

        ConfigFileStore[("📄 Configuration Vault<br/>[Container: Local YAML / JSON Files]<br/>Stores settings.yaml, credentials.yaml, and presets.yaml")]:::database

        WorkerSandbox["📦 Code Sandbox Worker Threads<br/>[Container: node:worker_threads]<br/>Isolates deterministic script execution with CPU/memory limits")]:::container
    end

    LLMProviders["🤖 External LLM Providers<br/>[External System: DeepSeek / OpenAI / Gemini / Anthropic]"]:::external
    LocalOS["🖥️ Local Operating System<br/>[External System: File System & Shell / Seatbelt / bwrap]"]:::external

    User -->|"Interacts with visual studio [GUI]"| DesktopApp
    User -->|"Runs headless commands [Terminal / Shell]"| CLIDaemon

    DesktopApp -->|"WebSocket RPC & Event Stream [ws://127.0.0.1:<port> / JSON-RPC 2.0]"| CLIDaemon
    DesktopApp -->|"Window control & native shell [Tauri IPC]"| LocalOS

    CLIDaemon -->|"Mounts via createCapabilityContext() [In-Process / Cordis]"| CapabilitySpine

    CapabilitySpine -->|"Commits immutable journal events [SQL / WAL Lock]"| SQLiteDB
    CapabilitySpine -->|"Loads configuration & secrets [File I/O]"| ConfigFileStore
    CapabilitySpine -->|"Executes deterministic code [Node.js Worker MessageChannel]"| WorkerSandbox
    CapabilitySpine -->|"Dispatches completions [HTTPS / SSE]"| LLMProviders
    CapabilitySpine -->|"Executes sandboxed file/shell operations [OS APIs / Seatbelt / bwrap]"| LocalOS
```

### 3.2 Deployment & Process Topology
*Source file: [`c2-containers/deployment.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c2-containers/deployment.mmd)*

```mermaid
flowchart TB
    %% Deployment & Process Topology Diagram for Collargraph
    classDef node fill:#1e293b,stroke:#3b82f6,color:#fff,stroke-width:2px;
    classDef proc fill:#0f172a,stroke:#64748b,color:#fff;
    classDef store fill:#1e3a8a,stroke:#3b82f6,color:#fff;

    subgraph HostMachine ["🖥️ Developer Workstation (macOS / Linux / Windows)"]
        subgraph TauriRuntime ["Tauri 2.0 Host Process"]
            DesktopProc["🖥️ Desktop Frontend Process (WebKit / WebView2)<br/>React 19 + Dockview + React Flow Canvas"]:::proc
        end

        subgraph NodeRuntime ["Node.js Background Process (Port: 9247 / Dynamic)"]
            DaemonProc["⚙️ Collargraph CLI / Daemon (apps/cli)<br/>SyncServer + JSON-RPC Dispatcher"]:::proc
            CordisProc["🧠 Cordis Capability Container<br/>Graph Engine + HostSessionsService + Pi-AI Runtime"]:::proc
            WorkerProc["⚡ Sandbox Worker Pool (node:worker_threads)<br/>WorkerThreadCodeRuntime"]:::proc
        end

        subgraph LocalDisk ["Local Persistent Storage"]
            SQLiteFile[("🗄️ ~/.collargraph/data/collargraph.db (SQLite WAL Mode)")]:::store
            SettingsFiles[("📄 ~/.collargraph/settings.yaml & credentials.yaml")]:::store
            WorkspaceFS[("📁 Active Workspace Directory (Project Root)")]:::store
        end

        subgraph OSSecurity ["OS-Level Confinement Layer"]
            SandboxRunner["🛡️ Seatbelt (macOS) / bwrap & Landlock (Linux) / Windows ACL"]:::proc
        end
    end

    subgraph CloudAPIs ["☁️ External Cloud Services"]
        DeepSeekAPI["DeepSeek API (api.deepseek.com)"]
        OpenAIAPI["OpenAI API (api.openai.com)"]
        GoogleAPI["Google Gemini API (generativelanguage.googleapis.com)"]
        AnthropicAPI["Anthropic API (api.anthropic.com)"]
    end

    DesktopProc -->|"WebSocket JSON-RPC 2.0 (ws://127.0.0.1:9247)"| DaemonProc
    DaemonProc --- CordisProc
    CordisProc -->|"Spawns sandboxed code tasks"| WorkerProc
    CordisProc -->|"Append-only event commit"| SQLiteFile
    CordisProc -->|"Read/Write configuration"| SettingsFiles
    CordisProc -->|"Controlled file writes & reads"| WorkspaceFS
    CordisProc -->|"Confined bash execution"| SandboxRunner
    SandboxRunner -->|"Restricted access"| WorkspaceFS

    CordisProc -->|"HTTPS / SSE Streaming"| CloudAPIs
```

---

## 4. Level 3: Component Architecture (C3)

The Component level zooms into each container to expose modular blocks, responsibilities, and internal interfaces.

### 4.1 Desktop IDE Components (`apps/desktop`)
*Source file: [`c3-components/component-desktop.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c3-components/component-desktop.mmd)*

```mermaid
flowchart TB
    %% C3 Component Diagram for Desktop Application Container
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef external fill:#475569,stroke:#334155,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    DaemonContainer["⚙️ CLI & Sync Daemon Container"]:::external

    subgraph DesktopContainerBoundary ["Desktop IDE Container (apps/desktop)"]
        RpcClient["🔌 RpcClient<br/>[Component: JSON-RPC Transport]<br/>Manages WebSocket lifecycle, auto-reconnect, and request/notification dispatch"]:::component

        ConversationStore["🧠 ConversationStore<br/>[Component: State Projection]<br/>Pure reducer folding raw session events into chat and activity nodes"]:::component

        TaskGraphCanvas["🎨 TaskGraphCanvas<br/>[Component: React Flow Visual Studio]<br/>Renders polymorphic node cards, animated Bezier edges, and Dagre/Sugiyama layouts"]:::component

        ContextEditor["📝 ContextEditor<br/>[Component: CodeMirror 6 WYSIWYG]<br/>Prompt template authoring with {{inputs.var}} and @entity interpolation"]:::component

        DockviewLayout["🗂️ DockviewLayout<br/>[Component: Tabbed Panel Manager]<br/>Three-column resizable workspace with drag-and-drop tab docking"]:::component

        SettingsCredentialsScope["⚙️ Settings & Credentials Scope<br/>[Component: Client Config Manager]<br/>Manages model providers, API keys, presets, and skill toggles"]:::component

        SlotRegistry["🧩 SlotRegistry & SlotOutlets<br/>[Component: Extension Points]<br/>Dynamic UI plugin injection points for chat, toolbar, and canvas"]:::component
    end

    DockviewLayout --> TaskGraphCanvas
    DockviewLayout --> ContextEditor
    DockviewLayout --> ConversationStore
    DockviewLayout --> SettingsCredentialsScope
    DockviewLayout --> SlotRegistry

    ConversationStore --> RpcClient
    TaskGraphCanvas --> RpcClient
    SettingsCredentialsScope --> RpcClient

    RpcClient -->|"Sends JSON-RPC requests & listens for event broadcasts [WSS]"| DaemonContainer
```

### 4.2 Daemon & Sync Plugin Components (`packages/harness-plugin-sync`)
*Source file: [`c3-components/component-daemon-sync.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c3-components/component-daemon-sync.mmd)*

```mermaid
flowchart TB
    %% C3 Component Diagram for Daemon & Sync Plugin Container
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#475569,stroke:#334155,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    DesktopClient["💻 Desktop Client"]:::external
    GraphEngine["⚙️ Graph Engine Plugin"]:::external

    subgraph SyncPluginBoundary ["Daemon & Sync Plugin (packages/harness-plugin-sync)"]
        SyncServer["🌐 SyncServer<br/>[Component: WebSocket Server]<br/>Binds HTTP/WS listener and manages connection channels"]:::component

        JsonRpcDispatcher["🔀 JsonRpcDispatcher<br/>[Component: RPC Router & Validator]<br/>Validates Zod parameters and dispatches sessions.*, graphs.*, skills.* calls"]:::component

        HostSessionsService["⏱️ HostSessionsService<br/>[Component: Session Orchestrator]<br/>Drives agent loops, HITL approval waterfall, and forks"]:::component

        CapabilityContextFactory["🏗️ Capability Context Factory<br/>[Component: createCapabilityContext]<br/>Mounts and configures all 19 Cordis harness plugins"]:::component

        FileSettingsService["⚙️ FileSettingsService<br/>[Component: Settings Persistence]<br/>Loads and persists user intent in settings.yaml"]:::component

        FileCredentialsService["🔐 FileCredentialsService<br/>[Component: Vault Manager]<br/>Encapsulates API tokens in credentials.yaml"]:::component

        AgentPresetsService["🎭 AgentPresetsService<br/>[Component: Presets & Standing Scopes]<br/>Binds personas and restricts tool allowlists per preset"]:::component

        GraphWorkspaceService["📁 GraphWorkspaceService<br/>[Component: Workspace Graph Coordinator]<br/>Manages multi-graph workspaces and serialization"]:::component
    end

    SQLiteDB[("🗄️ SQLite Session Persistence (WAL)")]:::database

    DesktopClient -->|"WebSocket JSON-RPC"| SyncServer
    SyncServer --> JsonRpcDispatcher
    JsonRpcDispatcher --> HostSessionsService
    JsonRpcDispatcher --> FileSettingsService
    JsonRpcDispatcher --> FileCredentialsService
    JsonRpcDispatcher --> AgentPresetsService
    JsonRpcDispatcher --> GraphWorkspaceService

    HostSessionsService --> CapabilityContextFactory
    HostSessionsService --> SQLiteDB
    HostSessionsService --> GraphEngine
```

### 4.3 Graph Execution Engine Components (`packages/harness-plugin-graph`)
*Source file: [`c3-components/component-graph-engine.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c3-components/component-graph-engine.mmd)*

```mermaid
flowchart TB
    %% C3 Component Diagram for Graph Execution Engine Plugin
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef runner fill:#0d9488,stroke:#115e59,color:#fff;
    classDef store fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#475569,stroke:#334155,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    CordisHarness["🧠 Cordis Harness Context"]:::external
    KGPlugin["📚 Knowledge Graph Plugin"]:::external

    subgraph GraphEngineBoundary ["Graph Engine Plugin (packages/harness-plugin-graph)"]
        GraphEngineService["🎮 GraphEngineService<br/>[Component: Harness Service Facade]<br/>Registers orchestrator tools and manages graph execution runs"]:::component

        TopologicalScheduler["📊 TopologicalScheduler<br/>[Component: DAG Wavefront Dispatcher]<br/>Computes ready nodes, manages concurrency, and resolves port mappings"]:::component

        CycleGuard["🛡️ CycleGuard<br/>[Component: Loop Limiter]<br/>Detects cycles and enforces iteration ceilings on feedback loops"]:::component

        StateStore["📦 StateStore<br/>[Component: Graph Memory Substrate]<br/>Maintains global and node-scoped input/output state"]:::store

        Checkpointer["💾 Checkpointer<br/>[Component: Snapshot Manager]<br/>Saves and restores execution graph snapshots"]:::store

        ExpressionEvaluator["⚡ ExpressionEvaluator<br/>[Component: Condition Engine]<br/>Evaluates branch conditions and variable interpolations"]:::component

        subgraph NodeRunners ["Polymorphic Node Execution Runners"]
            SubagentRunner["🤖 SubagentTaskRunner<br/>Executes subagent_task"]:::runner
            DeterministicCodeRunner["⚡ DeterministicCodeRunner<br/>Executes deterministic_code in worker thread"]:::runner
            RouterConditionRunner["🔀 RouterConditionRunner<br/>Executes router_condition rules"]:::runner
            EvaluatorCriticRunner["⚖️ EvaluatorCriticRunner<br/>Executes evaluator_critic rubrics"]:::runner
            HumanGateRunner["👤 HumanGateRunner<br/>Pauses for approval in human_gate"]:::runner
            SubgraphCellRunner["📦 SubgraphCellRunner<br/>Executes hierarchical subgraph_cell"]:::runner
            KnowledgeSinkRunner["📥 KnowledgeSinkRunner<br/>Ingests triples into knowledge_sink"]:::runner
        end
    end

    CordisHarness --> GraphEngineService
    GraphEngineService --> TopologicalScheduler
    TopologicalScheduler --> CycleGuard
    TopologicalScheduler --> StateStore
    TopologicalScheduler --> NodeRunners
```

---

## 5. Level 4: Code & Detailed Dynamics (C4)

The Code & Dynamics level details data schemas (ERD), finite state machines, runtime sequence orchestrations, and critical process flows.

### 5.1 Data Model (ERD)
*Source file: [`c4-code/data/erd.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/data/erd.mmd)*

```mermaid
erDiagram
    %% Core Domain ERD for Graph IR and Sessions in Collargraph
    GRAPH ||--o{ TASK_NODE : contains
    GRAPH ||--o{ EDGE : contains
    TASK_NODE ||--o{ PORT : exposes
    EDGE }|--|| PORT : connects_source
    EDGE }|--|| PORT : connects_target

    GRAPH ||--o{ EXECUTION_RUN : tracks
    EXECUTION_RUN ||--o{ TRAJECTORY : records
    TASK_NODE ||--o{ TRAJECTORY : produces

    SESSION ||--o{ JOURNAL_EVENT : appends
    SESSION ||--o{ AGENT_INSTANCE : manages
    AGENT_PRESET ||--o{ AGENT_INSTANCE : applies_to

    ENTITY_NODE ||--o{ ENTITY_RELATION : source_of
    ENTITY_NODE ||--o{ ENTITY_RELATION : target_of

    GRAPH {
        string id PK "GraphId nominal brand"
        string name
        string version
        json metadata
        timestamptz created_at
    }

    TASK_NODE {
        string id PK "NodeId nominal brand"
        string graph_id FK
        string type "NodeType: subagent_task | deterministic_code | router_condition..."
        string label
        json context_spec
        json model_config
        json retry_policy
    }

    PORT {
        string id PK "PortId nominal brand"
        string node_id FK
        string name
        string direction "input | output"
        string data_type "string | number | boolean | object | array | artifact"
        boolean required
    }

    EDGE {
        string id PK "EdgeId nominal brand"
        string graph_id FK
        string source_node_id FK
        string source_port_id FK
        string target_node_id FK
        string target_port_id FK
        string condition_expression
    }

    EXECUTION_RUN {
        string id PK "ExecutionRunId nominal brand"
        string graph_id FK
        string status "running | completed | failed | paused"
        json initial_inputs
        json final_outputs
        timestamptz started_at
        timestamptz finished_at
    }

    TRAJECTORY {
        string id PK "TrajectoryId nominal brand"
        string execution_run_id FK
        string node_id FK
        string status "NodeExecutionStatus"
        json input_payload
        json output_payload
        string error_message
        int duration_ms
    }

    SESSION {
        string id PK "SessionId"
        string title
        string workspace_cwd
        string current_model
        string current_preset_id
        timestamptz created_at
    }

    JOURNAL_EVENT {
        string session_id FK
        int seq PK
        string event_type "turn/start | assistant/chunk | tool/call | approval/asked..."
        json payload
        timestamptz timestamp
    }

    AGENT_PRESET {
        string id PK
        string name
        string persona
        json allowed_tools
        json default_model
    }

    ENTITY_NODE {
        string id PK
        string entity_type
        string name
        json properties
    }

    ENTITY_RELATION {
        string id PK
        string source_id FK
        string target_id FK
        string relation_type
        json properties
    }
```

### 5.2 State Machines

#### 5.2.1 Task Node Lifecycle State Machine
*Source file: [`c4-code/data/state-node.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/data/state-node.mmd)*

```mermaid
stateDiagram-v2
    %% Task Node Execution Lifecycle State Machine
    [*] --> idle : Graph Instantiated

    idle --> queued : Dependencies Resolved & Inputs Ready
    queued --> running : Scheduler Allocates Worker / Subagent

    state running {
        [*] --> PreparingContext : Render Template & Slice KG
        PreparingContext --> Executing : Run Subagent / Script / Condition
        Executing --> ValidatingOutput : Check Output Schemas
        ValidatingOutput --> [*]
    }

    running --> awaiting_human : Node Type == 'human_gate' OR HITL Escalation
    awaiting_human --> running : Human Resolves Gate / Approves Mutation
    awaiting_human --> abandoned : Human Cancels / Rejects Request

    running --> completed : Execution Succeeded & Output Validated
    running --> failed : Execution Error & Max Retries Exceeded
    running --> skipped : Upstream Conditional Branch Not Taken
    running --> forked : Execution Branch Fork Triggered

    failed --> queued : Retry Triggered (Under Max Retries)

    completed --> [*]
    failed --> [*]
    skipped --> [*]
    abandoned --> [*]
    forked --> [*]
```

#### 5.2.2 Agent Session Turn Lifecycle State Machine
*Source file: [`c4-code/data/state-turn.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/data/state-turn.mmd)*

```mermaid
stateDiagram-v2
    %% Agent Session Turn Lifecycle State Machine
    [*] --> TurnIdle : Session Ready

    TurnIdle --> TurnStarted : sessions.prompt Received
    
    state TurnStarted {
        [*] --> PreStepWaterfalls : agent/pre-step (Skills, Slash Commands)
        PreStepWaterfalls --> AssemblingPrompt : SystemPrompt.assemble (Persona, Sandbox Mode, Tools)
        AssemblingPrompt --> ModelStreaming : ctx.llm.request (Pi-AI SSE)
        
        state ModelStreaming {
            [*] --> ReceivingChunks : Stream assistant/chunk & reasoning/chunk
            ReceivingChunks --> SchedulingTools : Assistant Emits tool_call(s)
            ReceivingChunks --> StreamCompleted : Assistant Emits message (no tool calls)
        }

        SchedulingTools --> ExecutingTools : Scheduler Runs (maxParallelToolCalls: 4)
        
        state ExecutingTools {
            [*] --> SandboxedExecution : Enforce Sandbox Policy & Timeout
            SandboxedExecution --> HITLApprovalPending : Denial Encountered (FS_SANDBOX_DENIED)
            HITLApprovalPending --> SandboxedExecution : User Grants 'allowed-once'
            HITLApprovalPending --> EscalationRejected : User Rejects / Turn Cancelled
            SandboxedExecution --> PostExecuteHygiene : Repeat Reminder & Compaction Pruner
            PostExecuteHygiene --> [*]
        }

        ExecutingTools --> PreStepWaterfalls : Next Step Turn Loop
        StreamCompleted --> [*]
    }

    TurnStarted --> TurnFinished : Assistant Done & Usage Billed
    TurnStarted --> TurnError : Unrecoverable Error or Cancelled
    
    TurnFinished --> TurnIdle : Ready for Next User Prompt
    TurnError --> TurnIdle : Ready for Next User Prompt
```

### 5.3 Runtime Interaction Flows

#### 5.3.1 Graph Execution & Topological Scheduling Sequence
*Source file: [`c4-code/flows/sequence-graph-exec.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/flows/sequence-graph-exec.mmd)*

```mermaid
sequenceDiagram
    %% Runtime Sequence: Graph Execution & Topological Scheduling
    autonumber
    actor User as Developer / CLI Runner
    participant Host as HostSessionsService / CLI
    participant Engine as GraphEngineService
    participant Sched as TopologicalScheduler
    participant Guard as CycleGuard
    participant State as StateStore
    participant Runner as Node Runner (Subagent/Code/Gate)
    participant Sink as KnowledgeSinkRunner

    User->>Host: Execute Graph (graphId, initialInputs)
    Host->>Engine: runGraph(graph, initialInputs)
    Engine->>State: initExecution(runId, graphId, initialInputs)
    Engine->>Sched: scheduleWavefront(graph, state)

    loop While Sched Has Ready Nodes
        Sched->>Guard: checkCycleThreshold(nodeId, runId)
        Guard-->>Sched: Ok (within iteration limits)
        
        Sched->>State: getNodeInputs(nodeId)
        State-->>Sched: resolvedInputs
        
        Sched->>Runner: executeNode(node, resolvedInputs)
        activate Runner
        Runner->>Runner: Process (Subagent LLM / Worker Script / Condition)
        Runner-->>Sched: NodeResult (status: 'completed', outputs)
        deactivate Runner
        
        Sched->>State: setNodeOutputs(nodeId, outputs)
        Sched->>Host: broadcastEvent('node/completed', {nodeId, outputs})

        opt If Node is knowledge_sink
            Sched->>Sink: ingestTriples(outputs.triples)
            Sink-->>Sched: Triples committed to EntityStore
        end

        Sched->>Sched: computeNextWavefront()
    end

    Sched-->>Engine: ExecutionRunCompleted (finalState)
    Engine->>State: finalizeRun(runId, 'completed')
    Engine-->>Host: Execution Summary & Output Artifacts
    Host-->>User: Result Notification
```

#### 5.3.2 Human-in-the-Loop (HITL) Sandbox Escalation Sequence
*Source file: [`c4-code/flows/sequence-hitl.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/flows/sequence-hitl.mmd)*

```mermaid
sequenceDiagram
    %% Runtime Sequence: Human-in-the-Loop (HITL) Sandbox Escalation
    autonumber
    actor User as Desktop User / Approver
    participant UI as Desktop UI (ConversationStore)
    participant RPC as RpcClient / Dispatcher
    participant Host as HostSessionsService
    participant Loop as AgentLoop
    participant Sched as Tool Scheduler
    participant FS as SandboxedFileSystem
    participant Appr as ApprovalService

    Loop->>Sched: Execute tool 'write' (target outside workspace)
    Sched->>FS: writeText(path, content, policy)
    FS--x Sched: FsError("FS_SANDBOX_DENIED")
    
    Sched->>Appr: ctx.approval.request({callId, reason: 'Escalate to write out of workspace'})
    activate Appr
    Appr->>Appr: Append journal opener (approval/asked)
    Appr-->>Host: dispatch 'approval/request' waterfall
    Host-->>RPC: broadcast 'approval/asked' (+call params)
    RPC-->>UI: fold into ApprovalRequestNode (pending)
    deactivate Appr

    Note over User,UI: User inspects path, diff & justification
    User->>UI: Click "Allow Once"
    UI->>RPC: sessions.approval.decide {approvalId, decision: 'allowed-once'}
    RPC->>Host: approval.decide(params)
    Host->>Appr: resolvePendingAsk('allowed-once')
    
    activate Appr
    Appr->>Appr: Append journal closer (approval/decided)
    Appr-->>Sched: Grant single-shot widened policy
    deactivate Appr

    Sched->>FS: Retry writeText under single-shot grant
    FS-->>Sched: Write Succeeded
    Sched-->>Loop: Tool Result (Success)
    Loop-->>UI: Broadcast tool/finish & stream next assistant turn
```

### 5.4 Critical Process Deep Dives

#### 5.4.1 Single Task Node Execution & State Propagation
*Source file: [`c4-code/processes/process-node-run.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/processes/process-node-run.mmd)*

```mermaid
flowchart TD
    %% Process Flow: Single Task Node Execution & State Propagation
    Start([Node Dispatched]) --> ReadInputs[1. Read Inbound Port Inputs & StateStore]
    ReadInputs --> CheckKGQuery{Has Knowledge Query?}
    
    CheckKGQuery -->|Yes| QueryKG[2. ContextSlicer Extracts Triples from EntityStore]
    CheckKGQuery -->|No| TemplateInterpolation
    QueryKG --> TemplateInterpolation

    TemplateInterpolation[3. Interpolate Context Variables into Prompt Template] --> CheckNodeType{Polymorphic Node Type?}

    CheckNodeType -->|subagent_task| RunSubagent[4a. Spawn In-Process Subagent Loop & LLM Session]
    CheckNodeType -->|deterministic_code| RunCode[4b. Dispatch to WorkerThreadCodeRuntime Pool]
    CheckNodeType -->|router_condition| RunCondition[4c. Evaluate JS/Boolean Expression in Isolated VM]
    CheckNodeType -->|evaluator_critic| RunCritic[4d. Evaluate Rubric & Check Passing Threshold]
    CheckNodeType -->|human_gate| RunGate[4e. Suspend & Register Pending Approval Promise]
    CheckNodeType -->|knowledge_sink| RunSink[4f. Parse Entities & Ingest into EntityStore]

    RunSubagent --> ValidateOutputs
    RunCode --> ValidateOutputs
    RunCondition --> ValidateOutputs
    RunCritic --> CheckCriticPassed{Passed Threshold?}
    
    CheckCriticPassed -->|Yes| ValidateOutputs
    CheckCriticPassed -->|No| TriggerCycleLoop[CycleGuard: Increment Iteration & Route to Feedback Edge]
    TriggerCycleLoop --> Finish([Node Cycle Complete])

    RunGate --> ValidateOutputs
    RunSink --> ValidateOutputs

    ValidateOutputs[5. Validate Outputs against Outbound Port Schemas] --> WriteOutputs[6. Write Results to StateStore & Trajectory Log]
    WriteOutputs --> NotifyScheduler[7. Notify TopologicalScheduler to Advance Wavefront]
    NotifyScheduler --> Finish
```

#### 5.4.2 End-to-End Session Prompt Dispatch
*Source file: [`c4-code/processes/process-session-prompt.mmd`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/c4-code/processes/process-session-prompt.mmd)*

```mermaid
flowchart TD
    %% Process Flow: End-to-End Session Prompt Dispatch
    PromptReceived([User Submits Prompt]) --> ValidateRPC[1. JsonRpcDispatcher validates SessionsPromptParamsSchema]
    ValidateRPC --> ResolveEntities[2. HostSessionsService resolves model & agent preset]
    ResolveEntities --> CheckLiveAgent{Live Agent Exists for Session?}

    CheckLiveAgent -->|No| CreateAgent[3a. AgentLoop.createAgent with cwd sandbox & preset setup]
    CheckLiveAgent -->|Yes| RebindScope[3b. Rebind standing preset scope & tool restrictions]

    CreateAgent --> PreStepWaterfalls
    RebindScope --> PreStepWaterfalls

    PreStepWaterfalls[4. agent/pre-step: Snapshot skill catalog & expand slash commands] --> AssemblePrompt[5. SystemPrompt.assemble: Persona order 0 + Sandbox mode + Tool schemas]
    AssemblePrompt --> RequestLLM[6. LlmRuntime dispatches request via Pi-AI SSE adapter]
    RequestLLM --> StreamSSE[7. Stream assistant/chunk & reasoning/chunk to Desktop UI]

    StreamSSE --> CheckToolCalls{Model Produced Tool Calls?}
    CheckToolCalls -->|No| TurnFinished[8a. Append assistant message & bill TokenMeter usage]
    CheckToolCalls -->|Yes| ScheduleTools[8b. Tool Scheduler runs <= 4 calls with ToolTimeoutPolicy]

    ScheduleTools --> ExecuteSandbox[9. Execute tool against SandboxedFileSystem / SandboxBash]
    ExecuteSandbox --> PostExecute[10. tools/post-execute: Repeat reminder & compaction pruner]
    PostExecute --> NextStepLoop[11. Advance loop to next driver step]
    NextStepLoop --> PreStepWaterfalls

    TurnFinished --> CommitJournal[12. SQLiteSessionPersistence commits turn/finish to WAL log]
    CommitJournal --> ReadyState([Turn Settled])
```

---

## 6. Architecture Decision Records (ADRs)

| ADR | Title | Decision Summary | Status |
|---|---|---|---|
| [`ADR-001`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/adrs/adr-001-unified-cordis-capability-spine.md) | **Unified Cordis Capability Spine** | Mount all entry points (CLI, Daemon, Desktop) onto one capability spine via `createCapabilityContext()`. | Accepted |
| [`ADR-002`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/adrs/adr-002-deterministic-sqlite-wal-journaling.md) | **Deterministic SQLite WAL Session Journaling** | Single-writer SQLite persistence in WAL mode for replayability and time-travel session forks. | Accepted |
| [`ADR-003`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/adrs/adr-003-zero-framework-branded-graph-ir.md) | **Zero-Framework Nominal Branded Graph IR** | Dependency-free branded nominal types and Zod schemas for graph models. | Accepted |
| [`ADR-004`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/adrs/adr-004-websocket-jsonrpc-synchronization.md) | **WebSocket JSON-RPC 2.0 Synchronization** | Loopback WebSocket protocol for bidirectional client-daemon RPC and streaming events. | Accepted |
| [`ADR-005`](file:///Users/goldenfung/Documents/collargraph/docs/design-catalog/adrs/adr-005-fail-closed-sandboxed-execution.md) | **Fail-Closed Security Fence & Confinement** | Workspace-anchored paths, OS Seatbelt/bwrap confinement, and single-shot HITL escalation grants. | Accepted |
