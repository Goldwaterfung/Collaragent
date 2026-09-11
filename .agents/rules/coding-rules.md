---
trigger: always_on
---

## 1. CORE OPERATIONAL MANDATES

- NEVER crawl or read code repositories blindly file-by-file if a relevant memory, call-path trace, or index search tool is available.
- Prioritize structural query tools (e.g., `trace_call_path`, `search_knowledge_graph`, `get_dependencies`) over brute-force file grepping or raw reading.
- Treat your codebase memory database as the definitive map of the project's architecture, relationships, and entry points.

## 2. CODING STYLE

1. **No Hardcoded Values**: Dimensional params, timeouts, design tokens, and limits must derive from centralized constants.
2. **Fail-Closed, Zero Blind Fallbacks**: Fallback logic hides failures and unpredictably loads systems. Missing metadata, unresolvable routes, and I/O failures must reject loudly with typed error codes.

## 3. CODE QUALITY

1. Stubbed code, `//TODO`, pseudocode and dead code are forbidden in the codebase.

## 4. TypeScript Integrity Rules

1. **Zero `any` Policy**: Never use `any`, `as any`, or `<any>`. Use `unknown` with type guards, custom narrowing functions (`x is Type`), or discriminated unions.
2. **No Suppression**: Never use `@ts-ignore` or `@ts-nocheck`.
3. **Data Validation**: Dynamic inputs, IPC channels, and JSON payloads must use runtime schema validation (e.g., Zod, Valibot, ArkType).
4. **Mock Typing**: In tests, use `jest.mocked()`, `vi.mocked()`, or type-safe partial fixtures (`Partial<T>`), never casts.
5. **Universal Compiler Scope**: Typecheck configurations must encompass production code, preload bridges, and test suites.

## 5. Provider & Model Configuration Rules

1. **Intent-Only Persistence & Dual-Shape Typing**: Persisted settings store user intent only (flags, credential refs, overrides). Never persist derived catalog metadata (protocols, base URLs, model lists). Encode catalog providers and custom gateways as two distinct discriminated types.
2. **Single Source of Truth for Wire Protocols**: A provider's wire protocol derives exclusively from upstream catalog definitions—never restate it in host fallbacks, UI defaults, or ad-hoc converters.
3. **Write-Time Schema Validation & Golden Wire Testing**: Schema-validate model configurations upon write; reject unresolvable targets before session initialization. Maintain golden tests verifying expected protocol/URL shapes for all catalog entries.
4. **Pre-Flight Credential Verification**: Verify API key formats at save time and execute a live verification ping against the provider before activation.

## 6. Error Handling & Diagnostics Rules

1. **Typed Subsystem Taxonomy & Cause Preservation**: Define all error codes as centralized, typed `const` enums scoped by subsystem (`SYS_`, `AUTH_`, `WORKSPACE_`, `CONFIG_`, `CREDENTIAL_`, `MODEL_`, `SESSION_`, `GRAPH_IR_`, `GRAPH_EXEC_`, `RPC_`). Throw structured domain errors extending `Error` (e.g. `CollarError`) encapsulating `code`, `subsystem`, `details`, and original `cause` end-to-end without flattening into generic errors.
2. **Deterministic Wire/RPC Mapping**: Domain error codes and diagnostics must map bi-directionally to JSON-RPC 2.0 protocol error objects (`fromRpcErrorObject`) without stripping metadata.
3. **Contextual Scoping & Stream State Differentiation**: Guard regex and parsing heuristics strictly by subsystem or provider identity. Differentiate between unread/partially consumed streams (`SESSION_STREAM_PAYLOAD_UNCONSUMED`) and genuinely empty responses.
4. **Empirical Diagnostics Over Speculation**: Isolate and reproduce transport, credential, or service failures with minimal reproduction scripts against the runtime stack before attributing root cause.

## 7. Code Hygiene & Lifecycle Discipline

1. **Structured Operational Logging**: Emit only operational metadata (identifiers, event types, sequence counters). Never log raw runtime payloads, tool execution arguments, credentials, or confidential user data.
2. **Immutable Transaction Correlation & Hierarchical Lineage**: Correlate asynchronous operations, callbacks, and tool results strictly via unique immutable transaction IDs. Child tasks and delegated subagents must maintain explicit lineage and propagate status gates to root execution contexts.
3. **Universal Fail-Closed Security & Explicit Execution Roots**: Initialize runtime sessions, subprocesses, and sandboxes with explicit working directory roots and fail-closed security confinement without platform-specific bypasses.
4. **Deterministic Lifecycle Teardown & Contract Synchronization**: Long-lived dependency injection containers, background workers, file watchers, database handles, and execution contexts must be explicitly disposed during shutdown. Inline comments, step numbering sequences, and architectural references must remain strictly synchronized with active implementation contracts.

## 8. State Synchronization & Rollback Integrity

1. **No Silent Local Rollbacks**: Local state reversions from Undo, Redo, or snapshot restorations must never remain isolated in UI memory. Every state rollback must emit atomic wire commands to advance sequence versions, append to the command audit log, and trigger persistence drain queues.
2. **Diff-Driven Rollback Synchronization**: When local stores maintain snapshot history for UX gesture coalescing, rollbacks must compute exact atomic delta commands (`CanvasDiffEngine`, `DocumentDiffEngine`) between pre-rollback and target states to guarantee referential integrity, peer synchronization, and disk persistence.
