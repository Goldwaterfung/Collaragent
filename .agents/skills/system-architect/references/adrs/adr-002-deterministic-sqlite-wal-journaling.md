# ADR-002: Deterministic SQLite WAL Session Journaling

## Status

Accepted

## Date

2026-08-24

## Context & Problem Statement

Agentic workflows involve long execution traces, tool executions, subagent forks, streaming model completions, and user approval interactions. Reconstructing UI state, debugging unexpected agent actions, and restoring sessions after crashes require a durable, append-only, crash-safe storage mechanism that avoids state corruption.

## Decision

We implemented single-writer SQLite session persistence in Write-Ahead Logging (WAL) mode (`@deepseek-ai/dsh-session-persistence-sqlite`). Every turn event (`turn/start`, `assistant/chunk`, `tool/call`, `tool/result`, `approval/asked`, `approval/decided`, `turn/finish`) is appended to the durable database log before being broadcast to subscribers. UI state is a pure functional projection (`ConversationStore.fold()`) over the stored event stream.

## Trade-off Analysis

### Chosen Option: SQLite with Write-Ahead Logging (WAL)

- **Pros (Benefits)**:
  - Zero-configuration, embedded, high-performance local database.
  - WAL mode allows concurrent readers while a single background writer appends events.
  - Complete crash safety and 100% deterministic session replay.
  - Facilitates deterministic session forks (`sessions.fork`) by slicing balanced turn prefixes.
- **Cons (Drawbacks & Operational Overhead)**:
  - Local database file management and connection lifecycle handling.
  - Requires single-writer process management to prevent multi-process database locks.

### Alternative 1: Plain JSONL Files

- **Pros**: Easy manual inspection.
- **Cons**: Lack of transactional ACID semantics; high risk of corruption on abrupt process crashes; inefficient indexed querying for multi-session histories.
- **Reason for Rejection**: Unreliable under heavy parallel tool execution and concurrent read scenarios.

## Impact & Consequences

- **Reliability**: Zero data loss during unexpected terminations.
- **Developer Experience**: Time-travel debugging and session fork capabilities are natively supported by replaying event sequences.
