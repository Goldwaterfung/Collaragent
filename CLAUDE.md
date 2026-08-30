# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Snapshot

CollarAgent is a **local-first desktop IDE** that pairs a DeepAgent (LangGraph ReAct) with an infinite concept canvas and a scholarly Lexical document engine. It unifies node-link graph modeling, LaTeX-grade document authoring, and staged AI co-authoring inside one Electron app. Projects live on disk as portable `.cagent` archives (live workspace: `.collar/`).

The **3-pane studio**: Visual Canvas (infinite graph) ↔ Scholarly Document (Lexical + KaTeX + GFM + DOCX export) ↔ AI Co-Pilot (multi-provider, staged proposals, time-travel checkpoints).

## Essential Commands

All commands run from the repo root.

```bash
# Install (also runs electron-builder install-app-deps as postinstall)
npm install

# Dev: launches Electron with HMR (main + preload + renderer)
npm run dev

# Optional backend Express server (dbServer/documentInstancesApi.js)
npm run dev:api

# Type-check (Node config covers main/preload/collaragent/workspace/shared;
# Web config covers renderer/workspace/shared). Both must pass before build.
npm run typecheck          # runs typecheck:node && typecheck:web
npm run typecheck:node
npm run typecheck:web

# Lint and format
npm run lint               # ESLint with cache; set NODE_OPTIONS='--max-old-space-size=8192'
npm run format             # Prettier --write .

# Build
npm run build              # typecheck + electron-vite build (out/ for main/preload, dist/ for renderer)
npm run build:backend      # node scripts/build-backend.mjs (legacy helper; referenced by build:full)
npm run build:full         # backend + electron-vite build
npm run start              # electron-vite preview (run a built bundle)

# Package installers (electron-builder)
npm run build:mac          # DMG/Zip
npm run build:win          # NSIS/Portable
npm run build:linux        # AppImage/deb
npm run build:unpack       # Unpacked dir build (no installer)

# Vitest (only present in devDeps; no `test` script wired yet)
npx vitest                            # run all unit tests
npx vitest run path/to/file.test.ts   # run a single test file
npx vitest -t "name pattern"          # run tests matching a name
```

Tests are colocated under `src/workspace/editor/lexical-playground/__tests__/unit/` (note: `lexical-playground/` is excluded from both TS configs, so vitest must run with its own resolver). Tests files use `*.test.ts` extension.

VS Code debug configurations exist in `.vscode/launch.json`: "Debug Main Process" (Node launch via `electron-vite`) and "Debug Renderer Process" (Chrome attach on `:9222`), or use the compound "Debug All".

## High-Level Architecture

Multi-process Electron app with strict layer boundaries. See `docs/design-catalog/README.md` for C4 diagrams and ADRs; `DESIGN.md` for UI design system.

```
┌──────────────────────────────────────────────────────────────────────┐
│ src/renderer   React 19 + Dockview (Tailwind v4) — UI, Canvas, Editor│
│ src/preload    Context-isolated IPC bridges (configIPC/agentIPC/     │
│                checkpointIPC/fileIPC/skillsIPC on window.*)          │
│ src/main       Electron Main host: windows, services, IPC handlers   │
│ src/collaragent DeepAgent runtime (LangGraph + middleware + backends)│
│ src/workspace  Canvas + Lexical editor + sync + persistence          │
│ src/shared     Zero-platform-dep contracts: IPC channels, schemas,   │
│                canvas/checkpoint types, services, constants          │
└──────────────────────────────────────────────────────────────────────┘
```

### Process topology (ADR-001)

- **Electron Main** (`src/main/index.ts`): window/menu lifecycle, IPC handlers, instantiates `ConfigManager`, `SecureStorage` (OS keychain via Electron `safeStorage`), `ModelManager`, `PersistenceManager`, `AgentFactory`. Window state persisted via `windowState.ts`.
- **Renderer** (Chromium): React + Dockview. Three resizable panes (Sidebar / Workspace / Chat). `App.tsx` gates on `useProjectSession().hasSession` → either `<Workspace />` or `<WelcomeScreen />`.
- **UtilityProcess per workspace** (`src/main/server/fileServer/process.ts`): forked via `utilityProcess.fork`, binds an Express 5 server on dynamic port `:0`, reports port back to Main; injected into renderer via URL query. Owns ZIP/MessagePack I/O and `<path>.lock` concurrency.
- **WebSocket server** (`src/main/server/ws/ws-server.ts`): real-time canvas/editor sync.

