# Implementation Plan: Langfuse Telemetry & Evaluation Architecture

> **Specification Reference**: Detailed technical architecture, contracts, and data models are specified in [`spec-langfuse-telemetry-and-evaluation.md`](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/tasks/spec-langfuse-telemetry-and-evaluation.md).

## Stack Detection & Official Documentation Sources

```
STACK DETECTED (from package.json):
- Node.js 20+ / TypeScript 7.0.2 / Electron 43.4.1
- @langchain/core: ^1.2.9
- @langchain/langgraph: ^1.4.12
- langchain: ^1.5.10
- langfuse: ^3.38.20
- @langfuse/langchain: ^5.11.0
- @opentelemetry/api: ^1.9.1
- vitest: ^4.1.11
```

All implementation decisions are grounded directly in the local official Langfuse documentation catalog in [`docs/langfuse`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse):

| Domain                               | Pattern / API                                                         | Local Documentation Source Citation                                                                                                                                                                                 |
| :----------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LangChain & LangGraph Tracing**    | `CallbackHandler` from `@langfuse/langchain`                          | [`langchain.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/langchain.md) & [`tracing.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/tracing.md)                               |
| **Tracing Best Practices**           | Observation nesting, agent observation types, trace metadata          | [`best-practices.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/best-practices.md)                                                                                                               |
| **Evaluation & Scoring**             | `langfuse.score.create` (`NUMERIC`, `BOOLEAN`, `CATEGORICAL`, `TEXT`) | [`evaluation-scores-sdk.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/evaluation-scores-sdk.md) & [`evaluation.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/evaluation.md) |
| **Dataset & Experiments Data Model** | `Dataset`, `DatasetItem`, `DatasetRun`, `DatasetRunItem`              | [`data-model.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/data-model.md)                                                                                                                       |
| **Experiments Execution via SDK**    | Dataset iteration and evaluation runs                                 | [`evaluation-experiments-sdk.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/evaluation-experiments-sdk.md)                                                                                       |
| **Sessions & Grouping**              | `sessionId` dynamic attribution                                       | [`sessions.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/sessions.md)                                                                                                                           |
| **Tags & Categorization**            | `tags` array on traces                                                | [`tracing-features-tags.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/tracing-features-tags.md)                                                                                                 |
| **Lifecycle Queue Flushing**         | `await langfuseHandler.flushAsync()` / `await langfuse.flush()`       | [`langchain.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/langchain.md)                                                                                                                         |
| **Self-Hosted Deployment**           | Docker Compose with PostgreSQL                                        | [`self-hosting.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/self-hosting.md)                                                                                                                   |
| **Overview & Core Getting Started**  | Tracing, Setup & Architecture Overview                                | [`overview.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/overview.md) & [`get-started.md`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse/get-started.md)                         |

---

## Architectural Decisions & Build Isolation

1. **Strict Build Separation**: The evaluation harness (`evals/`) executes headlessly in Node.js / Vitest and is **not bundled into the Electron desktop application**. Rollup entrypoints in `electron.vite.config.ts` remain isolated to `src/main`, `src/preload`, and `src/renderer`.
2. **Non-Invasive Fail-Safe Telemetry**: Telemetry in `src/collaragent/telemetry/langfuse.ts` attaches via LangChain `callbacks`. If `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are unset, it resolves to `undefined` with zero network overhead, zero process lock, and zero runtime errors.
3. **Deterministic Multi-Tier Invariant Checks**: Scenarios verify mathematical rollback byte parity (`InverseCommandEngine`), Lexical AST block integrity, and Zod tool schemas before committing scores to Langfuse datasets.
4. **Mandatory Asynchronous Queue Drain**: Every evaluation scenario awaits `langfuseHandler.flushAsync()` and `langfuse.flush()` inside `finally` blocks to guarantee zero dropped spans in CLI runners.

---

## Vertical Task Breakdown

### Phase 1: Foundation & Telemetry Bridge

#### Task 1: Docker Compose Local Infrastructure (Langfuse v4)

- **Description**: Configure the self-hosted local Langfuse v4 distributed stack (`docker-compose.langfuse.yml`) and `.env.eval.example` with web server, worker, ClickHouse, Redis, PostgreSQL, and MinIO.
- **Acceptance Criteria**:
  - `docker-compose.langfuse.yml` defines `langfuse-server` (image: `docker.langfuse.com/langfuse/langfuse:4`), `langfuse-worker:4`, `clickhouse:latest`, `redis:7.2-alpine`, `postgres:16-alpine`, and `minio/minio`.
  - Healthcheck configured for PostgreSQL, ClickHouse, Redis, and MinIO.
  - `.env.eval.example` documents `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL=http://localhost:3000`.
