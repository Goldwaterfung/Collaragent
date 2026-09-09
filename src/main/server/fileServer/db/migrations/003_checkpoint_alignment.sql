-- Migration 003: LangGraph Checkpoint DAG Alignment & Lineage Indexing
PRAGMA user_version = 6;

-- Secondary index for DAG parent lineage traversal
CREATE INDEX IF NOT EXISTS idx_lg_checkpoints_parent 
ON langgraph_checkpoints(thread_id, checkpoint_ns, parent_checkpoint_id);
