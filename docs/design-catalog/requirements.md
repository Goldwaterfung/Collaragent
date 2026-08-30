# CollarAgent System Requirements & Architectural Context

## 1. Executive Summary & Objectives

### 1.1 Problem Statement
Modern knowledge workers and software engineers navigate complex cognitive tasks spanning knowledge graph design, multi-document authoring, and autonomous agent orchestration. Existing tools are either purely text-based conversational chats or static, disconnected diagramming and text tools. When AI agents modify documents or visual graphs, they often perform destructive overwrites without clear visual diffs or time-travel safety.

### 1.2 Business & System Goals
- **Unified Visual IDE**: Deliver a single desktop application combining an infinite node-link canvas, rich-text Lexical document editor, and ReAct agent assistant.
- **Controlled Agent Staging**: Ensure AI agents propose structural graph changes and document edits as reversible staged proposals with visual diff reviews (`accept-changes` / `reject-changes`).
- **Deterministic Time Travel**: Provide atomic, cross-workspace checkpointing that captures conversational threads, LangGraph agent execution checkpoints, and multi-instance workspace snapshots into a single rollback unit.
- **Local-First & Offline-Capable**: Store all project state in portable `.cagent` ZIP archives and live sharded `.collar` folders with zero reliance on mandatory cloud backends.

### 1.3 Target Audience & Personas
- **Knowledge Worker / Systems Thinker**: Constructs mental models, mind maps, and structured research documents.
- **Software Engineer / Architect**: Maps distributed topologies, designs entity schemas, and inspects agent reasoning traces.
- **Academic / Technical Writer**: Uses specialized skills (e.g. APA research execution, document compilation to DOCX).

---

## 2. Functional Capabilities

### 2.1 Visual Graph Canvas (`src/workspace/canvas`)
- Infinite zoom and pan canvas supporting interactive card nodes and directional relationships.
- Dynamic 4-cardinal port generation (North, East, South, West) with cubic Bezier routing and collision-aware normal vectors.
- Automated hierarchical layouts via `@dagrejs/dagre` and polar radial tree layouts via `d3-hierarchy`.
- Hierarchical Leiden community detection clustering executed off-thread via Web Workers (`leiden.worker.ts`).
- Embedded Lexical `MemoEditor` cards within graph nodes.

### 2.2 Rich-Text Document Engine (`src/workspace/editor`)
- Full-featured document editor built on Lexical (`CardEditor.tsx`) with typography, headings, code syntax highlighting (Prism), GFM tables, and LaTeX mathematical formulas (KaTeX).
- Native block drag-and-drop handles for reordering and dragging blocks onto the graph canvas.
- Inline review comments and annotations bound to text spans.
- Native export to Microsoft Word (`.docx`) format.

### 2.3 Agent Runtime & Multi-Agent Orchestration (`src/collaragent`)
- LangGraph ReAct execution loop (`createDeepAgent`) supporting streaming tokens, reasoning traces (extended CoT), and function calling.
- Multi-provider LLM support: OpenAI (GPT-4o, GPT-5.2), Anthropic (Claude Sonnet 3.5/4.5 with prompt caching), Google (Gemini 2.5), and Ollama.
- Subagent delegation via `task` and `dynamic_task` tools with state isolation and recursion ceilings (`recursionLimit: 200`).
- Progressive disclosure skills system following the Agent Skills specification (`https://agentskills.io/specification`).
- Native Model Context Protocol (MCP) integration over STDIO and SSE transports.

### 2.4 Time-Travel Checkpointing & State Synchronization (`src/shared/checkpoints`, `src/workspace/sync`)
- Pre-turn automatic checkpoint capture and point-in-time restoration markers in the chat timeline.
- Bi-directional WebSocket synchronization (`/ws/canvas/:id`, `/ws/editor/:id`) with monotonic sequence acknowledgments.
- Deterministic diff and inverse command engines (`CanvasDiffEngine`, `DocumentDiffEngine`, `InverseCommandEngine`) providing mathematical command inversion for granular undo/redo.

---

## 3. Non-Functional Requirements (Quality Attributes)

| Attribute | Target Metric | Architectural Strategy |
|---|---|---|
| **UI Responsiveness (p95)** | < 16ms (60 FPS during canvas pan/zoom) | Decoupled SVG edge rendering and DOM node layering; offloaded Leiden clustering to background Web Worker. |
| **Stream Latency (TTFT)** | < 350ms to first token | AsyncGenerator streaming over isolated dynamic IPC channels with token unbuffering. |
| **Storage Scalability** | > 10,000 nodes / 500 documents per project | Sharded V3 storage engine (`manifest.json`, `instances/*.json`, `snapshots/*.msgpack`) with MessagePack binary encoding. |
| **Data Integrity & Safety** | Zero data loss on abrupt window close | Lock-file process concurrency protection, pre-close dirty state flush, and atomic disk writes. |
| **Memory Isolation** | Max 500MB RAM baseline | Heavy project I/O, ZIP extraction, and Express REST server forked into decoupled Node.js `UtilityProcess`. |
| **Security & Privacy** | Zero plain-text credential leaks | API keys encrypted using OS-level `safeStorage` (Keychain / DPAPI / Secret Service) with `0o600` file permissions. |

---

## 4. System Constraints & Invariants

1. **Zero-Dependency Shared Layer**: `src/shared` must remain free of platform-specific imports (no Electron, no DOM, no Node `fs`).
2. **Contract-First & Type-Branded**: All IPC boundaries and API payloads are validated via Zod schemas; canvas identifiers (`NodeId`, `RelationshipId`, `PortId`, `GraphId`) enforce nominal type branding.
3. **No Hardcoded Constants**: Dimensional parameters (`DEFAULT_NODE_WIDTH = 300`, `NODE_SPACING = 200`) and design tokens (`--color-surface-50` to `--color-surface-300`) must be referenced from centralized constants and `DESIGN.md`.
4. **No Unchecked Fallbacks**: Silent fallback logic that conceals errors is forbidden; schema mismatches and I/O failures must bubble up as typed errors.
5. **Context Window Protection**: Tool outputs exceeding 20,000 tokens (~80KB) are automatically evicted to `/large_tool_results/` and replaced with truncated previews.