### Storage engine (ADR-002)

`CagentStorage` V3 sharded layout. On opening a `.cagent` ZIP, it extracts to a `.collar/` live directory:

- `manifest.json` — lightweight metadata (no bodies)
- `state.json` — chat messages, LangGraph checkpoint heads, archive-sync dirty flags
- `instances/<instanceId>.json` — Lexical `DocumentPayload` / `GraphCanvasDTO` sharded
- `snapshots/<sha256>.msgpack` — content-addressed binary snapshots (msgpackr)
- `<path>.lock` — `{ pid, time }` for cross-process protection

On window close, dirty `.collar/` repacks into `.cagent`. `ImportCagentArchive.ts` migrates legacy V2 monoliths.

### DeepAgent runtime (`src/collaragent`)

A 1:1 TypeScript port of Python's DeepAgents library on LangGraph. Public surface re-exported from `src/collaragent/index.ts`.

- `runtime/agent.ts` — `createDeepAgent(params)` composes `langchain.createAgent` with middleware: `todoListMiddleware`, `createFilesystemMiddleware`, `createSubAgentMiddleware`, `createPatchToolCallsMiddleware`, `createMemoryMiddleware`, `createSkillsMiddleware`, plus optional `summarizationMiddleware`, `anthropicPromptCachingMiddleware`, `humanInTheLoopMiddleware`, `contextEditingMiddleware`.
- `runtime/CanvasDiffEngine.ts`, `DocumentDiffEngine.ts`, `InverseCommandEngine.ts`, `PatchCommandEngine.ts` — deterministic undo/redo via mathematical command inversion (ADR-005).
- `middleware/` — subagents (task/dynamic_task), workspace context, skills, patch-tool-calls, fs, memory, agent-memory, todolist, date.
- `backends/` — `StateBackend`, `StoreBackend`, `FilesystemBackend`, `CompositeBackend`, plus `BaseSandbox` / sandbox protocol (ADR-006 large-tool-output eviction at 20k tokens / ~80KB).
- `skills/` — progressive disclosure skill loader; follows Agent Skills spec (ADR-004). Built-in skills in `src/collaragent/skills/<name>/SKILL.md`. Manifest from YAML frontmatter (name, description, etc.); `loader.ts` enforces `MAX_SKILL_FILE_SIZE`, `MAX_SKILL_NAME_LENGTH`, `MAX_SKILL_DESCRIPTION_LENGTH`.
- `checkpoint/` — `ChatCheckpointSaver` (filesystem), `CheckpointApiClient`, `CheckpointBundleStore`, `AgentCheckpointRegistry`.

`AgentFactory` (`src/main/agents/factory.ts`) builds the agent, caches by `(model, tools, subagents, middleware, mcpServers, sha256(apiKey))`, wires checkpointer from `PersistenceManager`, and mounts skills middleware pointed at user-configured skills source (`~`-prefixed paths expand to `os.homedir()`).

### IPC contracts (`src/shared/ipc`)

Channel constants live under `src/shared/ipc/<feature>/channels.ts`. The preload (`src/preload/index.ts`) wraps each into a typed `xxxIPC` object exposed on `window.*`. Streaming uses per-request dynamic channels (`agentStreamChannel`, `agentStreamEndChannel`, `agentStreamErrorChannel`) keyed by `streamId = crypto.randomUUID()`. Schemas are Zod-validated; canvas identifiers are nominal-branded (`NodeId`, `RelationshipId`, `PortId`, `GraphId` — ADR-003). The `shared/` module **must not** import Electron, DOM, or `node:fs` (project invariant).

### Workspace module (`src/workspace`)

- `canvas/` — store (`store.tsx`), domain types, commands, components (`Canvas.tsx`), Dagre/d3-hierarchy layouts, off-thread Leiden clustering worker.
- `editor/` — Lexical-based `CardEditor` with KaTeX math, Prism syntax, GFM tables, drag handles; `lexical-playground/` is a vendored reference (excluded from TS configs).
- `sync/` — `SyncClient`, `SyncClientPool`, `CanvasSyncPlugin`, `EditorSyncPlugin` over the per-workspace WebSocket.
- `persistence/` — DTOs/serialization (`canvasSerialization.ts`, `graphCanvasDto.ts`, `editorContent.ts`).
- `contexts/` — `project/ProjectSession`, `instance/InstanceContext` (`InstanceProvider` + `InstanceScope`), `skills/SkillsContext`.
- `wstools/` — message types sent over the canvas/editor WS.

