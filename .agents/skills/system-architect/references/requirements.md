# System Requirements & Architectural Context

## 1. Executive Summary & Objectives

- **Problem Statement**: Autonomous AI agents frequently fail at complex multi-step objectives when constrained to monolithic linear chat sessions. Long-horizon workflows require deterministic decomposition into directed acyclic task graphs (DAGs), multi-agent specialization, rigorous tool confinement, relational memory slicing, and human-in-the-loop (HITL) approval gates.
- **Business & Technical Goals**:
  1. Provide a zero-framework, nominal Graph Intermediate Representation (IR) capable of expressing complex agent topologies and deterministic workflows.
  2. Implement an autonomous orchestration engine that dynamically generates, linters, validates, and executes task graphs.
  3. Deliver a low-latency, reactive visual IDE (Tauri 2.0 / React 19) paired with a headless CLI and daemon for batch runs and background sync.
  4. Ensure end-to-end deterministic session persistence with SQLite WAL event journals and replay capabilities.
  5. Enforce fail-closed security sandboxing across all filesystem and shell execution layers.
- **Primary Personas**:
  - **AI Workflow Engineer / Developer**: Builds, inspects, and debugs visual agent workflows and task graphs.
  - **Autonomous Orchestrator Agent**: Decomposes natural language objectives into task graphs, invokes domain subagents, and evaluates outputs.
  - **Human Operator / Approver**: Interactively approves high-privilege filesystem/shell mutations and resolves human-gate checkpoints.
  - **Domain Subagents**: Specialized agent instances (researcher, coder, reviewer) executing bounded sub-tasks.

---

## 2. Functional Capabilities

| ID | Capability Area | Specification |
|---|---|---|
| **CAP-01** | **Graph Intermediate Representation (IR)** | Zero-framework branded nominal types (`GraphId`, `NodeId`, `EdgeId`, `PortId`), polymorphic node definitions (`subagent_task`, `deterministic_code`, `router_condition`, `evaluator_critic`, `human_gate`, `subgraph_cell`, `knowledge_sink`), static linter rules, and structural validation utilities. |
| **CAP-02** | **Topological Execution Engine** | Wavefront topological scheduler executing nodes as dependencies resolve; supports cycle guard iteration caps, condition evaluation, and trajectory recording. |
| **CAP-03** | **Cordis Capability Spine** | Unified dependency injection harness (`createCapabilityContext`) providing storage, tools, skills, persona, sandboxed filesystem, shell, and Pi-AI LLM model routing across CLI and Desktop. |
| **CAP-04** | **Relational Memory & Knowledge Graph** | Entity and triple storage (`EntityStore`) with declarative sub-graph extraction (`ContextSlicer`) for dynamic prompt context injection. |
| **CAP-05** | **WebSocket Synchronization Protocol** | Real-time JSON-RPC 2.0 protocol over WebSockets for session lifecycle, graph state synchronization, agent preset binding, credential vault access, and event fan-out. |
| **CAP-06** | **Visual Graph Studio & Context Editor** | React Flow canvas (`@xyflow/react`) with custom polymorphic node cards, automatic layouts (Dagre/Sugiyama), CodeMirror 6 markdown context editor with variable interpolation (`{{inputs.var}}`) and entity mentions (`@entity`). |
| **CAP-07** | **Human-in-the-Loop (HITL) Governance** | Audited approval waterfall for sandbox privilege escalation (`approval/asked`, `approval/decided`) with single-shot grants and immediate privilege decay. |

---

## 3. Non-Functional Requirements (Quality Attributes)

| Attribute | Target Metric | Architectural Strategy & Enforcement |
|---|---|---|
| **UI Streaming Latency** | < 50ms per token/chunk | Direct WebSocket push via JSON-RPC 2.0 notifications (`assistant/chunk`, `reasoning/chunk`). |
| **Replay & State Determinism** | 100% replay fidelity | Append-only SQLite WAL session journal; UI state is a pure functional projection (`ConversationStore.fold()`) over immutable event streams. |
| **Sandbox Confinement** | Zero unauthorized escapes | Fail-closed execution; workspace-write boundary verified via path canonicalization; OS-level Seatbelt/bwrap confinement for shell subprocesses. |
| **Type Safety & Integrity** | Zero runtime type divergence | Strict TypeScript with Zero `any` policy (`noImplicitAny`, no suppression tags), Zod runtime validation on all external RPC payloads and graph schemas. |
| **Credential Security** | Zero plain-text leaks | Secrets stored in separate credential vault (`credentials.yaml`), injected per-call via `ctx.credentials`, never persisted in settings files or event logs. |
| **Graph Scheduling Throughput** | Sub-millisecond step dispatch | In-memory topological graph scheduler with asynchronous worker thread isolation for deterministic code nodes. |

---

## 4. System Constraints & Assumptions

1. **Local-First Runtime**: The daemon and desktop application execute locally on user workstations (macOS, Linux, Windows), communicating over loopback WebSockets (`ws://127.0.0.1:<port>`).
2. **Node.js & Tauri Platform**: The backend capability spine runs on Node.js (v20+) using ES Modules; the desktop frontend runs within Tauri 2.0 (WebKit / WebView2) with React 19.
3. **Upstream Harness Integration**: The capability context mounts vendored DeepSeek Harness (`@deepseek-ai/*`) packages and Pi-AI (`@earendil-works/pi-ai`) for LLM streaming.
4. **Single-Writer SQLite Persistence**: Each session database operates in WAL mode with single-writer guarantees, eliminating multi-process lock contention.
