# ADR-002: Sharded V3 Project Storage Engine (`.cagent` & `.collar`)

## Status
**Accepted**

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
