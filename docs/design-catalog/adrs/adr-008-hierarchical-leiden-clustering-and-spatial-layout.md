# ADR-008: Hierarchical Leiden Community Detection, Derived Group Enclosures, and Two-Tier Spatial Layout

## Status

**Accepted**

## Context

As scholarly concept maps and agentic knowledge graphs grow in size, visually untangling dense networks of cards and edges becomes critical for human comprehension. Users and autonomous agents require automated semantic grouping (community detection) to discover themes, modularize complex domains, and physically separate distinct topic clusters.

Initial implementations suffered from several structural deficiencies:

1. **Schema & Persistence Dilemma**: Creating a first-class `Group` entity would require bumping `schemaVersion: 2` in `GraphCanvasDTO`, breaking backwards compatibility with existing `.cagent` archives, necessitating new WebSocket CRDT wire messages (`graph:add_group`), and complicating mathematical command inversion (`InverseCommandEngine`).
2. **Persistence Data Loss on Reload**: The previous clustering trigger dispatched a monolithic `ReplaceGraph` command. Because `CanvasSyncPlugin` only mapped granular commands (`graph:update_node`, `graph:update_node_layout`), `ReplaceGraph` was dropped, causing clustering results to disappear on reload.
3. **Concurrency & Race Conditions**: Leiden clustering runs off-thread in a WebWorker. Replacing the full graph with a snapshot captured at trigger time destroyed any concurrent card edits, memo typing, additions, or movements performed while the worker executed.
4. **Lack of Spatial Separation**: The Leiden algorithm only assigns partition IDs; it does not compute 2D coordinates. Running standard single-tier Dagre or leaving nodes in place resulted in overlapping cards and unreadable crossing edges across cluster boundaries.
5. **Agent Tool Wire Mismatch**: The WebSocket server transmits canvas snapshots using wire DTOs (`graph.nodes` and `graph.relationships`), while `executeReadGraph` accessed domain entity maps (`graph.nodesById` and `graph.relationshipsById`), causing `readGraph` to always return 0 nodes and 0 edges.

## Decision

We implement **Option A: Computed / Derived Cluster Layer** paired with a **Two-Tier Hierarchical Auto-Layout Engine**, off-thread WebWorker delta patching, and granular transactional synchronization:

1. **Computed / Derived Cluster Layer (Schema Invariant)**:
   - Preserve `GraphCanvasDTO` V1 with zero breaking changes.
   - Store cluster assignments as semantic node attributes (`node.attrs.clusterId`, `node.attrs.clusterPath`, `node.attrs.clusterRunId`, `node.attrs.clusterParams`).
   - Group bounding envelopes, color-coded borders, statistics, and header drag bars are derived on-the-fly in the renderer via `useClusterGroups` and rendered inside `ClusterGroupContainer` (`React.memo`).

2. **Two-Tier Hierarchical Auto-Layout Engine (`clusterLayout.ts`)**:
   - **Tier 1 (Intra-Cluster Local Layout)**: For each cluster partition, computes Dagre layout on internal edges, or arranges disconnected cards in a compact grid flow (`MAX_CLUSTER_GRID_COLUMNS = 3`), adding internal padding (`DEFAULT_CLUSTER_PADDING = 32px`) and header clearance (`CLUSTER_HEADER_HEIGHT = 28px`).
   - **Tier 2 (Inter-Cluster Macro Graph Layout)**: Models clusters as macro-nodes connected by aggregated cross-cluster edges. Positions connected macro components via Dagre (`DEFAULT_CLUSTER_MARGIN = 120px`) and packs disconnected clusters using 2D shelf-packing (`MAX_CLUSTER_GRID_COLUMNS = 3`).
   - Offsets single-cluster boundaries with positive anchor coordinates `(anchorX, anchorY)` to prevent negative bounding box clipping.

3. **Concurrency-Safe Off-Thread Delta Patching**:
   - Leiden community detection runs off-thread in `leiden.worker.ts` via `workerClient.ts` with `AbortSignal` cancellation and progress event streaming (`ClusteringProgress`).
   - Returns structured calculation results (`CanvasClusteringResult`: `clusterAttrsByNodeId` and `layoutByNodeId`) instead of replacing the entire graph.
   - Live state delta patching applies updates onto `stateRef.current`, ensuring concurrent user edits (card text, memos, positions) are preserved.

4. **Granular Transactional Persistence via WebSocket**:
   - `runClustering` and `clearClusters` dispatch atomic command transactions containing granular `UpdateNode` (cluster attributes) and `MoveNode` (rearranged layout coordinates) via `dispatchTransaction(commands)`.
   - `CanvasSyncPlugin` translates these commands to `graph:update_node` and `graph:update_node_layout`, streaming them over WebSocket to SQLite persistence and peer clients.

