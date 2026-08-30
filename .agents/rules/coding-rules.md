---
trigger: always_on
---

## 1. CORE OPERATIONAL MANDATES
- NEVER crawl or read code repositories blindly file-by-file if a relevant memory, call-path trace, or index search tool is available.
- Prioritize structural query tools (e.g., `trace_call_path`, `search_knowledge_graph`, `get_dependencies`) over brute-force file grepping or raw reading.
- Treat your codebase memory database as the definitive map of the project's architecture, relationships, and entry points.

## 2. CODING STYLE
1. Hardcoded values or parameters are forbidden in this project.
2. AVOID using fallbacks in the project as fallback logic places unpredictable load on the system.

## 3. CODE QUALITY
1. Stubbed code, `//TODO`, pseudocode and dead code are forbidden in the codebase.

## 4. TypeScript Integrity Rules
1. **Zero `any` Policy**: Never use `any`, `as any`, or `<any>`. Use `unknown` with type guards, custom narrowing functions (`x is Type`), or discriminated unions.
2. **No Suppression**: Never use `@ts-ignore` or `@ts-nocheck`.
3. **Data Validation**: For dynamic inputs, APIs, or JSON parsing, use runtime validation (e.g., Zod, Valibot, ArkType) instead of casting.
4. **Mock Typing**: In tests, do not cast mocks with `as any`. Use `jest.mocked()`, `vi.mocked()`, or type-safe partial fixtures (`Partial<T>` combined with standard interfaces).

## 5. Provider & Model Configuration Rules
1. **Never persist derived/catalog state into user settings.** Persisted configuration stores *user intent only* (enabled flags, credential refs, explicit overrides). Values derivable from an upstream catalog — wire protocol (`api`), `thinkingFormat`, default model lists, builtin base URLs — MUST NOT be copied into settings files. If upstream changes, persisted snapshots silently rot.
2. **Catalog providers vs custom routes are different shapes.** A configured catalog provider (e.g. `google`, `deepseek`) persists identity only; a truly custom gateway persists full config (`baseURL`, `api`, `models`). Encode this as two distinct types, never one permissive type.
3. **One source of truth per fact.** A provider's wire protocol comes from exactly one place (pi-ai builtin model metadata). Do not restate it in host fallbacks, UI defaults, and conversion helpers; if a second layer needs it, import/query it, never re-declare it.
4. **No blanket fallbacks for provider metadata.** A fallback like `api ?? 'openai-completions'` fabricates facts for every provider it touches and turns silent misrouting into runtime failures (this exact bug). If the true value cannot be resolved, fail loudly at load/write time instead of guessing.
5. **Validate configuration at write time, not first use.** Schema-validate the models namespace on save and reject routes that cannot resolve to a runnable target (unknown `api`, missing `baseURL` where required, unresolvable credential ref). Invalid configs must never survive into a session start.
6. **Keep golden tests mapping every builtin provider id to its expected protocol/baseUrl/auth shape.** Any change to catalog derivation that breaks a provider becomes an immediate test failure instead of a user-reported bug.
7. **Verify credentials early and cheaply.** On credential save, check format (e.g. Gemini keys are `AIza…`); offer a live verification ping against the provider before activation. An unusable key must surface at setup time, not as a mid-session LLM error.