- **Files**: `docker-compose.langfuse.yml`, `.env.eval.example`
- **Dependencies**: None
- **Scope**: Small (2 files)

#### Task 2: Fail-Safe Langfuse Telemetry Bridge with Root Trace Propagation

- **Description**: Implement `src/collaragent/telemetry/langfuse.ts` and `evals/telemetry/langfuse.ts` exposing `createLangfuseHandler({ sessionId, tags, runName, userId, updateRoot })` and lifecycle flush helpers.
  - Returns `LangfuseCallbackHandler` with root trace input propagation on `handleChainStart` (`!parentRunId`) and output propagation on `handleChainEnd`.
  - Returns `undefined` safely when credentials are unset without throwing errors or creating network requests.
  - Exposes `flushTelemetry(handler)` awaiting `handler.flushAsync()`.
- **Files**: `src/collaragent/telemetry/langfuse.ts`, `src/collaragent/telemetry/types.ts`, `evals/telemetry/langfuse.ts`, `evals/telemetry/types.ts`
- **Dependencies**: Task 1

---

### Checkpoint: Foundation & Telemetry Bridge

- [ ] Docker stack boots on `localhost:3000` via `docker compose -f docker-compose.langfuse.yml up -d`
- [ ] Telemetry bridge handles both initialized and missing credential states cleanly without exceptions
- [ ] `yarn typecheck` passes

---

### Phase 2: Evaluation Core & Invariant Verification

#### Task 3: Deterministic Assertion & Invariant Engine

- **Description**: Implement `evals/assertions/AssertionEngine.ts` to programmatically validate scenario outcomes.
- **Acceptance Criteria**:
  - Asserts Zod schema validity for all tool calls in the trajectory.
  - Asserts Lexical AST integrity (unique node/block IDs, valid heading levels, table structures).
  - Asserts Visual Canvas graph invariants (acyclicity, valid node links).
  - Asserts Mathematical Rollback Parity: executing `InverseCommandEngine` commands yields 100% byte-identical state against initial snapshot.
- **Files**: `evals/assertions/AssertionEngine.ts`, `evals/assertions/types.ts`
- **Dependencies**: Task 2
- **Scope**: Medium (2 files)

#### Task 4: Dataset & Score Management Client

- **Description**: Implement `evals/telemetry/DatasetScoreManager.ts` using the `langfuse` JS SDK to sync dataset items and record quantitative scores.
- **Acceptance Criteria**:
  - Creates/syncs Langfuse Datasets (`langfuse.createDataset`, `langfuse.createDatasetItem`).
  - Records standardized scores via `langfuse.score.create`: `tool_selection_accuracy`, `schema_adherence`, `invariant_integrity`, `rollback_invariant_passed`, `error_recovery_success`.
  - Flushes scores via `await langfuse.flush()`.
- **Files**: `evals/telemetry/DatasetScoreManager.ts`, `evals/telemetry/scores.ts`
- **Dependencies**: Task 2, Task 3
- **Scope**: Medium (2 files)

---

### Checkpoint: Evaluation Core

- [ ] Assertion engine correctly flags valid vs invalid Lexical AST and rollback mismatches
- [ ] Score manager successfully creates scores on active traces and flushes to Langfuse
- [ ] `yarn typecheck` passes

---

### Phase 3: Scenarios & Test Suite Slices

#### Task 5: 30 Standardized Scenarios (Tiers 1–5)

- **Description**: Implement scenario fixtures across 5 evaluation tiers in `evals/scenarios/`.
  - **Tier 1 (Doc)**: Document authoring, KaTeX formulas, GFM tables, Markdown imports.
  - **Tier 2 (Graph)**: Graph canvas creation, DAG topologies, Leiden clustering commands.
  - **Tier 3 (Error Recovery)**: Self-healing from invalid tool arguments and nonexistent IDs.
  - **Tier 4 (Rollback Invariants)**: Multi-step rollback and redo byte parity validation.
  - **Tier 5 (Subagents & Synthesis)**: Subagent delegation, context pruning, cross-pane synthesis.
- **Acceptance Criteria**:
  - Each scenario defines `id`, `tier`, `prompt`, `expectedTools`, `initialFixture`, and `invariantRules`.
  - Scenarios are exportable as both programmatic test specs and Langfuse Dataset items.
