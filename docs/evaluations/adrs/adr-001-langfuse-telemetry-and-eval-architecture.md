# ADR-001: Langfuse Telemetry, Tracing & Evaluation Architecture

## Status

**Accepted**

## Context

CollarAgent orchestrates complex, multi-step LLM workflows across visual canvases, scholarly Lexical documents, and subagents. In development and production environments, debugging agent reasoning regressions, measuring tool-calling accuracy, profiling token costs, and evaluating recovery from tool execution errors requires a unified observability and evaluation harness.

Without structured telemetry and evaluation tracing:

1. Agent regressions across LLM backends (e.g. Claude 3.7 vs. local DeepSeek/Ollama) are hard to diagnose without full execution DAGs and latency waterfalls.
2. In-flight token consumption, TTFT (Time to First Token), and prompt caching hit rates cannot be quantitatively profiled.
3. Automated benchmark evaluations cannot correlate deterministic code assertions (AST schema validity, rollback parity) with visual trace replays.

## Decision

We integrate the open-source, self-hosted **Langfuse v4** observability and evaluation platform into CollarAgent via `@collaragent/telemetry/langfuse` and `langfuse`.

1. **Non-Invasive Callback Hook with Root Trace Propagation**: We attach `LangfuseCallbackHandler` to LangGraph execution calls (`agent.invoke`, `agent.stream`). On root chain start (`handleChainStart`), root trace inputs are updated (`rootTrace.update({ input: inputs })`), and upon completion (`handleChainEnd`), root trace outputs are populated (`rootTrace.update({ output: outputs })`), eliminating null input/output anomalies in top-level traces.
2. **Real-Trace Evaluation & Auto-Annotation Engine**: The evaluation engine (`TraceEvalRunner` via `yarn eval:traces`) queries real conversation traces directly from the self-hosted Langfuse DB, extracts tool spans and AST/DAG payloads, executes deterministic validation via `AssertionEngine`, and automatically ingests quantitative scores (`benchmark_passed`, `schema_adherence`, `invariant_integrity`, `error_recovery_success`, `total_tokens`, `duration_ms`) and failure diagnostics back to Langfuse.
3. **Session & Multi-Tenant Correlation**: Traces are correlated using explicit `sessionId` (e.g., workspace session ID) and tagged by context (e.g. `desktop-chat`, `evals`).
4. **Zero-Lock-in Graceful Fallback**: If `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are unset, telemetry automatically deactivates with zero runtime overhead or network calls.
5. **Mandatory Asynchronous Lifecycle Flushing**: To prevent event drops in short-lived CLI / Vitest evaluation runners, runners must await `langfuseHandler.flushAsync()` or `langfuse.flushAsync()` before process termination.
6. **Distributed Self-Hosted Architecture**: The local Langfuse stack runs official Langfuse v4 (`langfuse-server:4`, `langfuse-worker:4`, ClickHouse 24.3, Redis 7.2, PostgreSQL 16, and MinIO) via Docker Compose.

## Consequences

### Positive

- **Execution DAG Visibility & Complete Root Telemetry**: Visualizes multi-agent and subagent delegation hierarchies with fully populated root prompt inputs and final agent outputs.
- **Real-Data Evaluation**: Eliminates synthetic/hallucinated scenario data by evaluating real user session traces directly from the Langfuse database.
- **Quantitative Metrics & Cost Attribution**: Automatically records input, output, and cached token consumption, enabling per-scenario cost and latency comparisons.
- **Local / Self-Hosted Privacy**: Runs fully on-premise / localhost via Docker, ensuring proprietary project documents and local archives remain secure.
- **Deterministic Assertion Linking**: Binds offline code assertions with visual timeline traces for post-mortem debugging during evaluation runs.

### Negative / Trade-offs

- **Background Event Queue**: Backgrounded async dispatch requires explicit flushing before CLI process exits to avoid dropped spans.
- **Telemetry Overhead**: Negligible network overhead (<5ms) when self-hosted on `localhost:3000`.

## Compliance

- Verified via `src/collaragent/telemetry/langfuse.ts`, `evals/runner/TraceEvalRunner.ts`, and `evals/telemetry/__tests__/LangfuseCallbackHandler.test.ts`.
- Evaluated against Langfuse v4 standards and `langfuse@3.38.20`.

## Sources & Official References

- **LangChain & LangGraph Integration**: [https://langfuse.com/integrations/frameworks/langchain](https://langfuse.com/integrations/frameworks/langchain)
- **Tracing Best Practices**: [https://langfuse.com/docs/observability/best-practices](https://langfuse.com/docs/observability/best-practices)
- **Evaluation & Scoring**: [https://langfuse.com/docs/evaluation/overview](https://langfuse.com/docs/evaluation/overview)
- **Self-Hosting Docker Setup**: [https://langfuse.com/self-hosting](https://langfuse.com/self-hosting)
