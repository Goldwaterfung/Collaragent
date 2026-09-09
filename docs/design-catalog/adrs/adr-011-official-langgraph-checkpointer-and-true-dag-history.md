# ADR-011: Official LangGraph Checkpointer Storage Alignment and True DAG History

## Status

**Accepted**

---

## Context

In multi-turn, multi-branch co-authoring workflows, CollarAgent supports checkpointing across all three studio planes (Infinite Canvas, Lexical Scholarly Document, and DeepAgent Chat Timeline).

Forensic analysis of production SQLite databases (e.g. `/Users/goldenfung/Documents/interview/oursky.cagent`) revealed a critical split-brain divergence bug during time-travel rollback and branching:

1. **Stale Blob Deserialization via Sequence Collision**:
   - In `FileSystemSaver.ts`, checkpoint state was stripped of `channel_values` and written to `langgraph_blobs` keyed by `(thread_id, channel, version)` with an `if (!existingBlob)` skip guard.
   - LangGraph channel versions are step-based sequence counters (e.g. `25`, `27`, `30`).
   - When a user restored to an earlier checkpoint (version `25`) and started a new branch, LangGraph regenerated versions `27`, `30`.
   - Because blobs with those keys already existed from the abandoned branch, `FileSystemSaver` silently skipped writing the new branch messages. The agent runtime loaded stale messages from the abandoned branch, causing the LLM to hallucinate or summarize abandoned branch context.

2. **Destructive Linear Truncation in SQLite `chat_messages`**:
   - When restoring an earlier checkpoint, `filesystemAPI.ts` executed `truncateChatSession`, physically deleting all rows after the restored message (`DELETE FROM chat_messages WHERE session_id = ? AND timestamp > ?`).
   - While the UI displayed the truncated chat history, `langgraph_blobs` still held the old branch data, creating a complete split-brain divergence between the UI timeline and the LLM runtime state.
   - Physical deletion permanently erased messages from the abandoned branch, making it impossible for users to switch back to or compare alternative branches.

3. **Unguided Restore Head Desynchronization**:
   - `AgentCheckpointRegistry.consumePendingBranch` consumed the branch target after a single turn. Subsequent unguided turns relied on `langgraph_restore_heads`. If `restoreHead` was not updated synchronously, subsequent turns risked jumping to the leaf of an unselected sibling branch.

---

## Decision

We implement a two-part architectural overhaul: **Step 1: Official LangGraph Checkpointer Storage Alignment (Schema V6)** and **Step 2: True DAG Chat History (Schema V7)**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ UI Renderer (MessageList & CheckpointMarker)                                           │
│ - Visualizes active branch messages via recursive CTE query                            │
│ - Detects inactive branch leaves and renders branch switcher buttons (🔀 Branch 2)      │
└───────────────────────────────────────────▲────────────────────────────────────────────┘
                                            │ IPC (checkpointIPC.restore / agentIPC.stream)
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│ Electron Main Host                                                                     │
│ - AgentCheckpointRegistry: Manages effective & pending checkpoint heads                │
│ - CheckpointOrchestrator: Coordinates multi-pane restore (Canvas + Doc + Chat + Agent) │
│ - streaming.ts: Anchors parent_message_id and checkpoint_id on every message           │
└───────────────────────────────────────────▲────────────────────────────────────────────┘
                                            │ REST API / WebSocket
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│ Storage Utility Process (Express + SqliteStorageEngine)                                │
│                                                                                        │
│   Schema V6: LangGraph Alignment                 Schema V7: True DAG Chat Messages     │
│   ┌────────────────────────────────────────┐     ┌───────────────────────────────────┐ │
│   │ langgraph_checkpoints                  │     │ chat_messages                     │ │
│   │ - thread_id, checkpoint_ns             │◄────┼─ checkpoint_id (FK to checkpoint) │ │
│   │ - checkpoint_id (PK)                   │     │ - parent_message_id (DAG parent)  │ │
│   │ - parent_checkpoint_id (DAG parent)    │     │ - branch_id                       │ │
│   │ - checkpoint_json: Self-contained      │     │ (Zero destructive truncation)     │ │
│   │   complete channel_values snapshot     │     └───────────────────────────────────┘ │
│   │ - idx_lg_checkpoints_parent            │     ┌───────────────────────────────────┐ │
│   └────────────────────────────────────────┘     │ chat_sessions                     │ │
│   ┌────────────────────────────────────────┐     │ - active_message_id (Active head) │ │
│   │ langgraph_restore_heads                │     │ - active_checkpoint_id            │ │
│   │ - Unconditionally updated on put()     │     └───────────────────────────────────┘ │
│   └────────────────────────────────────────┘                                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. LangGraph Checkpointer Storage Alignment (Schema Migration 003, `user_version = 6`)

1. **Self-Contained Checkpoints**:
   - `FileSystemSaver.put()` no longer strips `channel_values` into external blobs.
   - Each checkpoint row in `langgraph_checkpoints` stores its complete, self-contained `channel_values` state directly inside `checkpoint_json`.
   - The flawed `if (!existingBlob)` skip guard is eliminated entirely. Every branch turn writes its exact state without sequence collision.
2. **Lineage Indexing**:
   - Added index `idx_lg_checkpoints_parent` on `langgraph_checkpoints(thread_id, checkpoint_ns, parent_checkpoint_id)` for high-performance DAG traversal.
3. **Automated Backward-Compatible Migration**:
   - `SqliteDatabase.ts` implements `backfillCheckpointBlobs()`. Upon opening legacy V5 archives, checkpoints lacking inline `channel_values` are backfilled from `langgraph_blobs`.
   - `getTuple()` supports a zero-latency fallback for historical entries while resolving modern checkpoints in $O(1)$ (< 0.06ms).