## 6. Error Handling & Diagnostics Rules
1. **Centralized Error Code Enums & Subsystem Taxonomy**: All error codes must be defined as centralized, typed `const` enums (e.g. `CollarErrorCode`, `SystemErrorCode`, `AuthErrorCode`, `WorkspaceErrorCode`, `ConfigErrorCode`, `CredentialErrorCode`, `ModelProviderErrorCode`, `SessionErrorCode`, `GraphIRErrorCode`, `GraphExecErrorCode`, `RpcErrorCode`) scoped by subsystem prefix (`SYS_`, `AUTH_`, `WORKSPACE_`, `CONFIG_`, `CREDENTIAL_`, `MODEL_`, `SESSION_`, `GRAPH_IR_`, `GRAPH_EXEC_`, `RPC_`). Raw magic strings, ad-hoc string literals, or un-enumerated numeric error codes are strictly prohibited.
2. **Standardized Error Class & End-to-End Cause Preservation**: Throw structured domain errors extending `Error` (e.g. `CollarError`) encapsulating the typed enum `code`, `subsystem`, structured `details`, `recoverable`, and the original `cause`. Upstream errors (Node.js I/O, SQLite, network fetch, LLM providers) must be preserved end-to-end in the cause chain rather than flattened into lossy string messages or generic `new Error(...)`.
3. **Deterministic Wire & Transport Mapping**: Domain error codes must map deterministically to JSON-RPC 2.0 protocol error codes. Client transport layers (e.g. Desktop RPC Client) must rehydrate structured error codes and diagnostic payloads from wire responses (`fromRpcErrorObject`) rather than stripping metadata into generic runtime errors.
4. **Contextual Error Classification & Explicit Guarding**: Heuristics, regex matchers, and error-parsing logic must be strictly guarded by subsystem or provider identity. Never apply pattern-matching heuristics globally across heterogeneous backends to prevent cross-service misclassification.
5. **Strict Differentiation of Omission vs. Unconsumed State**: Distinguish between genuinely empty responses and unread or partially consumed streams/payloads. Treat unread data as indeterminate (`SESSION_STREAM_PAYLOAD_UNCONSUMED`) rather than assuming empty content or deriving false diagnostic conclusions.
6. **Empirical Reproduction Over Speculative Diagnosis**: When diagnosing subsystem, transport, or service integration failures, isolate and reproduce the issue using a minimal script against the real runtime stack before theorizing. Validate credentials and transport independently before attributing root cause to application logic.
7. **No Blind Fallback Errors**: Do not swallow or default unknown errors to generic codes without preserving structured diagnostics and upstream causes.


## 7. Code Hygiene & Lifecycle Discipline
1. **Log Hygiene & Sensitive Data Protection**: Never emit raw runtime events, tool execution arguments, or unredacted payloads directly to standard output or unstructured logs. Emit only structured operational metadata (e.g. identifiers, event types, sequence counters) to prevent leaking secrets, credentials, or confidential user data.
2. **Deterministic Asynchronous Correlation**: Correlate asynchronous operations, callbacks, tool results, and human-in-the-loop decisions strictly through unique, immutable transaction identifiers rather than state-dependent log scans, preventing race conditions under concurrent execution.
3. **Hierarchical Lineage & Root Context Propagation**: Nested tasks, child executions, and subagents must maintain explicit lineage to their parent context. Interactive gates, escalations, and status transitions occurring in delegated scopes must propagate to the root execution context to prevent unmonitored execution deadlocks.
4. **Explicit Execution Boundaries**: Runtime sessions, sandboxes, and subprocesses must be initialized with explicit working directory and workspace root metadata. Never rely on ambient process defaults to define containment fences or security policies.
5. **Universal Fail-Closed Security Confinement**: Security sandboxes, access policies, and permission gates must fail closed consistently across all platforms and operating environments without conditional or platform-specific bypasses.
6. **Deterministic Resource Teardown & Lifecycle Disposal**: Long-lived dependency injection containers, background workers, file watchers, database handles, and execution contexts must be explicitly disposed during shutdown to prevent resource leaks and locked state.
7. **Comprehensive Typechecking & Quality Gate Scope**: Static analysis and compiler configurations must encompass both production implementations and test suites, ensuring type integrity across the entire codebase and preventing API mismatches from surviving CI gates.
8. **Documentation & Source Synchronization**: Inline comments, step numbering sequences, and architectural references must remain strictly synchronized with active implementation contracts, avoiding duplicate step indices, stale commentary, or speculative dead code.