# Agent Evaluation & Telemetry Architecture

Welcome to the **CollarAgent Evaluation & Telemetry Architecture Catalog**. This directory is dedicated to the deterministic evaluation harness, OpenTelemetry/Langfuse tracing infrastructure, quantitative metrics taxonomy, and standardized test scenarios.

---

## Evaluation Catalog Structure

```
docs/evaluations/
├── README.md                         # Master Evaluation Hub & Architecture Overview
├── telemetry-architecture.md         # Langfuse Telemetry, Tracing & Scoring Specification
├── c3-components/
│   └── component-telemetry-eval.mmd  # C3 Level Component Architecture for Evaluation
├── c4-code/
│   ├── data/
│   │   └── state-evaluation-run.mmd  # C4 State Machine for Scenario Execution
│   └── flows/
│       └── sequence-telemetry-eval-flow.mmd # C4 Runtime Telemetry & Scoring Flow
└── adrs/
    └── adr-001-langfuse-telemetry-and-eval-architecture.md # Telemetry & Evaluation ADR
```

---

## 1. System Overview & Mission

The Evaluation and Telemetry Suite serves as the production quality gate and observability backbone for CollarAgent. It provides:

1. **Real-Trace Evaluation & Auto-Annotation**: Programmatic querying of real conversation traces from self-hosted Langfuse DB, verifying Zod schemas, Lexical AST integrity, and Canvas DAG invariants, and automatically writing standardized benchmark scores back to Langfuse.
2. **Deterministic Live & Replay Harness**: Automated test execution measuring tool selection accuracy, schema adherence, autonomous error recovery, and mathematical rollback parity.
3. **Local Open-Source Tracing (Langfuse v4)**: Non-invasive execution DAG tracing, root trace input/output propagation, latency waterfalls (TTFT, step execution times), and token cost profiling via `@langfuse/langchain` and native ingestion handlers.
4. **Automated Benchmark Reporting**: Generates root-level `EVALS.md` reports with cross-model benchmark comparisons.

---

## 2. Component Architecture (C3)

```mermaid
flowchart TB
    %% C3 Component Styling
    classDef component fill:#1168bd,stroke:#0b4884,color:#fff;
    classDef database fill:#1e40af,stroke:#1d4ed8,color:#fff;
    classDef external fill:#6b7280,stroke:#4b5563,color:#fff;

    subgraph TelemetryEvalBoundary ["Evaluation & Telemetry Subsystem [Module: evals / collaragent]"]
        EvalRunner["🏃 Eval Runner<br/>[Component: TypeScript / CLI Runner]<br/>Orchestrates live scenario execution, batching, and timeout handling"]:::component
        TraceEvalRunner["🔬 Trace Eval Runner<br/>[Component: Real-Trace Evaluator]<br/>Queries real session traces from Langfuse DB, runs assertions, auto-annotates scores"]:::component
        AssertionEngine["⚖️ Assertion & Invariant Engine<br/>[Component: Deterministic Validator]<br/>Asserts Zod schemas, Lexical AST integrity, graph DAG acyclicity & rollback parity"]:::component
        LangfuseCallbackBridge["🔌 Langfuse Callback Bridge<br/>[Component: @collaragent/telemetry/langfuse]<br/>Hooks into LangGraph lifecycle; propagates root inputs/outputs, captures tokens & spans"]:::component
        DatasetScoreManager["📊 Dataset & Score Manager<br/>[Component: langfuse SDK Client]<br/>Records structured metric scores and synchronizes evaluation datasets"]:::component
        CassetteEngine["📼 Cassette Replay Engine<br/>[Component: Deterministic VCR Player]<br/>Records & replays deterministic mock interactions for zero-cost CI gates"]:::component
        MarkdownReporter["📝 Markdown Benchmark Reporter<br/>[Component: Report Generator]<br/>Aggregates traces & generates EVALS.md with performance matrices"]:::component
    end

    DeepAgentRuntime["🧠 DeepAgent Runtime<br/>[Component: LangGraph Engine]"]:::component
    WorkspaceStorage["💾 CagentStorage Engine<br/>[Component: Sharded Disk I/O]"]:::component
    LangfuseServer["📈 Self-Hosted Langfuse v4 Server<br/>[Container: Docker Compose / localhost:3000]<br/>Postgres 16 + ClickHouse + Redis + MinIO + Worker"]:::external

    %% Real-Trace Evaluation Flow
    TraceEvalRunner -->|"1. Queries real traces [GET /api/public/traces]"| LangfuseServer
    TraceEvalRunner -->|"2. Passes extracted tool calls & AST/DAG payloads"| AssertionEngine
    TraceEvalRunner -->|"3. Automatically ingests evaluation scores"| DatasetScoreManager
    DatasetScoreManager -->|"POST /api/public/scores"| LangfuseServer

    %% Live Scenario Evaluation Flow
    EvalRunner -->|"Executes scenario prompts"| DeepAgentRuntime
    EvalRunner -->|"Verifies state mutations"| AssertionEngine
    AssertionEngine -->|"Reads post-mutation state & diffs"| WorkspaceStorage

    DeepAgentRuntime -->|"Dispatches lifecycle callback events with root trace propagation"| LangfuseCallbackBridge
    LangfuseCallbackBridge -->|"Flushes batched trace telemetry [HTTP/REST]"| LangfuseServer

    EvalRunner -->|"Records assertion metrics & links traces"| DatasetScoreManager
    EvalRunner -->|"Replays deterministic interactions in CI"| CassetteEngine
    EvalRunner -->|"Emits benchmark results"| MarkdownReporter
```

