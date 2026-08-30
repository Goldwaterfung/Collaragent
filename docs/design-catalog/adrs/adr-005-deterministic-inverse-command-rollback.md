# ADR-005: Deterministic Inverse Command Rollback Engine

## Status
**Accepted**

## Context
In a collaborative human-agent workspace, state changes originate from three distinct sources: direct user UI interactions (mouse drags, rich text typing), background agent tool executions (`writeGraph`, `editDocument`), and network synchronization. Supporting granular Undo/Redo, staged proposal rollbacks, and historical checkpoint restoration required a unified, deterministic mechanism to reverse mutations without creating corrupted intermediate states.

## Decision
We implement an **Atomic Command Ledger** backed by the `InverseCommandEngine`:
1. Every state mutation is represented as an atomic command object (`CanvasCommand` or `EditorCommand`) accompanied by an immutable record of `previousState`.
2. When a command executes, `InverseCommandEngine.invertCommand(command, previousState)` computes its exact mathematical inverse:
   - `graph:add_node` $\leftrightarrow$ `graph:remove_node` (restoring previous attributes, layout, and cardinal ports).
   - `graph:add_relationship` $\leftrightarrow$ `graph:remove_relationship`.
   - `graph:update_node` $\leftrightarrow$ `graph:update_node` (re-applying prior attribute snapshot).
   - `editor:insert_block` $\leftrightarrow$ `editor:remove_block`.
   - `editor:update_block` $\leftrightarrow$ `editor:update_block` (restoring previous block AST slice).
   - `editor:replace_document` $\leftrightarrow$ `editor:replace_document`.
3. When restoring a checkpoint or undoing an action, inverse commands are dispatched sequentially in reverse order.

## Consequences
### Positive
- Unified rollback mechanism shared across user Undo/Redo, agent proposal rejections (`rejectChanges`), and multi-instance checkpoint restores.
- Clean referential integrity: nodes and edges are added/removed in strict dependency order.
- High memory efficiency compared to full-state snapshot duplication on every micro-edit.

### Negative / Trade-offs
- Every new command type introduced to the system must define its corresponding inverse transformation rule in `InverseCommandEngine.ts`.

## Compliance
Verified via `src/collaragent/runtime/InverseCommandEngine.ts` and `src/collaragent/runtime/CanvasDiffEngine.ts`.
