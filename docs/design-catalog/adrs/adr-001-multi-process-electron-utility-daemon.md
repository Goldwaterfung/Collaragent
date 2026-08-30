# ADR-001: Multi-Process Electron Host with Forked Utility Daemons

## Status
**Accepted**

## Context
CollarAgent manages complex desktop workspaces involving continuous real-time state synchronization, multi-megabyte ZIP archive unpacking/packing (`.cagent`), LangGraph agent checkpoint serialization, and full Lexical document persistence. Running file compression, JSON parsing, disk I/O, and Express REST endpoints directly inside the Electron Main process caused event loop stuttering and dropped frames in the Chromium UI thread.

## Decision
We decouple all workspace filesystem operations, archive management, and REST APIs into dedicated Node.js `UtilityProcess` instances forked via `utilityProcess.fork(scriptPath)`.
- Each open workspace window is allocated an independent `UtilityProcess` running `src/main/server/fileServer/process.ts`.
- Communication between Electron Main and the Utility Process uses structured Node.js `parentPort` messages (`start`, `set-ws-port`, `get-close-state`, `prepare-close`, `export`, `close`).
- The Utility Process binds an Express 5 REST server to a dynamic port (`:0`) and reports its assigned port back to the Main process, which injects `apiPort` into the renderer via URL query parameters.

## Consequences
### Positive
- Heavy disk I/O, ZIP extraction (`yauzl`), and compression (`archiver`) run off the main event loop, maintaining 60 FPS in the renderer.
- Workspace processes are isolated; a crash or high-memory operation in one workspace does not terminate other windows or the host app.
- Clear separation between host OS lifecycle and workspace data engines.

### Negative / Trade-offs
- Slight IPC communication latency over `parentPort` when orchestrating window closures.
- Dynamic port allocation requires passing connection credentials and port mappings during window creation.

## Compliance
Verified via `src/main/windows/WindowManager.ts` and `src/main/server/fileServer/process.ts`.