---

## 3. Runtime Telemetry Sequence (C4)

```mermaid
sequenceDiagram
    autonumber
    participant ER as EvalRunner (evals/)
    participant DA as DeepAgent Runtime
    participant WT as WorkspaceTools
    participant AE as AssertionEngine
    participant CB as Langfuse CallbackBridge
    participant LF as Langfuse Server (:3000)
    participant MR as MarkdownReporter

    Note over ER,LF: Phase 1: Scenario Initialization & Langfuse Session Binding
    ER->>CB: createLangfuseHandler({ sessionId, tags, runName })
    CB-->>ER: langfuseHandler instance
    ER->>DA: invoke({ messages }, { callbacks: [langfuseHandler] })

    Note over DA,LF: Phase 2: Agent Execution & Non-Blocking Tracing
    DA->>CB: onChainStart() / onLLMStart()
    CB->>LF: Queue Trace / Generation payload (async background)
    DA->>WT: executeTool(createDocument / editDocument / writeMindMap)
    WT->>CB: onToolStart(toolName, inputArgs)
    WT-->>DA: Tool execution result / error payload
    DA->>CB: onToolEnd(output) / onLLMEnd(usage, tokens)
    CB->>LF: Queue Tool Spans & Token Metrics (async background)
    DA-->>ER: Agent final output & message trajectory

    Note over ER,AE: Phase 3: Deterministic Assertion & Invariant Verification
    ER->>AE: assertScenario(context, agentOutput)
    AE->>AE: Check 1: Zod Schema Adherence
    AE->>AE: Check 2: Lexical AST / Graph DAG Invariants
    AE->>AE: Check 3: Mathematical Rollback Parity (InverseCommandEngine)
    AE-->>ER: AssertionOutcome (toolAccuracy, schemaAdherence, invariantPassed)

    Note over ER,LF: Phase 4: Scoring & Mandatory Event Flushing
    ER->>LF: createScore({ traceId, name: "tool_accuracy", value })
    ER->>LF: createScore({ traceId, name: "schema_adherence", value })
    ER->>LF: createScore({ traceId, name: "rollback_invariant", value })
    ER->>CB: flushAsync()
    CB->>LF: Await background queue drain (HTTP POST /api/public/ingestion)
    LF-->>CB: Ingestion acknowledged (200 OK)

    Note over ER,MR: Phase 5: Benchmark Aggregation
    ER->>MR: recordScenarioResult(scenarioResult)
    MR->>MR: Update EVALS.md & Performance Matrix
```

---

## 4. Scenario Execution State Machine (C4)

```mermaid
stateDiagram-v2
    [*] --> Uninitialized

    Uninitialized --> FixtureInitialized : setupScenario() [Initialize mock workspace & storage]
    FixtureInitialized --> AgentInvoking : agent.invoke() [Attach Langfuse CallbackHandler]

    state AgentInvoking {
        [*] --> LLMGeneration
        LLMGeneration --> ToolExecution : Emits ToolCall
        ToolExecution --> LLMGeneration : ToolResult returned
        ToolExecution --> ErrorEncountered : Tool throws/returns error code
        ErrorEncountered --> SelfHealingAttempt : Agent inspects error & current blocks
        SelfHealingAttempt --> ToolExecution : Re-issues corrected tool arguments
        LLMGeneration --> FinalResponse : Complete trajectory reached
    }

    AgentInvoking --> VerifyingInvariants : Trajectory received by runner

    state VerifyingInvariants {
        [*] --> SchemaValidation
        SchemaValidation --> ASTInvariantCheck : Schema Valid
        ASTInvariantCheck --> RollbackVerification : AST Valid
        RollbackVerification --> InvariantsPassed : Rollback Byte Parity 100%
        RollbackVerification --> InvariantsFailed : Byte Drift / Violation
    }

    InvariantsPassed --> ScoringAndFlushing : createScore() & flushAsync()
    InvariantsFailed --> ScoringAndFlushing : createScore() & flushAsync()

    ScoringAndFlushing --> Completed : Traces flushed & EVALS.md updated
    Completed --> [*]
```

---

## 5. Architecture Decision Records

| ADR                                                                                                                                 | Title                                                     | Key Decision                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](file:///Users/goldenfung/Documents/collaragent/docs/evaluations/adrs/adr-001-langfuse-telemetry-and-eval-architecture.md) | **Langfuse Telemetry, Tracing & Evaluation Architecture** | Non-invasively trace LangGraph execution DAGs with `@langfuse/langchain`, log deterministic assertion scores to datasets, and profile latency/costs on self-hosted Langfuse. |