### Renderer

- `App.tsx` — three-pane layout with drag-resize dividers (sidebar 150–500px, chat 300–min(800, 60% viewport)).
- `store/` — Zustand (`chatStore.ts`, `configStore.ts`).
- `components/Chat` — chat surface (21 components).
- `components/Workspace` — Dockview panels for `canvas`, `document`, `skill`. Canvas/Document/Skill rendered per `InstanceScope`.
- `components/Settings`, `components/Management`, `components/Welcome`, `components/Layout` (TitleBar, ProgressBar), `components/Utilities` (Divider).
- TanStack Query provider at root with `staleTime: 30s`.
- Tailwind v4 (`@tailwindcss/vite`); design tokens in `src/renderer/assets/base.css`. Custom Dockview theme `dockview-theme-custom`.

## Critical Invariants

From `docs/design-catalog/requirements.md` and `.agents/rules/coding-rules.md`:

1. **`src/shared` is platform-agnostic** — no Electron, DOM, or `node:fs` imports. Add code here only if reusable across processes.
2. **No hardcoded constants** — dimensional params (`DEFAULT_NODE_WIDTH`, `NODE_SPACING`) and design tokens must come from centralized constants/`DESIGN.md`.
3. **No silent fallbacks** — schema mismatches and I/O failures must surface as typed errors.
4. **Contract-first IPC** — Zod schemas at boundaries; nominal type branding for canvas IDs.
5. **Avoid generic fallbacks** — fallback logic hides failures and unpredictably loads the system (project rule).
6. **Tool-output eviction** — outputs >20k tokens (~80KB) are evicted to `/large_tool_results/` (ADR-006).
7. **Recursion ceiling** — `recursionLimit: 200` on subagent delegation.
8. **Canvas IDs are nominal-branded** (`src/shared/canvas/types.ts`) — required for ADR-003 type safety.

## Tailwind / UI Rules (`.agents/rules/tailwind-styling-rules.md`)

- Always use `focus:outline-none` (or `outline-none!`) on focusable elements; never the default focus ring.
- Map colors to `--color-surface-*` / `--color-primary` / `--ev-c-text-*` tokens (see `src/renderer/assets/base.css`).
- Mobile-first responsive (`sm:`, `md:`, `lg:`); `border-surface-200` for soft borders; `bg-surface-50` page bg; Tailwind v4 idioms (`shrink-0` not `flex-shrink-0`).
- Inter font with system fallback stack; text hierarchy `text-xs` (meta) → `text-xl` (headings).

## Path Aliases

Configured in `electron.vite.config.ts` and matching tsconfig `paths`:

- `@shared/*` → `src/shared/*`
- `@workspace/*` → `src/workspace/*`
- `@main/*` → `src/main/*`
- `@collaragent/*` → `src/collaragent/*`
- `@renderer/*` → `src/renderer/*` (renderer only)

## Pointers to Authoritative Docs

- **README.md** — product overview, features, install/run, OS-specific packaging.
- **DESIGN.md** — UI design system, components, patterns, Tailwind tokens, layout grid.
- **docs/design-catalog/README.md** — C4 architecture, EventStorming flows, ADRs.
- **docs/design-catalog/adrs/** — ADR-001..007 (multi-process, storage, IDs, skills, inverse-commands, tool eviction, WS protocol).
- **docs/design-catalog/requirements.md** — functional + non-functional requirements + the invariants above.
- **src/shared/README.md** — `shared/` rules.
- **src/main/server/README.md** — utility-process file server layout.
- **.agents/rules/coding-rules.md**, **tailwind-styling-rules.md** — must-follow project rules.

## Skills Bundled with the Agent

Progressive-disclosure skills ship inside the codebase at `src/collaragent/skills/`:

- `apa-research-execution-specialist` (`SKILL.md`)
- `focused-execution-specialist` (`SKILL.md`)
- `holistic-thinking-analyst` (`SKILL.md`, plus `SKILL-zhtw.md`)

User-level skills live under the configured skills source (see Settings → Middleware → Skills; `~`-prefixed paths expand via `os.homedir()`).