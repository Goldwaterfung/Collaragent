# CollarAgent System Requirements & Architectural Context

## 1. Executive Summary & Objectives

### 1.1 Problem Statement

Modern knowledge workers and software engineers navigate complex cognitive tasks spanning knowledge graph design, multi-document authoring, and autonomous agent orchestration. Existing tools are either purely text-based conversational chats or static, disconnected diagramming and text tools. When AI agents modify documents or visual graphs, they often perform destructive overwrites without clear visual diffs or time-travel safety.

### 1.2 Business & System Goals

- **Unified Visual IDE**: Deliver a single desktop application combining an infinite node-link canvas, rich-text Lexical document editor, and ReAct agent assistant.
- **Controlled Agent Staging**: Ensure AI agents propose structural graph changes and document edits as reversible staged proposals with visual diff reviews (`accept-changes` / `reject-changes`).
- **Deterministic Time Travel**: Provide atomic, cross-workspace checkpointing that captures conversational threads, LangGraph agent execution checkpoints, and multi-instance workspace snapshots into a single rollback unit.
- **Local-First & Offline-Capable**: Store all project state in portable single-file `.cagent` SQLite databases (WAL mode) with zero reliance on mandatory cloud backends (with backwards-compatible migration for legacy V3 sharded archives).

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
- Native block drag-and-drop handles for intra-document block reordering via `DraggableBlockPlugin`.
- Inline review comments and annotations bound to text spans.
- Native export to Microsoft Word (`.docx`) format via `docxExportUtils.ts`.

### 2.3 Agent Runtime & Multi-Agent Orchestration (`src/collaragent`)

- LangGraph ReAct execution loop (`createDeepAgent`) supporting streaming tokens, reasoning traces (extended CoT), and function calling.
- Multi-provider LLM support: OpenAI (GPT-4o, GPT-5.2), Anthropic (Claude Sonnet 3.5/4.5 with prompt caching), Google (Gemini 2.5), Ollama, and OpenCode Go (`@earendil-works/pi-ai/providers/opencode-go`).
- Subagent delegation via `task` and `dynamic_task` tools with state isolation and recursion ceilings (`recursionLimit: 200`).
- Multi-chat concurrent execution: Supports parallel chat docks within the Dockview layout running concurrent agent streams isolated by unique `streamId` and `threadId`.
- Progressive disclosure skills system following the Agent Skills specification (`https://agentskills.io/specification`).
- Native Model Context Protocol (MCP) integration over STDIO and SSE transports.

### 2.4 Time-Travel Checkpointing & State Synchronization (`src/shared/checkpoints`, `src/workspace/sync`)

- Post-turn automatic checkpoint capture and session baseline checkpointing with point-in-time restoration markers in the chat timeline.
- Decoupled turn auto-checkpointing: Transactional `wsHandle.flush()` flushes dirty state directly without emitting window-wide `CHECKPOINT_QUIESCE`, allowing concurrent chat agents to stream without dropped frames or paused sockets (ADR-009).
- Thread-partitioned staging proposals: Staged modifications (`staged: true`) are buffered by `(instanceId, threadId)`, enabling independent proposal reviews (`accept-changes` / `reject-changes`) across concurrent agents.
- Optimistic Concurrency Control (OCC): Mutation commands submit `baseVersion` and are rejected with `WORKSPACE_STALE_BASE_VERSION` if applying against an outdated instance sequence.
- Resilient client lifecycle: `SyncClient` pre-handles internal `readyPromise` with `.catch(() => {})`, preventing unhandled promise rejection crashes during React fiber unmounting and layout adjustments.
- Idempotent Content-Addressed Storage (CAS) with decoupled immutable blobs (`workspace_blobs`) and reference-pointer snapshots (`workspace_snapshots_v5`) guaranteeing cascade-deletion immunity.
- Non-linear DAG tree checkpoint lineage (`parentBundleId`, `branchName`) with fail-closed state restoration (`STORAGE_CHECKPOINT_NOT_FOUND` if snapshot data is missing) and WebSocket OCC sequence realignment (`system-checkpoint-restore`).
- Bi-directional WebSocket synchronization (`/ws/canvas/:id`, `/ws/editor/:id`) with monotonic sequence acknowledgments.
- Deterministic diff and inverse command engines (`CanvasDiffEngine`, `DocumentDiffEngine`, `InverseCommandEngine`) providing mathematical command inversion for granular undo/redo.

### 2.5 Relational Knowledge Ledger & LLM Wiki Subsystem (`src/workspace/wiki`, `src/collaragent/tools/wiki`)

- Grounded claim architecture linking document paragraphs to knowledge graph triples via immutable Lexical block UUIDs (`BlockIdPlugin`) and inline badges (`InlineClaimBadgeNode`).
- Persistent relational ledger (`RelationalLedgerPayload`) stored as first-class workspace instance (`instances` table with `type = 'ledger'`) tracking entity nodes, typed predicates, and claim anchors `(source, predicate, target, claimId)`.
- Two-tier semantic linting: L1 deterministic structural audit (`L1StructuralLinter`) for broken anchors and unreferenced claims, and L2 LLM-powered contradiction audit (`L2SemanticLinter`) for epistemological conflict detection.
- Mathematical ledger command inversion unified inside `InverseCommandEngine.ts` (`invertWikiLedgerPatch`) ensuring 100% reversible rollback of ledger mutations upon proposal rejection.
- Unified wiki tool suite (`compileGraph`, `lintWorkspace`, `ingestSource`, `queryAndFileBack`, `pruneLedger`, and adapter `loadLedger`) enabling autonomous agents to ground claims directly in document evidence.

### 2.6 Event-Driven Serialized Drain Queue & Read Barriers (`src/workspace/sync/drain`, `src/main/server/ws`)

