# ADR-003: Zero-Framework Nominal Branded Graph Intermediate Representation (IR)

## Status
Accepted

## Date
2026-08-24

## Context & Problem Statement
Representing agentic task graphs requires a flexible schema that can describe polymorphic nodes (autonomous subagents, sandboxed code, router conditions, human gates, hierarchical subgraph cells, knowledge sinks), directional typed ports, conditional edges, and execution trajectories. Tightly coupling this graph representation to UI frameworks (e.g. React Flow) or execution runtimes would prevent reuse across headless CLI batch runners, background daemons, and static linters.

## Decision
We established `@collargraph/graph-ir` as a zero-framework, dependency-isolated Graph Intermediate Representation (IR) package. It defines:
1. Branded nominal types (`GraphId`, `NodeId`, `EdgeId`, `PortId`, `ExecutionRunId`, `TrajectoryId`) using `@deepseek-ai/dsh-brand` to eliminate accidental identifier mixing at compile time.
2. Discriminated union schemas for polymorphic node types.
3. Runtime validation schemas via Zod (`GraphSchema`, `TaskNodeSchema`, `EdgeSchema`).
4. Pure static graph linter rules (`validateTaskGraph`) and topological graph integrity checks.

## Trade-off Analysis

### Chosen Option: Zero-Framework Branded Graph IR (`@collargraph/graph-ir`)
- **Pros (Benefits)**:
  - Strict compile-time and runtime type safety.
  - Zero UI or DOM dependencies; fully portable across CLI, worker threads, desktop renderer, and daemon.
  - Independent versioning and validation logic.
- **Cons (Drawbacks & Operational Overhead)**:
  - Requires explicit translation layers when mapping to React Flow nodes/edges in `@collargraph/task-graph-canvas`.

### Alternative 1: Direct Coupling to React Flow JSON format
- **Pros**: Direct consumption in the UI canvas without transformation.
- **Cons**: CLI and headless runners inherit heavy UI dependencies; schema polluted with rendering coordinates and visual state.
- **Reason for Rejection**: Violates modular separation of presentation and execution domain models.

## Impact & Consequences
- **Type Safety**: Branded IDs prevent subtle bugs like passing a `NodeId` where an `EdgeId` is expected.
- **Testability**: Graph validation, cycle detection, and linting are testable in pure unit test suites without mocks.
