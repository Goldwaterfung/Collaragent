# ADR-004: WebSocket JSON-RPC 2.0 Client-Daemon Synchronization

## Status
Accepted

## Date
2026-08-24

## Context & Problem Statement
The Collargraph Desktop IDE (Tauri/React) must communicate with the headless capability harness and background daemon to trigger prompts, create graphs, manage agent presets, configure credentials, and receive high-throughput real-time streaming chunks (`assistant/chunk`, `reasoning/chunk`, `tool/start`, `approval/asked`). We evaluated IPC mechanisms versus WebSocket protocols.

## Decision
We adopted standard JSON-RPC 2.0 over WebSockets (`ws://127.0.0.1:<port>`) implemented across `@collargraph/sync-protocol` and `SyncServer` (`packages/harness-plugin-sync`). The protocol standardizes request/response methods (`sessions.prompt`, `graphs.create`, `credentials.set`, `skills.toggle`) and bidirectional event notifications.

## Trade-off Analysis

### Chosen Option: JSON-RPC 2.0 over Loopback WebSocket
- **Pros (Benefits)**:
  - Standardized error codes, request correlation IDs, and bi-directional notification streaming.
  - Decouples Desktop GUI from daemon process lifecycle; daemon can run as an independent background service or headless container.
  - Browser-accessible for remote/web interfaces and local dev tooling.
- **Cons (Drawbacks & Operational Overhead)**:
  - Requires port allocation management and socket reconnect handling.
  - Small serialization overhead compared to raw native IPC memory buffers.

### Alternative 1: Native Tauri IPC / Electron contextBridge Only
- **Pros**: Zero network stack overhead.
- **Cons**: Tightly couples the harness to the desktop desktop framework; prevents headless CLI execution, remote orchestrators, and daemon-mode architectures.
- **Reason for Rejection**: Blocks headless batch execution and independent daemon capabilities.

## Impact & Consequences
- **Extensibility**: Third-party CLI tools, IDE extensions, or web clients can interact with Collargraph through the exact same JSON-RPC contract.
- **Resilience**: Client automatically reconnects on socket disconnects and resumes event catch-up.
