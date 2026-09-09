# Workspace-as-Wiki — Architectural Design Proposal

**Objective:** Transform the Workspace from "documents + parallel canvas" into a "single source of truth + automatic projection" agent-native knowledge engine, enabling the LLM to truly bridge across all documents. Core conviction: **Linkage must be structurally guaranteed by the system, not left to agent discipline.** Unlike Karpathy's markdown/Obsidian design: our writer is an LLM, storage consists of structured blocks, and operations are performed via APIs—allowing discipline to be "compiled into the tools" rather than written in `AGENTS.md` hoping the agent remembers.

## 1. Why Karpathy's Design Cannot Be Directly Ported

| Assumption               | Karpathy's Markdown / Obsidian                     | CollarAgent Workspace                                                |
| :----------------------- | :------------------------------------------------- | :------------------------------------------------------------------- |
| **Content Format**       | Plain text markdown; editable by any text editor   | Structured HTML blocks with stable block IDs; authored via LLM tools |
| **Link Substrate**       | Inline `[[wikilink]]` parsed directly by editors   | **Lacks a machine-checkable link language (rich-text blocks)**       |
| **Graph Nature**         | Derived view parsed on-the-fly when reading files  | Parallel independently stored artifact (causes drift if unlinked)    |
| **Source of Discipline** | `AGENTS.md` (prompt-level, relies on agent memory) | Can be compiled into tools/APIs (structural layer, guaranteed)       |
| **Granularity**          | Page-level links                                   | Block-level (claim-level)—finer and more precise than markdown       |

## 2. Current System Diagnosis