- Elimination of temporal debouncing: Deprecated `setTimeout(..., 500)` debounce timers completely replaced by deterministic `SerializedDrainQueue` with single-flight concurrency (`Concurrency = 1`).
- Dirty state coalescing: High-frequency mutations while a write is in-flight transition the worker to `COALESCING`, buffering only the latest snapshot and immediately triggering the next single-flight write upon completion.
- Transactional read barriers: `SerializedDrainQueue.flush()` registers deferred barrier promises that resolve only when active and coalesced writes settle to SQLite disk, eliminating stale reads by autonomous AI agent tools.
- Non-blocking exponential backoff with full jitter (`BackoffPolicyEngine`) for transient SQLite busy or disk I/O errors without blocking the Node.js event loop.
- End-to-end cancellation token propagation: `SyncClient`, `TransactionalBarrierRegistry`, and `InstanceDrainWorker` bind directly to `AbortSignal`, enabling immediate, clean resource teardown.

---

## 3. Non-Functional Requirements (Quality Attributes)

| Attribute                   | Target Metric                              | Architectural Strategy                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI Responsiveness (p95)** | < 16ms (60 FPS during canvas pan/zoom)     | Decoupled SVG edge rendering and DOM node layering; offloaded Leiden clustering to background Web Worker.                                                                                                                                                  |
| **Stream Latency (TTFT)**   | < 350ms to first token                     | AsyncGenerator streaming over isolated dynamic IPC channels with token unbuffering.                                                                                                                                                                        |
| **Multi-Agent Concurrency** | Zero cross-thread blocking                 | Thread-partitioned WebSocket proposal buffers, OCC sequence validation, and lock-free turn checkpoints without global window pauses.                                                                                                                       |
| **Storage Scalability**     | > 10,000 nodes / 500 documents per project | Single-file SQLite V7 True DAG and CAS storage engine with SHA-256 deduplicated blobs, B-Tree indexing, self-contained LangGraph checkpoints, and MessagePack compression (`instances`, `workspace_blobs`, `snapshots`, `chat_sessions`, `chat_messages`). |
| **Data Integrity & Safety** | Zero data loss on abrupt window close      | Lock-file process concurrency protection, single-flight `SerializedDrainQueue` dirty state flush, transactional read barriers, and atomic SQLite disk writes.                                                                                              |
| **Memory Isolation**        | Max 500MB RAM baseline                     | Heavy project I/O, SQLite database engine, WAL checkpoints, and Express REST server forked into decoupled Node.js `UtilityProcess`.                                                                                                                        |
| **Security & Privacy**      | Zero plain-text credential leaks           | API keys encrypted using OS-level `safeStorage` (Keychain / DPAPI / Secret Service) with `0o600` file permissions.                                                                                                                                         |

---

## 4. System Constraints & Invariants

1. **Zero-Dependency Shared Layer**: `src/shared` must remain free of platform-specific imports (no Electron, no DOM, no Node `fs`).
2. **Contract-First & Type-Branded**: All IPC boundaries and API payloads are validated via Zod schemas; canvas identifiers (`NodeId`, `RelationshipId`, `PortId`, `GraphId`) enforce nominal type branding.
3. **No Hardcoded Constants**: Dimensional parameters (`DEFAULT_NODE_WIDTH = 300`, `NODE_SPACING = 200`) and design tokens (`--color-surface-50` to `--color-surface-300`) must be referenced from centralized constants and `DESIGN.md`.
4. **No Unchecked Fallbacks**: Silent fallback logic that conceals errors is forbidden; schema mismatches and I/O failures must bubble up as typed errors.
5. **Context Window Protection**: Tool outputs exceeding 20,000 tokens (~80KB) are automatically evicted to the `large_tool_outputs` SQLite table (accessible via `/large_tool_results/` virtual endpoints) and replaced with truncated previews.
6. **Fail-Closed Checkpoint Integrity**: Checkpoint restoration and snapshot resolution must fail closed with structured error codes (`STORAGE_CHECKPOINT_NOT_FOUND`) if backing CAS blobs are unresolvable, strictly prohibiting destructive in-memory or database overwrites with empty or null state.
7. **Non-Destructive True DAG History**: Time-travel checkpoint restoration and branch switching must never physically delete historical messages from `chat_messages`. Alternate branches must remain permanently addressable via `parent_message_id` and active branch pointers (`active_message_id`), loaded via recursive Common Table Expressions (CTE).
8. **Self-Contained LangGraph Checkpoint Blobs**: LangGraph checkpoints in `langgraph_checkpoints` must store complete, self-contained `channel_values` payloads directly within `checkpoint_json`. External blob deduplication keyed on step sequence numbers that collide across branches is strictly forbidden.
9. **Zero Temporal Timers in Persistence & Sync**: Throttling or debouncing persistence writes with arbitrary `setTimeout` delays (e.g. `setTimeout(..., 500)`) and relying on sleep delays in test suites are strictly prohibited. All persistent transitions, batching, and flushes must be driven by deterministic lifecycle events (`SerializedDrainQueue`).
10. **Read-After-Write Consistency via Transactional Barriers**: All agent tool queries and workspace audit tools (`readDocument`, `readGraph`, `pruneLedger`, `lintWorkspace`, and adapter `loadLedger`) must pass `flushBeforeRead: true` to await disk settlement of in-flight mutations before reading, guaranteeing zero stale reads with zero artificial delay.
11. **Zero `any` & Deprecated Legacy Code Purge**: Strict zero `any` policy across all production and test code. Obsolete storage engines (`storageEngine.ts`, `ArchiveManager.ts`, `FileCheckpointStore.ts`, legacy V2/V3 monolith handlers) must be purged to maintain an unencumbered, maintainable V4 SQLite Embedded Storage Architecture.
