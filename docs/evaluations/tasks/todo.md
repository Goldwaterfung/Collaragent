# Langfuse Telemetry & Evaluation Architecture Tasks

> **Specification Reference**: [`spec-langfuse-telemetry-and-evaluation.md`](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/tasks/spec-langfuse-telemetry-and-evaluation.md)

## Phase 1: Foundation & Telemetry Bridge

- [x] **Task 1: Docker Compose Local Infrastructure (Langfuse v4)**
  - **Files**: `docker-compose.langfuse.yml`, `.env.eval.example`
  - **Criteria**: Langfuse v4 distributed stack (`langfuse-server:4`, `langfuse-worker:4`, ClickHouse 24.3, Redis 7.2, PostgreSQL 16, MinIO) configured on port 3000 with healthchecks.
  - **Verification**: `docker compose -f docker-compose.langfuse.yml config`

- [x] **Task 2: Fail-Safe Langfuse Telemetry Bridge with Root Trace Propagation**
  - **Files**: `src/collaragent/telemetry/langfuse.ts`, `src/collaragent/telemetry/types.ts`, `evals/telemetry/langfuse.ts`, `evals/telemetry/types.ts`
  - **Criteria**: `createLangfuseHandler` returns `LangfuseCallbackHandler` with root trace input propagation on `handleChainStart` (`!parentRunId`) and output propagation on `handleChainEnd`; returns `undefined` safely when unset; exports `flushTelemetry`.
  - **Verification**: `npx vitest run evals/telemetry/__tests__/LangfuseCallbackHandler.test.ts` & `yarn typecheck`

## Checkpoint 1: Foundation

- [x] Telemetry bridge typechecks without errors.
- [x] Root trace inputs and outputs correctly populated on top-level traces.
- [x] Fail-safe no-op verified when keys are absent.

---

## Phase 2: Invariant Assertion & Scoring Client

- [x] **Task 3: Deterministic Assertion & Invariant Engine**
  - **Files**: `evals/assertions/AssertionEngine.ts`, `evals/assertions/types.ts`
  - **Criteria**: Zod tool argument validation, Lexical AST integrity, graph DAG acyclicity, and mathematical rollback parity.
  - **Verification**: `npx vitest run evals/assertions/__tests__/` & `yarn typecheck`

- [x] **Task 4: Dataset & Score Management Client**
  - **Files**: `evals/telemetry/DatasetScoreManager.ts`, `evals/telemetry/scores.ts`
  - **Criteria**: Syncs scenario datasets via Langfuse JS SDK, creates typed scores (`NUMERIC`, `BOOLEAN`), flushes async.
  - **Verification**: `npx vitest run evals/telemetry/__tests__/DatasetScoreManager.test.ts` & `yarn typecheck`

## Checkpoint 2: Core Assertions & Scoring

- [x] Assertion engine correctly validates sample Lexical and Graph states.
- [x] Scores map to standard evaluation taxonomy.

---

## Phase 3: Scenarios & VCR Replay Engine

- [x] **Task 5: Standardized Scenarios Framework**
  - **Files**: `evals/scenarios/types.ts`, `evals/scenarios/index.ts`
  - **Criteria**: Scenario schemas, types, and registry for evaluation harnesses.
  - **Verification**: `yarn typecheck`

- [x] **Task 6: Deterministic VCR Cassette Engine**
  - **Files**: `evals/cassette/CassettePlayer.ts`, `evals/cassette/types.ts`
  - **Criteria**: Records and replays model interactions for zero-cost CI testing.
  - **Verification**: `yarn typecheck`

---

## Phase 4: CLI Runner, Benchmark Reporter & Real-Trace Evaluation Engine

- [x] **Task 7: Headless Eval Runner CLI**
  - **Files**: `evals/runner/EvalRunner.ts`, `evals/cli.ts`
  - **Criteria**: Headless Node.js runner with `--mode <live|replay>`, `--record`, `--tier`, and mandatory `flushAsync()`.
  - **Verification**: `npx vitest run evals/runner/__tests__/EvalRunner.test.ts` & `yarn typecheck`

- [x] **Task 8: Markdown Benchmark Reporter**
  - **Files**: `evals/reporter/MarkdownReporter.ts`, `EVALS.md`
  - **Criteria**: Aggregates benchmark results into Markdown comparison tables with token costs and latencies.
  - **Verification**: `npx vitest run evals/reporter/__tests__/MarkdownReporter.test.ts` & `yarn typecheck`

- [x] **Task 9: NPM Scripts & Vitest Integration**
  - **Files**: `package.json`, `vitest.config.ts`
  - **Criteria**: Added `eval:live`, `eval:traces`, `eval:replay`, `eval:record` scripts; ensured isolation from `electron-builder`.
  - **Verification**: `yarn typecheck`

- [x] **Task 10: Real-Trace Evaluation & Auto-Annotation Engine**
  - **Files**: `evals/runner/TraceEvalRunner.ts`, `evals/runner/__tests__/TraceEvalRunner.test.ts`, `evals/cli.ts`
  - **Criteria**: Programmatically queries real application traces from self-hosted Langfuse DB, extracts AST/DAG payloads, executes `AssertionEngine` checks, and automatically pushes structured scores and comments back to Langfuse.
  - **Verification**: `npx vitest run evals/runner/__tests__/TraceEvalRunner.test.ts` & `yarn typecheck`

## Final Checkpoint

- [x] All 55/55 unit tests pass in `evals/`.
- [x] Real-trace evaluation (`yarn eval:traces`) queries Langfuse DB and auto-annotates traces.
- [x] Root trace propagation eliminates null input/output issues.
- [x] TypeScript typechecks (`yarn typecheck:node` and `yarn typecheck:web`) succeed with 0 errors.
- [x] Electron build passes without bundling evals.