- **Same-Name Collision Hell (Resolved 2026-09-08):** Original issue: When a document and canvas with the same name coexist in a project, `readDocument` and `readGraph` both returned `WORKSPACE_MULTIPLE_INSTANCES` unable to disambiguate, causing a split-brain identity. **Resolved in source code and empirically verified with regression tests:** under the same project, same-name `readDocument` and `readGraph` can be addressed concurrently, returning their respective `instanceId` and content (regression test case: `autonomous-harness-ontology`). This is no longer an active bug; preserved as a Phase 0 motivation record and regression case.
- **Lack of Content Derivation (Resolved 2026-09-09):** Implemented in `GraphCompiler.ts` and `compileGraph.ts`. Edits in documents are extracted into claim edges via `LinkExtractor.ts`, written to `RelationalLedgerStore`, and compiled directly into layout-preserving `GraphCanvasDTO` instances stored in SQLite for `readGraph` inspection.
- **Missing Common Link Substrate (Resolved 2026-09-09):** Implemented Lexical AST node `InlineClaimBadgeNode`, markdown transformer `CLAIM_BADGE_TRANSFORMER` with `[[rel:targetEntity|justification]]` syntax, and AST extractor `LinkExtractor.ts` parsing typed claims directly from HTML block runs.
- **Unstructured Linting (Resolved 2026-09-09):** Implemented two-tier automated linting: `L1StructuralLinter.ts` (deterministic, zero-token checks for unresolved symbols, orphans, `anchor_lost`, and Tarjan SCC cycles) + `L2SemanticLinter.ts` (LLM-assisted dialectical audits for contradictions, staleness, implicit mentions, and research gaps).
- **Memo Content Not Returned (`readGraph` Bug) (Resolved 2026-09-08):** Fixed in [`manageGraph.ts`](file:///Users/goldenfung/Documents/collaragent/src/workspace/wstools/manageGraph.ts) by reading node memo attributes during snapshot parsing. Validated via automated regression test in `manageGraph.test.ts`. Full memo strings are now consistently returned to agents when `includeMemo=true`.
- **Entity $\leftrightarrow$ Document Auto-Link Unmaterialized (Resolved 2026-09-09):** Implemented in `GraphCompiler.ts` and `compileGraph.ts`. Every active node entity without pre-existing layout coordinates is automatically provisioned non-colliding layout positions on the canvas, with bidirectional linkage between documents and canvas nodes.

## 3. Core Design Principles

- **P1 Single Entity, Multiple Facets:** One unique name = one entity. The document is its _content facet_, the relational ledger is its _topological facet_, and the canvas stores its _layout facet_ (position, visual grouping). Completely eliminates parallel split-brain instances. Naming is identity; duplicate names are errors.
- **P2 Links Are First-Class Citizens of Content (Typed + Bidirectional + Justified):** Documents can declare: "This claim references source X, and supports/contradicts entity Y". Links are not decorations; they are data carrying a typed relation `rel` (`supports`, `contradicts`, `supersedes`, `details`, `derived_from`, `cites`) alongside context and rationale. A link without justification is mere decoration.
- **P3 Unified Relational Ledger & Bi-Directional Synchronization:** Originally envisioned as a strictly one-way compiled read-only artifact (like Karpathy's Obsidian graph view). However, in CollarAgent, **canvases are an active ideation medium editable by both agents and humans**. Therefore, P3 evolves into the **Unified Relational Ledger with Two Provenance Levels**:
  - `canvas_relational`: Ideation links created visually on the canvas or via `writeGraph`. They populate the ledger with **zero text pollution** (no synthetic sentences injected into document prose).
  - `document_claim`: Crystallized claims anchored to specific Lexical blocks with justifications, rendered as interactive inline badges.
  - The ledger serves as the single source of topological truth. Graph topology cannot drift from the ledger, while visual layout coordinates are preserved independently.
- **P4 Compile Discipline into APIs:** Provide high-level atomic operations (`ingestSource`, `queryAndFileBack`, `lintWorkspace`). The system guarantees each operation atomically updates related documents, ledger relations, indices, and append-only logs. Agents cannot omit a step even if they try.
- **P5 Memo = Curation Annotation, Not Linkage Substrate:** Memos store "why this node matters, provenance context, and which document section it corresponds to"—context meant for human/agent review, not compiler data. Linkages (who connects to whom, typed relations) belong in the Relational Ledger and document content (P2). Using memos as the source of truth for links would recreate split-brain drift, duplicate data, and bypass compiler validation. Memos must be readable via `readGraph` to be effective (see §2 memo bug).

## 4. Target Data Model

**Entity:**

```typescript
Entity {
  id: "unique-name",
  type: "page" | "concept" | "source" | "claim" | "log",
  facets: {
    content: Block[],        // Lexical Document body
    ledger: LedgerEntry[],   // Single topological truth for edges
    layout?: CanvasLayout    // Visual geometry (x, y, w, h, cluster)
  },
  meta: { created, updated, tags, sourceOfTruth: "ledger" }
}
```

**Block-Level Links & Provenance:**
Each block carries stable IDs and can embed machine-checkable claim links:

```typescript
refs: [{ target: "entity-id", rel: enum, justification: "string", since: "block-id|source-id" }]
```

Because blocks have stable IDs, we achieve claim-level granularity—substantially more precise than Obsidian's page-level links (e.g., _"This paragraph directly contradicts paragraph 3 of Entity X"_).

**Relational Ledger & Compiler (Bi-directional Derived Graph):**

- **Input:** Relational Ledger (unifying `canvas_relational` and `document_claim` edges) + Canvas Layout store.
- **Output:** Materialized Canvas Graph (nodes + typed edges) + Backlink Inverted Index.
- Purely deterministic and incremental (event-sourcing: every edit is an op, and the graph is a materialization of the ledger and layout).

**Backlink Index:**
An inverted index maintained by the compiler providing `getBacklinks(id)` and `getOutlinks(id)`—allowing the LLM during queries to traverse backward and forward through associative trails like a human in Obsidian.

**Derived Documents (`index.md` / `log.md`):**
Converted into derived documents:

- `index.md` is compiled automatically from entity metadata.
- `log.md` is compiled automatically from the append-only operational log.
  Eliminates the possibility of "forgetting to update the index".

## 5. Two-Tier Linting Redesign

Computer science invariants (orphans, dangling references, type consistency) are not discarded; they are upgraded into genuine compiler-grade checks:

| Layer                               | Checks                                                                                                                                                                                                                            | Nature                                                                   |
| :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| **L1 Deterministic Compiler Check** | Dangling links (pointing to non-existent entity = unresolved symbol); duplicate entity names; 0-inbound orphan entities; unreferenced raw sources; layout records pointing to deleted entities; `anchor_lost` blocks              | System errors immediately, like a compile error (zero LLM token cost)    |
| **L2 LLM-Assisted Semantic Lint**   | Contradictions (grouped by typed `rel: 'contradicts'`, verified by LLM); staleness (claims with `as-of` superseded by newer sources); missing cross-references (entity mentioned in text without a link); proactive research gaps | Semantic judgment performed on top of L1's verified structural substrate |

## 6. Migration Roadmap (Low Risk to High Risk)

| Phase                                                                        | Content                                                                                                                                                                                                                          | Deliverable                                                                                                                                                                                                                                         |
| :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Namespace Unification**                                                  | Documents and canvases share a unified namespace; same-name facets merged or disambiguated with strict prefixes                                                                                                                  | **Completed** (2026-09-08 read-side verified): Same-name collisions eliminated; read-side cleanly addressed                                                                                                                                         |
| **1 Relational Ledger & Read-Side Projection**                               | Canvas topology becomes a materialized view of the Relational Ledger; nodes/edges projected from ledger while layout coordinates are preserved independently; fix `readGraph` memo extraction bug                                | **Completed** (2026-09-08): `RelationalLedgerStore` double-adjacency engine; `manageGraph.ts` memo bug resolved; verified via `relationalLedger.test.ts` and `manageGraph.test.ts`                                                                  |
| **2 Typed Links & Inline Badges in Content Model**                           | Implement `InlineClaimBadgeNode` in Lexical editor; embed block refs; compiler reads typed relations; implement click-to-block jump and graceful degradation (`anchor_lost`)                                                     | **Completed** (2026-09-08): `InlineClaimBadgeNode`, `ClaimBadgeTransformer` (`[[rel:target\|justification]]`), `EditorSyncPlugin` bidirectional claim promotion, `BlockIdPlugin`, `UnanchoredLinksTray`                                             |
| **3 High-Level Atomic Ops**                                                  | `ingestSource`, `queryAndFileBack`, `lintWorkspace` become system-level tools composing lower-level APIs atomically with mathematical rollback                                                                                   | **Completed** (2026-09-08): Atomic `ingestSource` and `queryAndFileBack` with ADR-005 mathematical rollback; Tarjan SCC cycle gate for `supersedes`; `L1StructuralLinter` compiler; agent skills updated                                            |
| **4 Incremental Compiler + Backlink Index + L1/L2 Lint CLI + SQLite Canvas** | Event-sourcing, incremental materialization, deterministic L1 compiler checks permanently active, L2 semantic linter, headless CLI (`wiki:lint`, `wiki:compile`), `compileGraph` SQLite materialization, Workspace Tool standard | **Completed** (2026-09-09): `GraphCompiler.ts`, `L2SemanticLinter.ts`, `LegacyArchiveBootstrapper.ts`, `compileGraph.ts`, `scripts/wiki-cli.mjs`, defensive tool deduplication in `WorkspaceMiddleware`, verified across 70 test suites (506 tests) |

## 7. Open Questions & Resolved Decisions

- **Human Reading Experience (Resolved 2026-09-08):** Block-level claim links are rendered as **inline clickable badges** (`InlineClaimBadgeNode`) inside Lexical editor paragraphs, featuring popovers with entity summaries, justifications, and a "Jump to Canvas Node" shortcut.
- **Canvas Bi-Directionality (Resolved 2026-09-08):** Solved via the **Unified Relational Ledger with Two Provenance Levels** (`canvas_relational` vs. `document_claim`). Visual brainstorming on canvas or via `writeGraph` records unanchored edges in the ledger without polluting document prose with synthetic text.
- **Relation (`rel`) Vocabulary:** Seeded with a core typed enum (`supports`, `contradicts`, `supersedes`, `details`, `derived_from`, `cites`, `relates_to`), extensible by domain schemas (aligning with Karpathy's schema co-evolution).
- **Backwards Compatibility:** Phased non-breaking rollout. Phase 0–1 preserve existing `writeGraph` and `editDocument` tool calls without breaking user projects.
- **L2 Lint Triggering & Cost:** Semantic linting invokes LLMs. Triggered on-demand or during milestone stage completions rather than on every keystroke.
- **Tool Protocol & Wire Deduplication (Resolved 2026-09-09):** Workspace tools are deduplicated in `WorkspaceMiddleware` via a `Map` by tool name, preventing duplicate tool schemas from reaching LLM providers (resolving Anthropic/Console Go 400 `invalid_request_error`). All tools follow the Workspace Tool standard returning structured `{ status, action, ... }` with `extractErrorInfo`.
- **SQLite Canvas Compilation (`compileGraph`) (Resolved 2026-09-09):** `compileGraph` compiles the relational ledger into layout-preserved `GraphCanvasDTO` directly stored in SQLite, allowing agent inspection via `readGraph`.

## 8. Maintenance Log

- **2026-09-08 (Session 1):** Same-name collision hell resolved in source code and empirically verified (read-side disambiguation). §2 entry downgraded from "active issue" to "historical record + regression case"; §6 Phase 0 marked complete. Using status updates rather than deletion preserves the full trace: Problem $\to$ Evidence $\to$ Fix $\to$ Verification. This record embodies the log-centric wiki philosophy.
- **2026-09-08 (Session 2):** Established memo role = curation annotation (added P5). Empirical testing identified two issues recorded in §2: `readGraph includeMemo` omitted full memo text (bug to fix in source code); entity $\leftrightarrow$ document auto-link was unmaterialized (34 canvas nodes vs. 5 documents).
- **2026-09-08 (Session 3):** Bi-Directional Architecture & Relational Ledger Breakthrough. Recognized that CollarAgent's concept canvas is an active, interactive visual ideation medium, not a passive read-only visualizer like Obsidian's graph view. Evolved P3 from a naive read-only compiled artifact into the **Unified Relational Ledger with Two Provenance Levels** (`canvas_relational` for visual ideation with zero text pollution, and `document_claim` for formal crystallization with click-to-block jumps). Resolved open questions for inline clickable badges and translated all documentation into English for unified repository accessibility.
- **2026-09-08 (Session 4):** Linkage Syntax Data Structure Design for `CardEditor.tsx`. Audited Lexical editor subsystem against specification. Identified four concrete design gaps (AST node class, persistence schema in `InlineRunSchema`, Markdown shortcut syntax, and DOM block ID projection). Formalized data structures in `spec-workspace-as-wiki.md` §6.3: defined `SerializedInlineClaimBadgeNode`, extended `@shared/schemas/instances.ts` with `ClaimBadgeSchema`, established `[[rel:targetEntity|justification]]` markdown shortcut syntax via `CLAIM_BADGE_TRANSFORMER`, and defined DOM block ID anchoring for canvas-to-editor click-to-block jumps.
- **2026-09-08 (Session 5):** Comprehensive Gap Resolution & Full Specification Decision. Audited the remaining 8 architectural and operational gaps across the specification: (1) Decided single workspace-level ledger instance topology (`ledger-default.json`) for $O(1)$ backlink/outlink lookups; (2) Formalized typed WebSocket wire protocol (`LedgerCommand`) on `ws/ledger/:instanceId`; (3) Defined mathematical inversion table in `InverseCommandEngine` for atomic rollbacks; (4) Formalized Lexical block split/merge/overwrite identity reconciliation in `blockIdentityRegistry`; (5) Specified interactive `UnanchoredLinksTray` in `CardEditor.tsx`; (6) Established headless developer CLI (`yarn wiki:lint`, `yarn wiki:compile`); (7) Specified Tarjan SCC cycle detection fail-closed contract with diagnostic payload; (8) Defined legacy `.cagent` V3 archive bootstrap migration in `StorageMigrationEngine`. Decided and codified Decisions 3–10 in `spec-workspace-as-wiki.md`.
- **2026-09-09 (Session 6):** Complete implementation and quality gate verification for Phases 1–4. Implemented `RelationalLedgerStore`, `InlineClaimBadgeNode`, `UnanchoredLinksTray`, `ingestSource`, `queryAndFileBack`, `L1StructuralLinter`, `L2SemanticLinter`, `GraphCompiler`, `LegacyArchiveBootstrapper`, headless CLI (`wiki:lint`, `wiki:compile`), and `compileGraph` tool for SQLite canvas materialization. Enforced Workspace Tool standard across all tools and resolved duplicate tool schemas in `WorkspaceMiddleware`. Verified with 70 Vitest test suites (506 tests), zero `any` policy, clean `typecheck`, and full Electron production packaging.
