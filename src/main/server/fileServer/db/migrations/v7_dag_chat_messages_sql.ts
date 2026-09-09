/**
 * Embedded V7 DAG Chat Messages DDL Migration SQL
 * Embedded directly as a TypeScript constant so that production builds (electron-vite)
 * bundle the schema directly without relying on external file copying in out/main/.
 */

export const V7_DAG_CHAT_MESSAGES_SQL = `-- Migration 004: DAG Chat Messages Lineage & Active Branch Tracking
PRAGMA user_version = 7;

-- 1. Extend chat_messages with DAG lineage, LangGraph checkpoint linkage, and branch tracking
ALTER TABLE chat_messages ADD COLUMN parent_message_id TEXT REFERENCES chat_messages(id);
ALTER TABLE chat_messages ADD COLUMN checkpoint_id TEXT;
ALTER TABLE chat_messages ADD COLUMN branch_id TEXT;

-- 2. Extend chat_sessions with active pointer tracking
ALTER TABLE chat_sessions ADD COLUMN active_message_id TEXT REFERENCES chat_messages(id);
ALTER TABLE chat_sessions ADD COLUMN active_checkpoint_id TEXT;

-- 3. Secondary indexes for branch querying and child traversal
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_checkpoint ON chat_messages(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_active_msg ON chat_sessions(active_message_id);
`