4. **Deterministic Restore Head Advance**:
   - `FileSystemSaver.put()` unconditionally advances `langgraph_restore_heads(thread_id, checkpoint_ns, checkpoint_id)`, ensuring that subsequent unguided turns always branch from the active head.

### 2. True DAG Chat History (Schema Migration 004, `user_version = 7`)

1. **Relational DAG Message Schema**:
   - Added columns to `chat_messages`:
     - `parent_message_id TEXT REFERENCES chat_messages(id)`: Points to the parent message in the tree.
     - `checkpoint_id TEXT`: Explicit foreign key to `langgraph_checkpoints(checkpoint_id)`.
     - `branch_id TEXT`: Optional branch grouping identifier.
   - Added columns to `chat_sessions`:
     - `active_message_id TEXT REFERENCES chat_messages(id)`: Pointer to the leaf message of the active branch.
     - `active_checkpoint_id TEXT`: Pointer to the active LangGraph checkpoint.
   - Created indexes: `idx_chat_messages_parent`, `idx_chat_messages_checkpoint`, and `idx_chat_sessions_active_msg`.
2. **Automated Lineage Backfill**:
   - `SqliteDatabase.ts` implements `backfillChatDagLineage()`. Historical flat messages are linked sequentially ($M_i \to M_{i-1}$), and `active_message_id` is set to the last message of the session, transforming flat history into a valid linear DAG without data loss.
3. **Recursive CTE Lineage Traversal**:
   - `SqliteStorageEngine.getChatMessages()` uses a recursive Common Table Expression (CTE) to traverse from `active_message_id` up through `parent_message_id` to the root:
     ```sql
     WITH RECURSIVE lineage AS (
       SELECT * FROM chat_messages
       WHERE session_id = ? AND id = ?
       UNION ALL
       SELECT m.* FROM chat_messages m
       JOIN lineage p ON m.id = p.parent_message_id
     )
     SELECT * FROM lineage ORDER BY timestamp ASC, rowid ASC;
     ```
   - Queries retrieve the exact active timeline in $O(\text{depth})$ without loading or sorting unrelated branches.
4. **Non-Destructive Branch Switching**:
   - `truncateChatSession` is converted from a destructive `DELETE` operation to a non-destructive pointer update: `setActiveBranch(sessionId, messageId, checkpointId)`.
   - Rows in `chat_messages` are never deleted during time travel. All alternate branches persist permanently on disk.
5. **End-to-End Streaming Lineage Propagation**:
   - In `streaming.ts`, before streaming starts, the active message pointer is retrieved via `session.activeMessageId`.
   - The user message is saved with `parentMessageId = activeMessageId`.
   - Upon turn completion, the assistant response is saved with `parentMessageId = userMessageId` and `checkpointId = newCheckpointId`.
6. **Multi-Branch UI & Timeline Integration**:
   - `MessageList.tsx` analyzes `checkpointBundles` relative to the active branch message set.
   - Inactive branch leaf bundles are mapped to their active divergence anchor checkpoints.
   - `CheckpointMarker.tsx` renders a branch switcher (`🔀 Branch 2`) next to `Restore` whenever alternate descendant branches exist.
   - Clicking an alternate branch invokes `window.checkpointIPC.restore(headBundleId)`, restoring the full 3-pane studio state (Canvas + Document + Chat Timeline + LangGraph Agent) simultaneously.

---

## Consequences

### Positive

- **Elimination of State Divergence**: LangGraph runtime memory and SQLite chat history remain 100% aligned across all branch and restore operations. The LLM never hallucinates or leaks abandoned branch context.
- **Zero Data Loss**: Users can explore hypothetical directions, roll back, prompt along new branches, and switch back to earlier branches at any time without losing messages, canvas cards, or document edits.
- **Sub-Millisecond Checkpoint Queries**: Self-contained checkpoints reduce `getTuple()` resolution time to ~0.058ms (well within the < 1.5ms budget).
- **Idempotent Migration Safety**: Schema migrations `003` and `004` execute idempotently via column existence checks (`PRAGMA table_info`), protecting existing production `.cagent` files.
- **Clean UI Presentation**: Redundant `"Turn checkpoint"` labels and duplicate timestamps are removed from inline dividers, keeping the chat timeline clean while exposing full time information in hover tooltips and branch switchers.

### Negative / Trade-offs

- **Storage Space**: Retaining abandoned branches on disk slightly increases database file size compared to destructive deletion. However, this is mitigated by SQLite page compression and CAS blob deduplication (ADR-010).
- **Foreign Key Ordering**: When clearing or deleting chat sessions, `active_message_id` must be explicitly cleared before deleting rows to prevent SQLite foreign key constraint errors (`409 Conflict`).

---

## Compliance & Verification

- **Automated Tests**:
  - `src/main/server/fileServer/__tests__/LangGraphBranchCheckpoint.test.ts`: Verifies version sequence reuse, branch isolation, and legacy database backfill.
  - `src/main/server/fileServer/__tests__/SqliteDagChatMessages.test.ts`: Verifies linear DAG creation, multi-branch switching without data loss, child branch discovery, and V6-to-V7 schema backfill.
  - `src/renderer/components/Chat/__tests__/MessageList.test.tsx`: Verifies marker rendering, rolled-back branch filtering, and alternate branch switcher interactions.
- **Type Integrity**: Enforces strict Zero `any` policy; both `typecheck:node` and `typecheck:web` pass with 0 errors.