- **Files**: `evals/scenarios/tier1_doc.ts`, `evals/scenarios/tier2_graph.ts`, `evals/scenarios/tier3_errors.ts`, `evals/scenarios/tier4_rollback.ts`, `evals/scenarios/tier5_subagents.ts`, `evals/scenarios/index.ts`
- **Dependencies**: Task 3, Task 4
- **Scope**: Medium-Large (6 files)

#### Task 6: Deterministic VCR Cassette Engine

- **Description**: Implement `evals/cassette/CassettePlayer.ts` to record and replay deterministic LLM interactions for zero-cost CI gates.
- **Acceptance Criteria**:
  - Records LLM responses to `.json` cassettes during `--record` mode.
  - Replays saved cassettes in `--replay` mode without making outbound LLM API requests.
- **Files**: `evals/cassette/CassettePlayer.ts`, `evals/cassette/types.ts`
- **Dependencies**: Task 5
- **Scope**: Medium (2 files)

---

### Phase 4: CLI Runner, Benchmark Reporter & CI Integration

#### Task 7: Headless Eval Runner CLI

- **Description**: Build `evals/runner/EvalRunner.ts` and `evals/cli.ts` orchestrating scenario batches, concurrency, timeout gates, and telemetry lifecycle.
- **Acceptance Criteria**:
  - Supports `--tier <name>`, `--scenario <id>`, `--mode <live|replay>`, `--record`.
  - Executes DeepAgent headlessly with attached `LangfuseCallbackBridge`.
  - Enforces mandatory `flushAsync()` in `finally` blocks for zero dropped telemetry.
- **Files**: `evals/runner/EvalRunner.ts`, `evals/cli.ts`
- **Dependencies**: Task 5, Task 6
- **Scope**: Medium (2 files)

#### Task 8: Markdown Benchmark Reporter

- **Description**: Implement `evals/reporter/MarkdownReporter.ts` aggregating execution results, token costs, latencies, and assertion scores into root `EVALS.md`.
- **Acceptance Criteria**:
  - Generates benchmark matrices with pass/fail status, accuracy %, TTFT, and total token usage.
  - Formats cross-model comparisons with Langfuse trace deep links.
- **Files**: `evals/reporter/MarkdownReporter.ts`, `EVALS.md`
- **Dependencies**: Task 7
- **Scope**: Small (2 files)

#### Task 9: NPM Scripts & CI Workflow

- **Description**: Wire evaluation CLI scripts into `package.json` (`yarn eval:live`, `yarn eval:traces`, `yarn eval:replay`, `yarn eval:record`) and Vitest test suite.
- **Acceptance Criteria**:
  - NPM scripts execute the headless runner cleanly.
  - Evaluation scripts remain strictly separate from `yarn build` and Electron packaging commands.
- **Files**: `package.json`, `vitest.config.ts`
- **Dependencies**: Task 7, Task 8
- **Scope**: Small (2 files)

#### Task 10: Real-Trace Evaluation & Auto-Annotation Engine

- **Description**: Implement `evals/runner/TraceEvalRunner.ts` to query real application traces from the self-hosted Langfuse DB, validate AST/DAG invariants with `AssertionEngine`, and auto-ingest quantitative scores back to Langfuse.
- **Acceptance Criteria**:
  - Supports `yarn eval:traces [--session <id>] [--tag <tag>] [--limit <n>]`.
  - Reconstructs tool calls and extracts document/graph payloads from observation trees.
  - Evaluates schema adherence, AST heading hierarchy, graph DAG acyclicity, and error recovery.
  - Automatically posts scores (`benchmark_passed`, `schema_adherence`, `invariant_integrity`, `error_recovery_success`, `total_tokens`, `duration_ms`) and failure comments to Langfuse.
- **Files**: `evals/runner/TraceEvalRunner.ts`, `evals/runner/__tests__/TraceEvalRunner.test.ts`, `evals/cli.ts`, `package.json`
- **Dependencies**: Task 3, Task 4, Task 7
- **Scope**: Medium (4 files)

---

### Checkpoint: Complete System Verification

- [ ] `yarn eval:replay` runs offline with zero external network requests
- [ ] `yarn eval:live` runs against local Langfuse and logs complete execution DAGs and scores
- [ ] `yarn eval:traces` queries real traces from Langfuse DB and auto-annotates evaluation scores
- [ ] `EVALS.md` generates with complete pass/fail and latency matrices
- [ ] `yarn typecheck` and `yarn build` succeed without bundling eval code into Electron binaries
