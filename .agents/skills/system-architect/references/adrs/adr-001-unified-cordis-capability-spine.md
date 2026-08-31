# ADR-001: Unified Cordis Capability Spine

## Status

Accepted

## Date

2026-08-24

## Context & Problem Statement

Collargraph supports multiple entry points: a headless batch CLI (`collargraph run`), an autonomous orchestrator CLI (`collargraph agent`), a background sync daemon (`collargraph daemon`), and a desktop visual studio (`@collargraph/desktop`). Initial designs risked duplicating capability initialization logic, sandbox policies, tool registrations, and model adapters across different entry points. We needed an extensible, uniform capability harness to mount plugins, tools, and execution runtimes deterministically without divergence.

## Decision

We adopted Cordis (`@deepseek-ai/cordis`) as the unified dependency-injection capability spine. All application entry points initialize their services through `createCapabilityContext()`, mounting 19 distinct harness layers (Settings, Storage, Prompts, Tools, Confinement, Subprocesses, HITL Approvals, Sandboxed Filesystem, Sandboxed Shell, Web runtime, Task state, Subagent delegation, Skills, LLM Pi-AI runtime, Sessions, Agent loop, Token compaction, Worker-thread code runtime, and Graph orchestration).

## Trade-off Analysis

### Chosen Option: Cordis Capability Spine (`createCapabilityContext`)

- **Pros (Benefits)**:
  - Single source of truth for all capability facts (`ctx.fs`, `ctx.shell`, `ctx.tools`, `ctx.llm`, `ctx.approval`).
  - Strict isolation through contextual scoping (`ctx.scope`, `ctx.tools.restrict`).
  - Zero initialization drift between CLI batch runs, daemon instances, and desktop visual workflows.
- **Cons (Drawbacks & Operational Overhead)**:
  - Dependency on vendored Cordis container lifecycle and event dispatcher mechanics.
  - Requires explicit plugin registration order for lifecycle dependencies.

### Alternative 1: Ad-hoc Service Initialization per Entry Point

- **Pros**: Lower initial abstraction overhead.
- **Cons**: High code duplication; guaranteed feature drift between CLI and Desktop; inconsistent security enforcement.
- **Reason for Rejection**: Violates modular architecture and security containment invariants.

## Impact & Consequences

- **Security**: Security sandboxes, approval gates, and file fences are mounted identically everywhere.
- **Maintainability**: New tools and capabilities are added in a single plugin and become instantly available across all clients.