5. **Agent Tool Normalization & Dual Wire/Domain Parsing**:
   - In `src/workspace/wstools/manageGraph.ts`, `extractGraphRecords` and `parseGraphFromSnapshot` support both wire DTO snapshots (`graph.nodes` / `graph.relationships`) and domain snapshots (`graph.nodesById` / `graph.relationshipsById`).
   - Resolves `readGraph` returning empty graphs and enables `writeGraph` in `merge` mode to resolve existing nodes by alias.
   - Filters out `'__unassigned__'` clusters from LLM tool responses.

6. **Design System & Solid Theme Styling**:
   - Centralizes dimensional and layout tokens in `src/shared/constants.ts` (`CLUSTER_CONTAINER_Z_INDEX = 5`, `CLUSTER_PILL_Z_INDEX = 30`, `MAX_CLUSTER_GRID_COLUMNS = 3`, `CLUSTER_ACCENT_BAR_WIDTH_PX = 3.5`, `CLUSTER_LABEL_MAX_WIDTH_PX = 200`, `CLUSTER_PROGRESS_MAX_WIDTH_PX = 260`, `CLUSTER_FILL_OPACITY_PERCENT = 5`).
   - Strictly enforces solid `bg-white` styling on the Canvas Toolbar, cluster menu, and progress pill (no transparency or `backdrop-blur-*` leakage).

7. **Structured Error Taxonomy (Rule 6)**:
   - Uses centralized `WorkspaceErrorCode` (`WORKSPACE_CLUSTER_EXECUTION_FAILED`, `WORKSPACE_LAYOUT_COMPUTATION_FAILED`, `WORKSPACE_CLUSTER_ABORTED`, `WORKSPACE_INVALID_CLUSTER_SPEC`) and preserves upstream error causes end-to-end.
   - Surfaces error states directly in `ClusterProgressPill` with an error badge and dismiss action.

## Alternatives Considered

### Option B: Explicit First-Class `groups` Domain Entity

- **Pros**: Groups exist as dedicated records with individual metadata.
- **Cons / Rejected**: Requires bumping `schemaVersion: 2`, rewriting the SQLite persistence layer, defining new WebSocket CRDT wire operations (`graph:add_group`, `graph:update_group`), and modifying `InverseCommandEngine`. High risk of orphaned nodes or state desynchronization across sessions.

### Monolithic Snapshot Replacement (`ReplaceGraph`)

- **Pros**: Trivial local reducer dispatch.
- **Cons / Rejected**: Completely unhandled by `CanvasSyncPlugin:mapLocalToShared`, causing total data loss on reload. In addition, it creates an unresolvable race condition with concurrent user edits during background worker computation.

### Single-Tier Native Dagre Compound Graphs

- **Pros**: Single layout execution pass.
- **Cons / Rejected**: Dagre's native compound graphs lack support for 2D shelf-packing of disconnected components and produce uneven cluster stretching, causing inter-cluster edges to distort intra-cluster card alignment.

## Consequences

### Positive

- **Zero Breaking Changes**: Fully backwards compatible with existing `.cagent` archives and wire protocols.
- **Real-Time Persistence**: All clustering and layout changes sync across WebSocket and persist to SQLite without data loss.
- **Concurrent Safety**: User and agent edits made during off-thread community detection are never overwritten.
- **Visual Ergonomics**: Clear, color-coded cluster envelopes with drag action bars and non-transparent, theme-compliant toolbars.
- **Agent Integration**: AI agents can read cluster structures via `readGraph` and declaratively specify groups in `writeGraph`.

### Negative / Trade-offs

- **Derived Boundary Computation**: Moving member nodes requires recalculating group bounding boxes on-the-fly (`useClusterGroups`), mitigated via `React.memo` and spatial memoization.

## Compliance

- **Algorithms & Workers**: `src/workspace/canvas/domain/analysis/clustering/leiden/`
- **Two-Tier Layout Engine**: `src/workspace/canvas/domain/analysis/clustering/clusterLayout.ts`
- **Lifecycle & State Management**: `src/workspace/canvas/domain/analysis/clustering/clusteringLifecycle.ts`, `src/workspace/canvas/store.tsx`
- **UI Components**: `src/workspace/canvas/components/ClusterGroupContainer.tsx`, `ClusterProgressPill.tsx`, `CanvasToolbar.tsx`, `NodeHeader.tsx`
- **WebSocket & Agent Tools**: `src/workspace/sync/CanvasSyncPlugin.tsx`, `src/workspace/wstools/manageGraph.ts`
- **Constants & Error Taxonomy**: `src/shared/constants.ts`, `src/shared/errors/WorkspaceErrors.ts`
- **Verification Tests**: `clusterLayout.test.ts`, `clusteringLifecycle.test.ts`, `useClusterGroups.test.ts`, `autoLayout.test.ts`, `manageGraph.test.ts`
