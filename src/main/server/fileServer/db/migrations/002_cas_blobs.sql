-- Migration 002: Decoupled CAS Blobs and Safe Snapshot Lifecycle
PRAGMA user_version = 5;

-- 1. Create immutable CAS blob table (independent of instance lifecycle)
CREATE TABLE IF NOT EXISTS workspace_blobs (
    hash TEXT PRIMARY KEY NOT NULL,
    content_msgpack BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- 2. Backfill existing blobs from workspace_snapshots into workspace_blobs
INSERT OR IGNORE INTO workspace_blobs (hash, content_msgpack, byte_size, created_at)
SELECT snapshot_hash, snapshot_msgpack, length(snapshot_msgpack), created_at
FROM workspace_snapshots
WHERE snapshot_msgpack IS NOT NULL;

-- 3. Recreate workspace_snapshots with instance-scoped uniqueness and CAS blob pointer
CREATE TABLE IF NOT EXISTS workspace_snapshots_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT REFERENCES instances(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    instance_type TEXT,
    snapshot_ref TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    blob_hash TEXT REFERENCES workspace_blobs(hash) ON DELETE RESTRICT,
    snapshot_cursor_json TEXT NOT NULL DEFAULT '{}',
    snapshot_msgpack BLOB,
    created_at TEXT NOT NULL
);

INSERT INTO workspace_snapshots_v5 (
    id, instance_id, project_id, instance_type, snapshot_ref, snapshot_hash, blob_hash, snapshot_cursor_json, snapshot_msgpack, created_at
)
SELECT 
    id, instance_id, project_id, instance_type, snapshot_ref, snapshot_hash, snapshot_hash, snapshot_cursor_json, snapshot_msgpack, created_at
FROM workspace_snapshots;

DROP TABLE workspace_snapshots;
ALTER TABLE workspace_snapshots_v5 RENAME TO workspace_snapshots;

-- 4. Recreate file_revisions without strict unique foreign key dependency
CREATE TABLE IF NOT EXISTS file_revisions_v5 (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    snapshot_ref TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO file_revisions_v5 (id, name, description, snapshot_ref, created_at)
SELECT id, name, description, snapshot_ref, created_at FROM file_revisions;

DROP TABLE file_revisions;
ALTER TABLE file_revisions_v5 RENAME TO file_revisions;

-- 5. Secondary Indexes
CREATE INDEX IF NOT EXISTS idx_snapshots_blob ON workspace_snapshots(blob_hash);
CREATE INDEX IF NOT EXISTS idx_snapshots_instance ON workspace_snapshots(instance_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_ref ON workspace_snapshots(snapshot_ref);
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_instance_ref ON workspace_snapshots(instance_id, snapshot_ref);
