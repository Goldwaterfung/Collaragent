/**
 * Embedded V4 Initial DDL Migration SQL
 * Embedded directly as a TypeScript constant so that production builds (electron-vite)
 * bundle the schema directly without relying on external file copying in out/main/.
 */

export const V4_INIT_SQL = `-- Schema Version Tracking
PRAGMA user_version = 4;

-- ============================================================================
-- 1. PROJECTS & INSTANCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('document', 'canvas')),
    name TEXT NOT NULL,
    content_msgpack BLOB,              -- MessagePack binary payload (Lexical or GraphCanvasDTO)
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================================
-- 2. CHAT SESSIONS & MESSAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    tool_calls_json TEXT NOT NULL DEFAULT '[]',
    blocks_json TEXT NOT NULL DEFAULT '[]',
    actions_json TEXT NOT NULL DEFAULT '[]',
    usage_json TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    timestamp INTEGER NOT NULL
);

-- ============================================================================
-- 3. LANGGRAPH EXECUTION STATE & CHECKPOINTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    checkpoint_json TEXT NOT NULL,      -- Lightweight checkpoint without bulky channel values
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS langgraph_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,                 -- 'json', 'bytes', 'empty', or LangChain class type
    data_blob BLOB,                     -- Serialized channel payload
    serialized INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS langgraph_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'json',
    blob_json TEXT NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS langgraph_restore_heads (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns)
);

-- ============================================================================
-- 4. SNAPSHOTS, COMMAND LOGS & REVISIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instance_type TEXT NOT NULL,
    snapshot_ref TEXT NOT NULL UNIQUE,  -- sha256.msgpack identifier
    snapshot_hash TEXT NOT NULL,
    snapshot_cursor_json TEXT NOT NULL DEFAULT '{}',
    snapshot_msgpack BLOB NOT NULL,     -- Content-addressed binary state
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_command_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    command_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    snapshot_ref TEXT NOT NULL REFERENCES workspace_snapshots(snapshot_ref) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

-- ============================================================================
-- 5. LARGE TOOL OUTPUTS (ADR-006)
-- ============================================================================

CREATE TABLE IF NOT EXISTS large_tool_outputs (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    content_blob BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- ============================================================================
-- 6. SECONDARY B-TREE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_instances_project ON instances(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_lookup ON langgraph_checkpoints(thread_id, checkpoint_ns, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_writes_checkpoint ON langgraph_writes(thread_id, checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_instance ON workspace_command_logs(instance_id, timestamp ASC);
`
