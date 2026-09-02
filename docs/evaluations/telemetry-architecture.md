# Langfuse Observability, Telemetry & Evaluation Architecture

## 1. Executive Summary & Architectural Mission

This document formalizes the integration of the open-source, self-hosted **Langfuse** observability and evaluation platform into CollarAgent.

By leveraging LangChain's native callback hooks (`@langfuse/langchain`) and the Langfuse JS SDK (`langfuse`), CollarAgent achieves production-grade telemetry:

- **Full Agent Execution DAGs**: Non-intrusively traces multi-step ReAct cycles, tool calls, and subagent handoffs.
- **Quantitative Benchmark Scoring**: Programmatically records deterministic assertions (AST schema validity, rollback parity, error recovery rates) onto Langfuse evaluation datasets.
- **Cost & Latency Profiling**: Real-time token usage breakdown (Prompt, Completion, and Cached tokens) and latency waterfalls (TTFT, step execution times).
- **Self-Hosted Privacy**: Runs locally on `localhost:3000` via Docker Compose, guaranteeing that sensitive workspace files, `.cagent` archives, and API credentials never leave the host.

---

## 2. Stack Inventory & Source-Driven Citations

```
STACK DETECTED & VERIFIED:
- Node.js 20+ / TypeScript 7.0.2 / Electron 43
- @langchain/core 1.2.9 / @langchain/langgraph 1.4.12 / langchain 1.5.10
- langfuse 3.38.20 / @langfuse/langchain 5.11.0 / @opentelemetry/api 1.9.1
- Langfuse v4 Self-Hosted Stack: langfuse:4, langfuse-worker:4, clickhouse:24.3, redis:7.2, postgres:16, minio
```

All implementation patterns in this specification are grounded directly in official Langfuse documentation:

