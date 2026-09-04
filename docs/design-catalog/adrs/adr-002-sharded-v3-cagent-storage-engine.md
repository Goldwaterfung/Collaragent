# ADR-002: Sharded V3 Project Storage Engine (`.cagent` & `.collar`)

## Status

**Superseded** (Superseded by V4 Single-File SQLite Embedded Storage Engine; retained for historical context and V3 migration reference)

## Context

Early iterations stored entire projects in monolithic single JSON files inside ZIP archives. As workspaces grew to contain hundreds of cards, documents, and rich LLM checkpoint histories, saving individual keystrokes or layout changes required serializing multi-megabyte JSON payloads and re-zipping files, causing disk thrashing and high latency.

## Decision

We implement a **Version 3 Sharded Storage Architecture** (`CagentStorage`) coupled with live working directories (`.collar/`):

1. **Live Directory Mount**: When opening a `.cagent` ZIP archive, it is extracted into a local working directory (`.collar/`) adjacent to the file or in OS temporary storage.
2. **Sharded Disk Partitioning**:
   - `manifest.json`: Lightweight metadata (magic bytes, version, project list, instance IDs and summaries) without content bodies.
   - `state.json`: Global operational state (chat session messages, LangGraph checkpoint heads, file revisions, command logs, archive sync dirty flags).
   - `instances/<instanceId>.json`: Sharded instance payloads (Lexical `DocumentPayload` and `GraphCanvasDTO`) written independently and atomically.
   - `snapshots/<sha256>.msgpack`: Content-addressed binary workspace snapshots encoded with MessagePack (`msgpackr`) for fast time-travel restoration.
3. **Lock Protection**: A `<path>.lock` file with `{ pid, time }` prevents concurrent read/write collisions across processes.

## Consequences

### Positive

- Fine-grained incremental saves: Modifying a single card only rewrites its specific `instances/<id>.json` file (~few kilobytes).
- Snapshot creation is instantaneous via MessagePack binary encoding and content hashing.
- Full portability: Closing the window packs the live `.collar/` folder back into a clean `.cagent` ZIP package.

### Negative / Trade-offs

- Requires dirty tracking (`archiveSync.isUpdated`) to trigger ZIP re-compression on application shutdown or manual export.
- Requires migration logic (`ImportCagentArchive.ts`) to upgrade legacy monolithic V2 archives to V3.

## Compliance

Verified via `src/main/server/fileServer/storageEngine.ts` and `src/main/server/fileServer/FolderInstanceContentStore.ts`.

## Superseded By V4 Architecture (Single-File SQLite)

In Version 4, the sharded `.collar/` folder and ZIP re-compression lifecycle are replaced by a **Single-File SQLite Embedded Storage Engine** (`.cagent`):

- **Zero ZIP extraction/re-compression overhead**: Works directly on disk using `better-sqlite3` in WAL mode (`synchronous = NORMAL`).
- **Relational Integrity**: Projects, instances, chat messages, LangGraph checkpoints, and ADR-006 large tool outputs are organized in relational tables with foreign keys and B-Tree indexes.
- **Instance BLOBs**: `instances.content_msgpack` stores packed DocumentPayload and GraphCanvasDTO with lazy loading on demand.
- **Single-Writer Concurrency**: `<path>.cagent.lock` with stale PID detection.
- **ETL Upgrades**: `StorageMigrationEngine.ts` automatically detects legacy V2/V3 `.cagent` archives and migrates them non-destructively to V4 SQLite.
- **Compliance**: Verified via `src/main/server/fileServer/SqliteStorageEngine.ts`, `src/main/server/fileServer/SqliteCheckpointStore.ts`, and `src/main/server/fileServer/db/SqliteDatabase.ts`.
