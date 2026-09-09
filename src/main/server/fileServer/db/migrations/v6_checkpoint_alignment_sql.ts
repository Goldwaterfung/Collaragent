/**
 * Embedded V6 Checkpoint Alignment DDL Migration SQL
 * Embedded directly as a TypeScript constant so that production builds (electron-vite)
 * bundle the schema directly without relying on external file copying in out/main/.
 */

export const V6_CHECKPOINT_ALIGNMENT_SQL = `-- Migration 003: LangGraph Checkpoint DAG Alignment & Lineage Indexing
PRAGMA user_version = 6;

-- Secondary index for DAG parent lineage traversal
CREATE INDEX IF NOT EXISTS idx_lg_checkpoints_parent 
ON langgraph_checkpoints(thread_id, checkpoint_ns, parent_checkpoint_id);
`
