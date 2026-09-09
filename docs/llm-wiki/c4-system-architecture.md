# C4 System Architecture: Workspace-as-Wiki Bi-Directional Knowledge Engine

## 1. Executive Summary & Document Control

- **System**: CollarAgent Desktop IDE & DeepAgent Runtime
- **Subsystem**: Workspace-as-Wiki Knowledge Engine (`@workspace/*`, `@collaragent/tools/*`, `@shared/*`)
- **Status**: Implemented & Verified Architecture (Phases 0–4 Completed)
- **Architectural Scope**:
  - Unified Entity & Multi-Facet Model (Document, Relational Ledger, Canvas Layout)
  - Bi-Directional Synchronization (Visual Ideation $\rightleftharpoons$ Prose Crystallization)
  - Two-Provenance Relational Ledger (`canvas_relational` vs. `document_claim`)
  - Two-Tier Linting (L1 Deterministic Compiler + L2 LLM Semantic Audit)
  - Headless Developer CLI (`yarn wiki:lint`, `yarn wiki:compile`)
  - Deterministic SQLite Canvas Compilation (`compileGraph`) with Workspace Tool Standard Compliance
- **Authoritative References**:
  - Specification: [`docs/llm-wiki/spec-workspace-as-wiki.md`](file:///Users/goldenfung/Documents/collaragent/docs/llm-wiki/spec-workspace-as-wiki.md)
  - Diagnostic & Analysis: [`docs/llm-wiki/analysis.md`](file:///Users/goldenfung/Documents/collaragent/docs/llm-wiki/analysis.md)
  - ADR-001 (Multi-process topology): [`docs/design-catalog/adrs/adr-001-multi-process-architecture.md`](file:///Users/goldenfung/Documents/collaragent/docs/design-catalog/adrs/adr-001-multi-process-architecture.md)
  - ADR-002 (Sharded Storage V3): `CagentStorage` V3 sharded layout
  - ADR-005 (Mathematical Inversion): [`src/collaragent/runtime/InverseCommandEngine.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts)

---

## 2. Level 1: System Context (C1)

The System Context diagram establishes the boundaries of the CollarAgent system, the primary human and autonomous actors, and external system integrations.

```mermaid
flowchart TB
    %% C1 Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    Researcher["👤 Researcher / Author<br/>[Person]<br/>Conducts research, ideates visually on canvas,<br/>drafts scholarly documents in Lexical editor"]:::person

    subgraph EnterpriseBoundary ["CollarAgent Desktop IDE Boundary"]
        CollarAgentApp["🏢 CollarAgent Desktop IDE<br/>[Local-First Desktop Application]<br/>Provides 3-pane studio (Canvas, Editor, Co-pilot),<br/>unified knowledge graph, and autonomous subagent execution"]:::system
    end

    LLMProviders["☁️ Model Providers<br/>[External Systems: Anthropic, OpenAI, DeepSeek, Ollama]<br/>Powers LangGraph ReAct agents, reasoning, and semantic linting"]:::external
    LocalFilesystem[("💾 Local Disk (.cagent / .collar)<br/>[Local Storage Engine]<br/>Stores sharded instances, snapshots, and lockfiles")]:::external
    AcademicGateways["📚 Academic Gateways & Web<br/>[External Systems: arXiv, Semantic Scholar, CrossRef]<br/>Supplies raw research papers, citations, and metadata"]:::external

    Researcher -->|"Ideates on Canvas & Drafts in Lexical [UI/Events]"| CollarAgentApp
    CollarAgentApp -->|"Interacts with Agent Co-pilot [Chat/Streaming]"| Researcher
    CollarAgentApp -->|"Invokes LLM Completions & Tool Calls [HTTPS]"| LLMProviders
    CollarAgentApp -->|"Reads & Writes Portable Projects [File I/O]"| LocalFilesystem
    CollarAgentApp -->|"Retrieves Literature & Ingests Sources [HTTPS]"| AcademicGateways
```

---

## 3. Level 2: Container Topology (C2)

The Container diagram illustrates the deployable process topology of CollarAgent, communication channels, data stores, and runtime modules.

```mermaid
flowchart TB
    %% C2 Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef container fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    Researcher["👤 Researcher / Author"]:::person

    subgraph DesktopProcessBoundary ["CollarAgent Desktop Process Topology (Electron)"]
        RendererContainer["🖥️ Renderer Process (Chromium)<br/>[Container: React 19 / Dockview / Tailwind v4]<br/>Hosts 3-Pane Studio: Concept Canvas, Lexical Editor, Chat"]:::container

        MainProcess["⚡ Electron Main Process<br/>[Container: Node.js 22 / Electron Main]<br/>Window management, IPC routing, OS Keychain, PersistenceManager"]:::container

        FileServerUtility["🗄️ FileServer UtilityProcess<br/>[Container: Node.js utilityProcess / Express 5]<br/>Owns .cagent ZIP extraction, MessagePack I/O, file locks"]:::container

        WebSocketSync["🔄 WebSocket Sync Server<br/>[Container: Node.js ws / Port :0 Dynamic]<br/>Real-time broadcast for Canvas commands and Editor operations"]:::container

        DeepAgentRuntime["🧠 DeepAgent Runtime<br/>[Container: LangGraph ReAct Engine / Node.js]<br/>Executes skills, subagents, and WorkspaceTools"]:::container
    end

    subgraph StorageLayout [".collar/ Live Workspace Directory"]
        ManifestFile[("📋 manifest.json<br/>Metadata catalog")]:::database
        DocInstances[("📄 instances/doc-*.json<br/>Lexical Document Payloads")]:::database
        LedgerInstance[("📒 instances/ledger-default.json<br/>Unified Relational Ledger (Edges & Provenance)")]:::database
        CanvasInstances[("📐 instances/canvas-*.json<br/>Visual Layout (x, y, w, h, clusters)")]:::database
        SnapshotsMsgpack[("📦 snapshots/*.msgpack<br/>Content-addressed binary history")]:::database
    end

    LLMCloud["☁️ LLM Providers (Anthropic, OpenAI, DeepSeek)"]:::external

    Researcher -->|"Interacts via UI [DOM Events]"| RendererContainer
    RendererContainer <-->|"Context-isolated Bridges [Electron IPC]"| MainProcess
    RendererContainer <-->|"Bi-directional Sync [WebSocket / WSS]"| WebSocketSync

    MainProcess -->|"Forks & Supervises [IPC]"| FileServerUtility
    MainProcess -->|"Instantiates & Manages [In-Process]"| DeepAgentRuntime

    DeepAgentRuntime -->|"Executes Tool Calls [Local Invocation]"| FileServerUtility
    DeepAgentRuntime -->|"Dispatches LLM Requests [HTTPS]"| LLMCloud

    WebSocketSync <-->|"Coordinates Mutation Events [In-Memory]"| MainProcess
    FileServerUtility <-->|"Reads / Writes Sharded Entities [Node fs]"| StorageLayout
```

---

## 4. Level 3: Component Architecture (C3)

Zooming inside the **Workspace Knowledge Engine** and **DeepAgent Runtime** containers reveals how documents, the relational ledger, the canvas, and compiler passes interact.

```mermaid
flowchart TB
    %% C3 Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph WorkspaceModule ["Workspace Subsystem (src/workspace)"]
        subgraph EditorSubsystem ["Lexical Document Subsystem"]
            CardEditor["📝 CardEditor Component<br/>Rich-text authoring surface"]:::component
            InlineBadgePlugin["🏷️ InlineClaimBadgePlugin<br/>Renders & manages inline clickable badges"]:::component
            ClaimBadgeTransformer["🔤 ClaimBadgeTransformer<br/>Parses [[rel:entity|justification]] markdown"]:::component
            EditorSyncPlugin["🔄 EditorSyncPlugin<br/>Synchronizes block changes over WS"]:::component
            BlockIdentityRegistry["🆔 BlockIdentityRegistry<br/>Maintains stable UUIDs across edits/splits"]:::component
        end

        subgraph CanvasSubsystem ["Concept Canvas Subsystem"]
            CanvasComponent["🗺️ Canvas Component<br/>Infinite 2D graph workspace"]:::component
            CanvasStore["📦 Canvas Zustand Store<br/>Manages node positions, selection, groups"]:::component
            CanvasSyncPlugin["🔄 CanvasSyncPlugin<br/>Applies batched atomic commands"]:::component
            CanvasDiffEngine["⚡ CanvasDiffEngine<br/>Computes atomic commands from state diffs"]:::component
        end

        subgraph WikiEngine ["Knowledge Compiler Subsystem (src/workspace/wiki)"]
            LinkExtractor["🔍 LinkExtractor<br/>Parses inline claim badges from blocks"]:::component
            RelationalLedgerStore["⚖️ RelationalLedgerStore<br/>In-memory & persisted edge truth with provenance"]:::component
            GraphCompiler["⚙️ GraphCompiler<br/>Compiles ledger + layout into Canvas Snapshot"]:::component
            InvertedIndexManager["🗂️ InvertedIndexManager<br/>Maintains getBacklinks() / getOutlinks()"]:::component
            L1Linter["🛡️ L1StructuralLinter<br/>Detects unresolved symbols, orphans, anchor_lost"]:::component
            L2Linter["🧠 L2SemanticLinter<br/>LLM-assisted contradiction, staleness & gap audits"]:::component
            LegacyBootstrapper["🔄 LegacyArchiveBootstrapper<br/>Synthesizes ledger from legacy V3 canvas"]:::component
            CLIEntry["💻 Headless CLI (wiki-cli.mjs)<br/>Standalone runner via jiti"]:::component
        end
    end

    subgraph AgentToolsSubsystem ["DeepAgent WorkspaceTools (src/collaragent/tools)"]
        ToolWriteGraph["🔨 writeGraph Tool<br/>Visual ideation: writes canvas_relational edges"]:::component
        ToolEditDocument["✏️ editDocument Tool<br/>Edits prose and adds inline claim badges"]:::component
        ToolIngestSource["📥 ingestSource Tool<br/>Atomic source ingestion & multi-file fanout"]:::component
        ToolQueryFileBack["💬 queryAndFileBack Tool<br/>Graph traversal, synthesis & filing"]:::component
        ToolLintWorkspace["🔍 lintWorkspace Tool<br/>Triggers L1 compiler + L2 semantic lint"]:::component
        ToolCompileGraph["🗺️ compileGraph Tool<br/>Lints & compiles ledger into SQLite canvas"]:::component
    end

    StorageEngine[("💾 Storage Engine (.collar/instances/ & SQLite)")]:::database

    %% Editor Interactions
    CardEditor --> InlineBadgePlugin
    CardEditor --> ClaimBadgeTransformer
    InlineBadgePlugin --> BlockIdentityRegistry
    CardEditor --> EditorSyncPlugin
    EditorSyncPlugin -->|"Emits block mutations"| LinkExtractor
    LinkExtractor -->|"Updates document_claim edges"| RelationalLedgerStore

    %% Canvas Interactions
    CanvasComponent --> CanvasStore
    CanvasComponent --> CanvasSyncPlugin
    CanvasComponent -->|"UI drag edge (canvas_relational)"| RelationalLedgerStore
    CanvasSyncPlugin --> CanvasDiffEngine

    %% Compiler Pipeline
    RelationalLedgerStore -->|"Topological Truth"| GraphCompiler
    CanvasStore -->|"Visual Layout Coordinates"| GraphCompiler
    GraphCompiler -->|"Emits Compiled Canvas Snapshot"| CanvasComponent
    RelationalLedgerStore --> InvertedIndexManager
    RelationalLedgerStore --> L1Linter
    RelationalLedgerStore --> L2Linter
    RelationalLedgerStore <-->|"Persists ledger-*.json"| StorageEngine
    StorageEngine <-->|"Bootstraps legacy archives"| LegacyBootstrapper
    CLIEntry --> L1Linter
    CLIEntry --> L2Linter
    CLIEntry --> GraphCompiler

    %% Agent Tool Invocations
    ToolWriteGraph -->|"Writes canvas_relational edges"| RelationalLedgerStore
    ToolWriteGraph -->|"Updates coordinates"| CanvasStore
    ToolEditDocument -->|"Updates document blocks"| EditorSyncPlugin
    ToolIngestSource -->|"Atomic transaction"| RelationalLedgerStore
    ToolIngestSource -->|"Atomic transaction"| StorageEngine
    ToolQueryFileBack -->|"Traverses backlink index"| InvertedIndexManager
    ToolLintWorkspace -->|"Runs deterministic checks"| L1Linter
    ToolLintWorkspace -->|"Runs semantic checks"| L2Linter
    ToolCompileGraph -->|"Pre-check lint gate"| L1Linter
    ToolCompileGraph -->|"Compiles & persists canvas"| GraphCompiler
    ToolCompileGraph -->|"Persists canvas instance to SQLite"| StorageEngine
```

---

## 5. Level 4: Code & Detailed Dynamics (C4)

### 5.1 Domain Entity Relationship Diagram (ERD)

The ERD illustrates the **Single Entity, Multi-Facet** model and the relational schema connecting documents, claims, ledger edges, and canvas layout.

```mermaid
erDiagram
    WORKSPACE_ENTITY ||--|| DOCUMENT_FACET : "has content"
    WORKSPACE_ENTITY ||--|| RELATIONAL_LEDGER_FACET : "has topology"
    WORKSPACE_ENTITY ||--o| CANVAS_LAYOUT_FACET : "has visual geometry"

    DOCUMENT_FACET ||--|{ LEXICAL_BLOCK : "contains"
    LEXICAL_BLOCK ||--o{ INLINE_CLAIM_BADGE : "contains"

    RELATIONAL_LEDGER_FACET ||--|{ LEDGER_ENTRY : "manages"
    INLINE_CLAIM_BADGE ||--o| LEDGER_ENTRY : "anchors"

    CANVAS_LAYOUT_FACET ||--|{ NODE_LAYOUT : "positions"

    WORKSPACE_ENTITY {
        string id PK "Canonical entity name (e.g. transformer-architecture)"
        string type "concept | source | claim | synthesis | log"
        string title "Display title"
        datetime createdAt
        datetime updatedAt
    }

    DOCUMENT_FACET {
        string instanceId PK "doc-uuid"
        string entityId FK
        string format "lexical-json / html"
        int version
    }

    LEXICAL_BLOCK {
        string blockId PK "Stable UUID (blk_01HZX8...)"
        string nodeType "paragraph | heading | quote | equation"
        text content "Prose content"
    }

    INLINE_CLAIM_BADGE {
        string badgeId PK "UUID"
        string targetEntityId FK
        string rel "supports | contradicts | supersedes | details | cites"
        text justification "Rationale for link"
    }

    RELATIONAL_LEDGER_FACET {
        string instanceId PK "ledger-uuid"
        string entityId FK
        datetime compiledAt
    }

    LEDGER_ENTRY {
        string id PK "UUID"
        string sourceEntityId FK
        string targetEntityId FK
        string rel "ClaimRelationEnum"
        string provenance "canvas_relational | document_claim"
        string anchorBlockId FK "Nullable (populated if document_claim)"
        text anchorJustification "Nullable"
        string canvasLabel "Nullable"
        string status "active | anchor_lost | archived"
        datetime createdAt
    }

    CANVAS_LAYOUT_FACET {
        string instanceId PK "canvas-uuid"
        string entityId FK
        float viewportX
        float viewportY
        float zoom
    }

    NODE_LAYOUT {
        string nodeId PK "Node UUID"
        float x
        float y
        float width
        float height
        string clusterId "Group assignment"
        text memo "Curation annotation"
    }
```

---

### 5.2 State Machine: Relational Edge Lifecycle & Graceful Degradation

The finite state machine governs how edges transition between visual ideation, formal crystallization, and refactoring events.

```mermaid
stateDiagram-v2
    [*] --> CanvasRelational : Created via UI Drag on Canvas or writeGraph tool
    [*] --> DocumentClaim : Created directly via Inline Claim Badge in Document

    state CanvasRelational {
        [*] --> UnanchoredActive
        UnanchoredActive : • Provenance = canvas_relational
        UnanchoredActive : • Canvas = Labeled Dashed Edge
        UnanchoredActive : • Document = Header indicator pill (Zero text pollution)
    }

    state DocumentClaim {
        [*] --> AnchoredActive
        AnchoredActive : • Provenance = document_claim
        AnchoredActive : • Bound to stable blockId & justification
        AnchoredActive : • Canvas = Solid Edge with 📄 Jump-to-Block icon
        AnchoredActive : • Document = Interactive Inline Badge
    }

    CanvasRelational --> DocumentClaim : User/Agent anchors edge to paragraph / adds inline badge

    DocumentClaim --> AnchorLost : Paragraph containing blockId is cut or deleted

    state AnchorLost {
        [*] --> DegradedNotice
        DegradedNotice : • Provenance = canvas_relational (degraded)
        DegradedNotice : • Status = anchor_lost
        DegradedNotice : • Canvas = Dashed Edge with ⚠️ warning tooltip
        DegradedNotice : • L1 Compiler = Warning: Anchor block missing
    }

    AnchorLost --> DocumentClaim : User re-attaches edge to new block
    AnchorLost --> Archived : User explicitly dismisses edge
    CanvasRelational --> Archived : User/Agent deletes edge on canvas
    DocumentClaim --> Archived : User deletes inline badge from document

    Archived --> [*]
```

---

### 5.3 Runtime Interaction Flow 1: Bi-Directional Visual Ideation (`writeGraph` $\to$ Document)

Illustrates an agent using `writeGraph` to brainstorm relationships without polluting human document prose.

```mermaid
sequenceDiagram
    autonumber
    actor DeepAgent as 🤖 DeepAgent Skill
    participant Tool as WorkspaceTools (writeGraph)
    participant WS as WebSocket Sync Server
    participant Ledger as RelationalLedgerStore
    participant CanvasStore as CanvasStore (Renderer)
    participant Editor as Lexical Document Editor

    DeepAgent->>Tool: writeGraph({ from: "CNN", to: "ViT", label: "supersedes" })
    activate Tool
    Tool->>Ledger: recordEdge({ source: "CNN", target: "ViT", rel: "supersedes", provenance: "canvas_relational" })
    activate Ledger
    Ledger->>Ledger: Persist to instances/ledger-default.json
    Ledger-->>Tool: Edge recorded (id: edge-101, unanchored)
    deactivate Ledger

    Tool->>WS: Broadcast EdgeAdded({ id: edge-101, provenance: "canvas_relational" })
    activate WS

    par Update Canvas View
        WS->>CanvasStore: Apply EdgeAdded(edge-101)
        CanvasStore-->>CanvasStore: Render labeled dashed line (CNN ──supersedes──► ViT)
    and Update Document View (Zero Text Pollution)
        WS->>Editor: Notify UnanchoredEdge(edge-101)
        Editor-->>Editor: Display Header Tray Pill: "⚡ 1 Unanchored Link: [supersedes: ViT]"
        Note over Editor: Document prose body remains 100% UNTOUCHED!
    end
    deactivate WS

    Tool-->>DeepAgent: Success { edgeCount: 1, unanchoredCount: 1 }
    deactivate Tool
```

---

### 5.4 Runtime Interaction Flow 2: Prose Crystallization (Document $\to$ Canvas Click-to-Block)

Illustrates a human or agent writing an inline claim badge in a document, compiling to the ledger, and jumping from the canvas.

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Researcher / Agent
    participant Lexical as Lexical Editor (InlineClaimBadgePlugin)
    participant Sync as EditorSyncPlugin
    participant Ledger as RelationalLedgerStore
    participant Compiler as GraphCompiler
    participant Canvas as Concept Canvas UI

    User->>Lexical: Types paragraph with inline badge: [⚡ supersedes: ViT | "ImageNet top-1"]
    activate Lexical
    Lexical->>Sync: OnDocumentChange(DocumentPayload)
    deactivate Lexical
    activate Sync

    Sync->>Ledger: UpsertClaimEdge({ source: "CNN", target: "ViT", rel: "supersedes", provenance: "document_claim", blockId: "blk_42" })
    activate Ledger
    Ledger->>Ledger: Promote edge-101 from canvas_relational to document_claim
    Ledger-->>Sync: Acknowledged
    deactivate Ledger

    Sync->>Compiler: RequestProjectionRecompile("CNN")
    activate Compiler
    Compiler->>Canvas: PushCompiledSnapshot({ edges: [{ id: "edge-101", from: "CNN", to: "ViT", provenance: "document_claim", anchorBlockId: "blk_42" }] })
    deactivate Compiler
    deactivate Sync

    Canvas-->>Canvas: Re-render edge: Change from dashed line to Solid Line with 📄 Icon

    Note over User,Canvas: Later: User navigates on Canvas
    User->>Canvas: Clicks 📄 icon on edge CNN -> ViT
    Canvas->>Lexical: Trigger Event: JumpToBlock({ documentId: "doc-CNN", blockId: "blk_42" })
    Lexical-->>Lexical: Scroll to block blk_42 and highlight with temporary amber outline
```

---

### 5.5 Runtime Interaction Flow 3: Graceful Degradation on Block Deletion

Illustrates what happens when a user deletes a paragraph that contained an anchored claim.

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Researcher
    participant Lexical as Lexical Editor
    participant L1Lint as L1StructuralLinter
    participant Ledger as RelationalLedgerStore
    participant Canvas as Concept Canvas UI

    User->>Lexical: Cuts / Deletes paragraph (blk_42)
    Lexical->>L1Lint: RunL1Audit(documentPayload)
    activate L1Lint

    L1Lint->>Ledger: QueryClaimAnchors("CNN")
    Ledger-->>L1Lint: Returns active claims (edge-101 anchored to blk_42)

    L1Lint->>L1Lint: Detect: blk_42 does NOT exist in AST!
    L1Lint->>Ledger: DowngradeEdge(edge-101, { provenance: "canvas_relational", status: "anchor_lost" })
    activate Ledger
    Ledger-->>L1Lint: Edge updated to anchor_lost
    deactivate Ledger

    L1Lint->>Canvas: Broadcast EdgeStatusUpdated({ edgeId: "edge-101", status: "anchor_lost" })
    deactivate L1Lint

    Canvas-->>Canvas: Render edge as dashed line with ⚠️ warning badge
    Note over Canvas: Structural knowledge is PRESERVED on canvas.<br/>No silent data loss occurs!
```

---

### 5.6 Runtime Interaction Flow 4: Lint-Gated Graph Compilation to SQLite (`compileGraph` $\to$ Canvas $\to$ `readGraph`)

Illustrates an autonomous agent triggering `compileGraph` to lint document linkages, compile the relational ledger, preserve visual layout, and persist the materialized canvas directly to the SQLite database for subsequent `readGraph` queries.

```mermaid
sequenceDiagram
    autonumber
    actor DeepAgent as 🤖 DeepAgent Skill
    participant Tool as WorkspaceTools (compileGraph)
    participant L1 as L1StructuralLinter
    participant Compiler as GraphCompiler
    participant Storage as SQLite Instance Store
    participant ReadTool as WorkspaceTools (readGraph)

    DeepAgent->>Tool: compileGraph({ canvasName: "concept-canvas", failOnError: true })
    activate Tool

    Tool->>L1: RunL1Audit(adapter)
    activate L1
    L1-->>Tool: L1AuditResult { valid: true, errors: 0, warnings: 0 }
    deactivate L1

    Note over Tool,Compiler: Structural integrity verified. Proceeding to compile.
    Tool->>Compiler: compileWorkspace(adapter, existingLayout, "concept-canvas")
    activate Compiler
    Compiler->>Compiler: Ingest RelationalLedgerStore + Documents
    Compiler->>Compiler: Preserve (x, y, w, h) for existing nodes
    Compiler->>Compiler: Auto-provision non-colliding layout for new entities
    Compiler-->>Tool: CompiledGraphProjection (GraphCanvasDTO)
    deactivate Compiler

    Tool->>Storage: adapter.saveCanvas("concept-canvas", compiledGraph)
    activate Storage
    Storage->>Storage: Persist instances/<id>.json (type: "canvas") into SQLite
    Storage-->>Tool: Saved instanceId (e.g. canvas-uuid-42)
    deactivate Storage

    Tool-->>DeepAgent: Structured Result { status: "success", action: "Compiled Graph", instanceName: "concept-canvas", nodeCount: 15, edgeCount: 22 }
    deactivate Tool

    Note over DeepAgent,ReadTool: Autonomous agent inspects compiled graph immediately
    DeepAgent->>ReadTool: readGraph({ instanceName: "concept-canvas", includeMemo: true })
    activate ReadTool
    ReadTool->>Storage: Fetch canvas instance by name & unpack MessagePack
    Storage-->>ReadTool: GraphCanvasDTO
    ReadTool-->>DeepAgent: Structured Graph { nodes: 15, edges: 22, memos: [...] }
    deactivate ReadTool
```

---

## 6. Architectural Trade-offs & Evaluation Matrix

| Decision Area                    | Evaluated Approach                                                                  | Selected Architecture                                    | Architectural Rationale                                                                                                                  |
| :------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **Topological Truth**            | 1. Canvas owns edges<br/>2. Document owns edges<br/>3. Dual-source sync             | **Unified Relational Ledger (Option 3 with Provenance)** | Avoids split-brain drift and eliminates synthetic prose pollution in user documents while maintaining a single ground truth.             |
| **Edge Creation in Canvas**      | 1. Read-only canvas<br/>2. Auto-inject sentences<br/>3. Staged / Ledger edge        | **Ledger Edge (`canvas_relational`)**                    | Allows unconstrained visual-first brainstorming. Drawing an edge never pollutes the human's document with auto-generated text.           |
| **Link UI in Editor**            | 1. Gutter pills<br/>2. Markdown syntax `[[X]]`<br/>3. Inline clickable badges       | **Inline Clickable Badges (`InlineClaimBadgeNode`)**     | Provides direct visual anchoring to specific claims while enabling rich popovers and click-to-block shortcuts without regex parsing.     |
| **Orphan/Broken Link Detection** | 1. LLM reads all files<br/>2. Pure compiler pass                                    | **Two-Tier Linting (L1 Compiler + L2 LLM)**              | L1 provides instant, deterministic, zero-token structural integrity; L2 focuses exclusively on high-value semantic contradictions.       |
| **Paragraph Deletion Handling**  | 1. Delete canvas edge<br/>2. Block paragraph deletion<br/>3. Graceful degradation   | **Graceful Degradation (`status: anchor_lost`)**         | Refactoring text never destroys visual knowledge; edges revert to unanchored state with clear warnings.                                  |
| **Workspace Graph Inspection**   | 1. Agent reads filesystem JSON directly<br/>2. Dedicated compilation tool to SQLite | **Lint-Gated `compileGraph` Tool**                       | Agents operate inside sandboxes without raw disk access; compiling to SQLite enables immediate inspection via existing `readGraph` tool. |
| **Tool Protocol Concurrency**    | 1. Dynamic ad-hoc tool arrays<br/>2. Name-keyed deduplication map                   | **Deduplicated `WorkspaceMiddleware` Tool Map**          | Guarantees mathematically unique tool names sent to LLM providers, strictly satisfying Anthropic/Console Go wire constraints.            |

---

## 7. Security & Failure Mode Analysis

1. **Circular Supersedence Gate (Tarjan SCC)**:
   - _Risk_: An agent or human creates cyclical causal claims ($A \text{ supersedes } B \text{ supersedes } C \text{ supersedes } A$).
   - _Mitigation_: The L1 Linter executes Tarjan's Strongly Connected Components (SCC) algorithm restricted to the `rel: 'supersedes'` subgraph during edge upsert. Any SCC with $>1$ node fails closed with `WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE`, returning structured `cycle` entity sequences and offending `edgeIds` in `error.details` with actionable fix recommendations.
2. **Crash Resilience & Atomic Inversion**:
   - _Risk_: A multi-file atomic operation (`ingestSource`) fails halfway through writing document 3 of 4.
   - _Mitigation_: All disk mutations are paired with mathematically sound inverse commands in `InverseCommandEngine` (ADR-005). If any step fails, inverse operations (`ledger:remove_edge`, `editor:restore_block`) are applied in reverse sequence, guaranteeing atomic consistency.
3. **Cross-Process File Concurrency & Workspace Locking**:
   - _Risk_: Electron Main, UtilityProcess, and WebSocket server concurrent read/write collisions on `ledger-default.json`.
   - _Mitigation_: Governed by `<path>.lock` concurrency protocols (`{ pid, time }`) established in ADR-002 and `baseVersion` optimistic concurrency checks in WebSocket sync.
4. **Lexical Block ID Desynchronization**:
   - _Risk_: Users splitting or merging paragraphs sever anchored claim links.
   - _Mitigation_: Handled by `blockIdentityRegistry.ts` in-place re-anchoring; paragraph deletion triggers graceful degradation (`status: 'anchor_lost'`) rather than knowledge graph edge deletion.
5. **Provider Tool Name Collision & Wire Failures**:
   - _Risk_: Active tools contain duplicate identifiers when merging read and write tool definitions, causing LLM providers to reject the request with HTTP 400 (`[invalid_request_error] Tool names must be unique`).
   - _Mitigation_: `createWorkspaceMiddleware` compiles `activeTools` through a `Map<string, Tool>` keyed by `tool.name`. Tool wrappers enforce standard result envelope `{ status, action, code, message, recommendFix }` with `extractErrorInfo` to prevent unhandled runtime exceptions.