| Domain                            | Pattern / API                                                            | Official Documentation Source Citation                                                                           |
| :-------------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **LangChain & LangGraph Tracing** | `CallbackHandler` from `@langfuse/langchain` & native root trace updates | [https://langfuse.com/integrations/frameworks/langchain](https://langfuse.com/integrations/frameworks/langchain) |
| **Tracing Best Practices**        | Root inputs/outputs propagation, nested spans, descriptive names         | [https://langfuse.com/docs/observability/best-practices](https://langfuse.com/docs/observability/best-practices) |
| **Evaluation & Scoring**          | `createScore` / `score.create` API & Real-Trace Evaluation               | [https://langfuse.com/docs/evaluation/overview](https://langfuse.com/docs/evaluation/overview)                   |
| **Sessions & Grouping**           | `sessionId` dynamic metadata & session querying                          | [https://langfuse.com/docs/tracing-features/sessions](https://langfuse.com/docs/tracing-features/sessions)       |
| **Tags & Categorization**         | `tags` array on traces                                                   | [https://langfuse.com/docs/tracing-features/tags](https://langfuse.com/docs/tracing-features/tags)               |
| **Self-Hosting Docker Setup**     | Langfuse v4 (Web + Worker + ClickHouse + Redis + MinIO + PostgreSQL)     | [https://langfuse.com/self-hosting](https://langfuse.com/self-hosting)                                           |

---

## 3. C4 Architecture Level Models

### 3.1 Level 2: Container Topology (C2)

```mermaid
flowchart TB
    %% C2 Container Styling
    classDef person fill:#08427b,stroke:#073b6f,color:#fff;
    classDef container fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;
    classDef boundary fill:none,stroke:#94a3b8,stroke-width:2px,stroke-dasharray: 5 5;

    Developer["👤 AI Engineer / QA Tester<br/>[Person]"]:::person

    subgraph HostSystem ["Local Host / CI Environment"]
        EvalRunner["🏃 Eval Runner & Benchmark CLI<br/>[Container: TypeScript / Node.js Process]<br/>Executes live scenario batches and records EVALS.md"]:::container
        TraceEvalRunner["🔬 Trace Eval Runner CLI<br/>[Container: `yarn eval:traces`]<br/>Queries real session traces from Langfuse DB & auto-annotates scores"]:::container
        CollarAgentApp["🏢 CollarAgent Host Runtime<br/>[Container: Electron Main & LangGraph Runtime]<br/>Executes agent reasoning and workspace tools"]:::container

        subgraph LangfuseStack ["Self-Hosted Langfuse v4 Container Stack [Docker]"]
            LangfuseWeb["📈 Langfuse Server & UI<br/>[Container: docker.langfuse.com/langfuse/langfuse:4 / :3000]<br/>Ingests telemetry events, renders execution DAGs & dashboards"]:::container
            LangfuseWorker["⚙️ Langfuse Worker<br/>[Container: docker.langfuse.com/langfuse/langfuse-worker:4]<br/>Async background processing and queue execution"]:::container
            ClickHouseDB[("⚡ ClickHouse OLAP<br/>[Container: clickhouse:latest / :8123]<br/>High-speed analytical trace store")]:::database
            RedisQueue[("🔄 Redis Queue & Cache<br/>[Container: redis:7.2-alpine / :6379]<br/>Job broker & state caching")]:::database
            LangfuseDB[("🗄️ PostgreSQL Database<br/>[Container: postgres:16-alpine / :5433]<br/>Transactional state, user auth, and metadata")]:::database
            MinIOStorage[("📦 MinIO S3 Storage<br/>[Container: minio/minio / :9090]<br/>Event payload & media attachment blob store")]:::database
        end
    end

    LLMCloud["🧠 External LLM APIs<br/>[Cloud Providers: Anthropic, OpenAI, DeepSeek]"]:::external

    Developer -->|"Runs `yarn eval:traces` (Real traces) / `yarn eval` (Live)"| TraceEvalRunner
    Developer -->|"Runs live evaluation suite"| EvalRunner
    Developer -->|"Inspects visual traces at http://localhost:3000"| LangfuseWeb

    TraceEvalRunner -->|"Queries real traces [GET /api/public/traces]"| LangfuseWeb
    TraceEvalRunner -->|"Ingests validation scores [POST /api/public/scores]"| LangfuseWeb

    EvalRunner -->|"Invokes agent scenarios"| CollarAgentApp
    CollarAgentApp -->|"Dispatches LLM prompts [HTTPS]"| LLMCloud
    CollarAgentApp -->|"Flushes trace events with root inputs/outputs [HTTP POST /api/public/ingestion]"| LangfuseWeb
    LangfuseWeb --> RedisQueue
    LangfuseWeb --> ClickHouseDB
    LangfuseWeb --> LangfuseDB
    LangfuseWeb --> MinIOStorage
    LangfuseWorker --> RedisQueue
    LangfuseWorker --> ClickHouseDB
```

---

### 3.2 Level 3: Component Architecture (C3)

```mermaid
flowchart TB
    %% C3 Component Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;

    subgraph TelemetryEvalModule ["Telemetry & Evaluation Subsystem (`evals/`)"]
        EvalRunner["🏃 EvalRunner<br/>[CLI & Batch Orchestrator]"]:::component
        AssertionEngine["⚖️ AssertionEngine<br/>[Deterministic AST / Invariant Checker]"]:::component
        LangfuseBridge["🔌 LangfuseCallbackBridge<br/>[@langfuse/langchain Hook]"]:::component
        ScoreManager["📊 DatasetScoreManager<br/>[Langfuse Score Sync Client]"]:::component
        CassettePlayer["📼 CassettePlayer<br/>[Offline VCR Fixture Engine]"]:::component
    end

    DeepAgentRuntime["🧠 DeepAgent Runtime<br/>[LangGraph Engine]"]:::component
    LangfuseServer["📈 Self-Hosted Langfuse Server<br/>[localhost:3000]"]:::external

    EvalRunner --> DeepAgentRuntime
    EvalRunner --> AssertionEngine
    DeepAgentRuntime -->|"Emits callback events"| LangfuseBridge
    LangfuseBridge -->|"Batched async flush"| LangfuseServer
    EvalRunner -->|"Records assertion scores"| ScoreManager
    ScoreManager -->|"POST /api/public/scores"| LangfuseServer
    EvalRunner --> CassettePlayer
```

---

### 3.3 Level 4: Execution Sequence Flow (C4)

```mermaid
sequenceDiagram
    autonumber
    participant ER as EvalRunner (evals/)
    participant DA as DeepAgent Runtime
    participant WT as WorkspaceTools
    participant AE as AssertionEngine
    participant CB as Langfuse CallbackBridge
    participant LF as Langfuse Server (:3000)

    ER->>CB: createLangfuseHandler({ sessionId, tags, runName })
    CB-->>ER: langfuseHandler
    ER->>DA: invoke({ messages }, { callbacks: [langfuseHandler] })

    DA->>CB: onChainStart() / onLLMStart()
    CB->>LF: Queue generation & prompt metadata (async background)
    DA->>WT: executeTool(createDocument / writeMindMap)
    WT->>CB: onToolStart(toolName, args)
    WT-->>DA: Tool Result / Error
    DA->>CB: onToolEnd(output) / onLLMEnd(usage)
    CB->>LF: Queue tool span & token usage (async background)

    DA-->>ER: Trajectory completed
    ER->>AE: assertScenario(context, agentOutput)
    AE-->>ER: AssertionOutcome (toolAccuracy, schemaAdherence, invariantPassed)

    ER->>LF: createScore({ traceId, name: "tool_accuracy", value })
    ER->>LF: createScore({ traceId, name: "schema_adherence", value })
    ER->>LF: createScore({ traceId, name: "rollback_invariant", value })
    ER->>CB: flushAsync()
    CB->>LF: Drain event queue (HTTP POST /api/public/ingestion)
    LF-->>CB: Acknowledged (200 OK)
```

---

## 4. Telemetry Schema & Attribute Standards

### 4.1 Trace Metadata Attributes

Every Langfuse trace generated by CollarAgent conforms to the following taxonomy:

```typescript
export interface CollarTraceMetadata {
  readonly langfuseSessionId: string // e.g. "eval-session-20260902" or workspace session ID
  readonly langfuseUserId: string // e.g. "eval-runner" or local profile identifier
  readonly langfuseTags: readonly string[] // e.g. ["evals", "tier1_doc", "claude-3-7-sonnet"]
  readonly scenarioId?: string // e.g. "SCN-DOC-01"
  readonly tier?: string // e.g. "tier1_doc"
  readonly executionMode: 'live' | 'replay' | 'dev'
}
```

### 4.2 Standardized Quantitative Evaluation Scores

Scores are attached to dataset experiment items and traces via `langfuse.createScore()`:

| Score Name                  | Data Type | Value Range      | Description                                                                          |
| :-------------------------- | :-------- | :--------------- | :----------------------------------------------------------------------------------- |
| `tool_selection_accuracy`   | `NUMERIC` | `0.0` or `1.0`   | $1.0$ if the agent called the exact expected tool for the objective.                 |
| `schema_adherence`          | `NUMERIC` | `0.0` or `1.0`   | $1.0$ if all generated tool arguments passed Zod schema validation on first try.     |
| `invariant_integrity`       | `NUMERIC` | `0.0` or `1.0`   | $1.0$ if Lexical block IDs are unique and graph topology is acyclic.                 |
| `rollback_invariant_passed` | `BOOLEAN` | `true` / `false` | `true` if applying `InverseCommandEngine` commands yields 100% byte-identical state. |
| `error_recovery_success`    | `BOOLEAN` | `true` / `false` | `true` if agent autonomously healed an injected runtime error within $\le 2$ turns.  |

---

## 5. Operational Protocols & Implementation Guidelines

### 5.1 Mandatory Lifecycle Flushing Protocol

_Source: [https://langfuse.com/integrations/frameworks/langchain#queuing-and-flushing](https://langfuse.com/integrations/frameworks/langchain#queuing-and-flushing)_

In CLI runners, background workers, and Vitest test processes, the Node.js event loop will terminate before the background HTTP queue completes unless explicitly flushed.

**Mandatory Pattern**:

```typescript
try {
  await agent.invoke(input, { callbacks: [langfuseHandler] })
} finally {
  if (langfuseHandler) {
    await langfuseHandler.flushAsync()
  }
}
```

### 5.2 Subagent Observation Hierarchy

_Source: [https://langfuse.com/docs/observability/best-practices#multi-agent-systems](https://langfuse.com/docs/observability/best-practices#multi-agent-systems)_

When `createSubAgentMiddleware` delegates tasks to specialized subagents:

1. Subagent executions are tagged with observation type `agent` rather than flat `tool` spans.
2. The nested subagent lifecycle automatically becomes a distinct sub-graph in the Langfuse Agent Graph view.
3. Subagent generations and tool calls are nested under the subagent's execution context.

### 5.3 Fail-Safe Offline Operation

If `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is not present in the environment:

- `createLangfuseHandler()` returns `undefined`.
- The agent execution runs with an empty callbacks array (`callbacks: []`).
- Zero network requests or console warnings are generated.

---

## 6. Self-Hosted Docker Deployment Blueprint (Langfuse v4)

To deploy the local Langfuse v4 distributed stack for development and offline evaluation runs:

```yaml
# docker-compose.langfuse.yml
version: '3.8'

services:
  langfuse-server:
    image: docker.langfuse.com/langfuse/langfuse:4
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/langfuse
      - NEXTAUTH_SECRET=local-dev-secret-string-min-32-chars-long
      - SALT=local-dev-salt-string-min-32-chars-long
      - ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
      - NEXTAUTH_URL=http://localhost:3000
      - TELEMETRY_ENABLED=false
      - LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES=true
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_MIGRATION_URL=clickhouse://clickhouse:9000
      - CLICKHOUSE_USER=default
      - CLICKHOUSE_PASSWORD=clickhouse
      - CLICKHOUSE_CLUSTER_ENABLED=false
      - REDIS_CONNECTION_STRING=redis://redis:6379
      - LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
      - LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://minio:9000
      - LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minioadmin
      - LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=minioadmin
      - LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true
      - LANGFUSE_S3_EVENT_UPLOAD_REGION=us-east-1
      - LANGFUSE_MIGRATION_V4_WRITE_MODE=dual
      - TZ=UTC

  langfuse-worker:
    image: docker.langfuse.com/langfuse/langfuse-worker:4
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/langfuse
      - ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
      - TELEMETRY_ENABLED=false
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_MIGRATION_URL=clickhouse://clickhouse:9000
      - CLICKHOUSE_USER=default
      - CLICKHOUSE_PASSWORD=clickhouse
      - CLICKHOUSE_CLUSTER_ENABLED=false
      - REDIS_CONNECTION_STRING=redis://redis:6379
      - LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
      - LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://minio:9000
      - LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minioadmin
      - LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=minioadmin
      - LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true
      - LANGFUSE_S3_EVENT_UPLOAD_REGION=us-east-1
      - LANGFUSE_MIGRATION_V4_WRITE_MODE=dual
      - TZ=UTC

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    restart: always
    environment:
      - CLICKHOUSE_DB=default
      - CLICKHOUSE_USER=default
      - CLICKHOUSE_PASSWORD=clickhouse
      - TZ=UTC
    ports:
      - '8123:8123'
      - '9000:9000'
    volumes:
      - langfuse_clickhouse_data:/var/lib/clickhouse
    healthcheck:
      test: ['CMD-SHELL', 'wget --spider -q http://127.0.0.1:8123/ping']
      interval: 3s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7.2-alpine
    restart: always
    ports:
      - '6379:6379'
    volumes:
      - langfuse_redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 3s
      timeout: 3s
      retries: 10

  db:
    image: postgres:16-alpine
    restart: always
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=langfuse
      - TZ=UTC
    ports:
      - '5433:5432'
    volumes:
      - langfuse_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 3s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio
    restart: always
    command: server /data --console-address ":9091"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    ports:
      - '9090:9000'
      - '9091:9091'
    volumes:
      - langfuse_minio_data:/data
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 3s
      timeout: 3s
      retries: 10

  minio-create-bucket:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      /usr/bin/mc alias set myminio http://minio:9000 minioadmin minioadmin;
      /usr/bin/mc mb --ignore-existing myminio/langfuse;
      exit 0;
      "

volumes:
  langfuse_postgres_data:
  langfuse_clickhouse_data:
  langfuse_redis_data:
  langfuse_minio_data:
```
