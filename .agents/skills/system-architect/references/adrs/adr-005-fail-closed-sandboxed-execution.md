# ADR-005: Fail-Closed Security Fence and Confinement Architecture

## Status
Accepted

## Date
2026-08-24

## Context & Problem Statement
Autonomous AI agents possess tool-calling capabilities to read, write, edit files, and execute shell commands. Unconstrained execution poses severe risks of unauthorized file modification, secret leakage, or hostile system command execution. The security model must confine agents to authorized workspace boundaries by default while providing structured human-in-the-loop escalation paths for legitimate operations outside the workspace.

## Decision
We implemented a multi-layered fail-closed security architecture:
1. **Workspace Boundary Enforcement**: `SandboxPolicyService` defaults to `workspace-write` mode anchored to the session's verified `cwd`. All file mutations (`write`, `edit`) canonicalize paths against symlinks to prevent TOCTOU escapes before execution. Any mutation outside the boundary throws `FS_SANDBOX_DENIED`.
2. **OS-Level Shell Sandboxing**: Shell commands execute under native OS confinement runners (macOS Seatbelt, Linux bwrap/Landlock, Windows ACL runner). If a platform runner is unavailable or fails, execution fails closed with `SANDBOX_UNAVAILABLE`.
3. **Structured Single-Shot Escalation**: On sandbox denial, the agent can request privilege escalation with justification. `ApprovalService` prompts the user via a structured JSON-RPC waterfall (`approval/asked`). If granted (`allowed-once`), a strictly-widened policy applies exclusively to that single tool call, decaying immediately afterward.

## Trade-off Analysis

### Chosen Option: Multi-Layer Fail-Closed Confinement & HITL Escalation
- **Pros (Benefits)**:
  - Strict security guarantee: unauthorized actions fail closed without exceptions.
  - Transparent user control: full parameter visibility in approval prompts.
  - Zero permanent privilege creep due to single-shot grant decay.
- **Cons (Drawbacks & Operational Overhead)**:
  - Additional interactive latency when human approval is required for out-of-workspace writes.
  - OS-specific runner maintenance across platforms.

### Alternative 1: Permissive Workspace with Post-Hoc Logging
- **Pros**: Uninterrupted agent execution without human prompts.
- **Cons**: Irreversible data corruption or unauthorized deletion; catastrophic failure mode if agent behaves unexpectedly.
- **Reason for Rejection**: Unacceptable security risk in production environments.

## Impact & Consequences
- **Safety**: Safe execution of untrusted prompts and experimental multi-agent workflows.
- **Auditability**: Complete audit trail of every requested and approved privilege escalation stored in the SQLite session journal.
