This guide explains how to set up, configure, and use **Langfuse** both within the **CollarAgent codebase** and in general AI application workflows.

---

## 1. Quick Start: Using Langfuse in CollarAgent

CollarAgent provides a local, self-hosted Langfuse stack and an evaluation runner integrated with `@langfuse/langchain`.

### Step 1: Start the Local Langfuse Stack (Official Langfuse v4)

CollarAgent runs the official **Langfuse v4 (`docker.langfuse.com/langfuse/langfuse:4`)** distributed architecture for local observability and evaluations. The stack includes the web server, async worker, ClickHouse analytics engine, Redis queue, PostgreSQL database, and MinIO storage:

```bash
# 1. Stop and remove any existing containers
docker compose -f docker-compose.langfuse.yml down

# 2. Start the distributed v4 stack
docker compose -f docker-compose.langfuse.yml up -d

# 3. Follow the startup logs
docker compose -f docker-compose.langfuse.yml logs -f langfuse-server
```

- The Langfuse UI will be accessible at [`http://localhost:3000`](http://localhost:3000).
- PostgreSQL database runs on port `5432` internally (`5433` on host).
- ClickHouse runs on port `8123` / `9000`.
- Look for `Ready in ...ms` / `Listening on port 3000` in the logs.

---

### Step 2: Configure API Credentials

1. Open [`http://localhost:3000`](http://localhost:3000) in your browser.
2. Sign up / log in to create an organization and project (e.g. `CollarAgent`).
3. Navigate to **Project Settings $\to$ API Keys** and generate a new key pair (`pk-lf-...` and `sk-lf-...`).
4. Create your `.env.eval` file from the template [`.env.eval.example`](file:///Users/goldenfung/Documents/collaragent/.env.eval.example):

```bash
cp .env.eval.example .env.eval
```

5. Set your Langfuse credentials in `.env.eval` or export them in your shell:

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="http://localhost:3000"
export LANGFUSE_HOST="http://localhost:3000"
```

---

### Step 3: Run Real-Trace Evaluations & Live Harness

Run the real-trace evaluation engine against traces stored in your Langfuse DB, or run the live evaluation suite:

```bash
# 1. Evaluate real conversation traces from your self-hosted Langfuse DB
yarn eval:traces

# 2. Filter trace evaluation by user session ID
yarn eval:traces --session <sessionId>

# 3. Filter trace evaluation by tag
yarn eval:traces --tag desktop-chat

# 4. Limit the number of real traces evaluated
yarn eval:traces --limit 50

# 5. Run live evaluation scenarios against models
yarn eval
yarn eval --tier tier1_doc
yarn eval --scenario SCN-DOC-01
```

---

### Step 4: View Traces & Auto-Annotated Scores in Langfuse Dashboard

1. Open [`http://localhost:3000`](http://localhost:3000).
2. **Traces**: View the full execution tree for each run, including:
   - Root trace inputs and final outputs (automatically propagated via `updateRoot: true`).
   - Tool calls and input/output payloads.
   - Subagent invocations and parent-child execution lineages.
   - Model latency, prompt token counts, and completion token counts.
3. **Scores & Metrics**: Inspect quantitative scores automatically ingested by [`TraceEvalRunner`](file:///Users/goldenfung/Documents/collaragent/evals/runner/TraceEvalRunner.ts) and [`DatasetScoreManager`](file:///Users/goldenfung/Documents/collaragent/evals/telemetry/DatasetScoreManager.ts):
   - `benchmark_passed` (`BOOLEAN`: `true` or `false`)
   - `tool_selection_accuracy` (`NUMERIC`: 0.0 or 1.0)
   - `schema_adherence` (`NUMERIC`: 0.0 or 1.0)
   - `invariant_integrity` (`NUMERIC`: 0.0 or 1.0)
   - `error_recovery_success` (`BOOLEAN`: `true` or `false`)
   - `total_tokens` & `duration_ms` (`NUMERIC`)

---

## 2. Programmatic Tracing & Wiring Architecture

### Architecture: Native REST Client vs. OpenTelemetry Noop Trap

In standalone Node.js and Electron desktop applications without a full OpenTelemetry SDK bootstrap, `@langfuse/langchain` (v5) silently defaults to a `NoopTracerProvider` and transmits no data. CollarAgent resolves this by implementing a native **`LangfuseCallbackHandler`** extending `@langchain/core/callbacks/base` that dispatches real JSON payloads directly to Langfuse's Ingestion API (`POST /api/public/ingestion`).

### 4-Step Standard Wiring Lifecycle

1. **Configuration & Keychain Retrieval**:
   Retrieve public settings (`baseUrl`, `publicKey`, `enabled`) from `AppConfig` and sensitive credentials (`secretKey`) securely from the OS Keychain via Electron's `safeStorage`.

2. **Fail-Safe Handler Instantiation**:
   Create the callback handler via `createLangfuseHandler()`. If credentials are unset, it returns `undefined` (Fail-Safe / Zero-Delay Mode).

3. **LangChain / LangGraph Callback Attachment**:
   Pass `callbacks: langfuseHandler ? [langfuseHandler] : []` to `agent.stream(...)` or `agent.invoke(...)`.

4. **Mandatory Async Flush in `finally` Block**:
   Always drain pending events via `await flushTelemetry(langfuseHandler)` before returning or exiting.

```typescript
import { createLangfuseHandler, flushTelemetry } from '@collaragent/telemetry/langfuse'

// 1. Retrieve credentials (Keychain + AppConfig) & instantiate handler
const langfuseHandler = createLangfuseHandler({
  baseUrl: 'http://localhost:3000',
  publicKey: 'pk-lf-...',
  secretKey: 'sk-lf-...', // decrypted from OS Keychain
  sessionId: threadId,
  threadId,
  tags: ['collaragent', 'desktop-chat'],
  metadata: { tier: 'tier1_doc', scenarioId: 'SCN-DOC-01' }
})

try {
  // 2. Pass to LangChain / LangGraph execution config
  const result = await agent.invoke(
    { messages: [new HumanMessage('Create a 3x3 table')] },
    { callbacks: langfuseHandler ? [langfuseHandler] : [] }
  )
} finally {
  // 3. Mandatory drain to prevent trace event loss on exit
  if (langfuseHandler) {
    await flushTelemetry(langfuseHandler)
  }
}
```

---

### Recording Custom Metric Scores

Use [`DatasetScoreManager`](file:///Users/goldenfung/Documents/collaragent/evals/telemetry/DatasetScoreManager.ts) or the `Langfuse` SDK directly:

```typescript
import { Langfuse } from 'langfuse'

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL
})

// Create an evaluation score attached to a specific trace
await langfuse.createScore({
  traceId: 'trace-id-123',
  name: 'invariant_integrity',
  value: 1.0,
  dataType: 'NUMERIC',
  comment: 'Lexical AST and DAG acyclicity verified'
})

// Always flush after batch scoring
await langfuse.flushAsync()
```

---

## 3. Querying Langfuse via CLI

You can query your self-hosted or cloud Langfuse instance without installing additional tools using `npx langfuse-cli`:

```bash
# Set credentials
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_BASE_URL="http://localhost:3000"

# Explore API schema
npx langfuse-cli api __schema

# List available traces
npx langfuse-cli api traces list --limit 10

# List scores
npx langfuse-cli api scores list --limit 10
```

---

## 4. Key Local Reference Files

- [`telemetry-architecture.md`](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/telemetry-architecture.md): Full scoring taxonomy and container architecture.
- [`ADR-001`](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/adrs/adr-001-langfuse-telemetry-and-eval-architecture.md): Zero-lock-in decision record and fail-safe design.
- [`docker-compose.langfuse.yml`](file:///Users/goldenfung/Documents/collaragent/docker-compose.langfuse.yml): Production-parity local Docker configuration.
- [`docs/langfuse/`](file:///Users/goldenfung/Documents/collaragent/docs/langfuse): Full local copies of Langfuse official documentation (Prompt Management, Evaluations, Tracing, Self-Hosting).
