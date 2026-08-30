import { z } from "zod";
import type { GraphCanvasDTO } from "@workspace/persistence/graphCanvasDto";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, NODE_SPACING } from "@shared/constants";
import { createPortId, getBestDirection } from "@workspace/canvas/domain/portUtils";
import type { NodeLayout } from "@workspace/canvas/domain/types";
import { getHeaderWidthForName, NODE_HEADER_HEIGHT } from "@workspace/canvas/components/nodeLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Schema Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const DirectionSchema = z.enum(["LR", "TD", "RADIAL"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const ModeSchema = z.enum(["replace", "merge"]);
export type Mode = z.infer<typeof ModeSchema>;

export const NodeSpecSchema = z.object({
    entity: z.string().min(1).describe("Unique name for this node (stable ID or alias)."),
    name: z.string().optional().describe("Display name for the node."),
    memo: z.string().optional().describe("Optional memo text (always in markdown format)."),
    clearMemo: z.boolean().optional().describe("Set to true to clear existing memo content."),
}).passthrough();
export type NodeSpec = z.infer<typeof NodeSpecSchema>;

export function mergeMemoAttrs(
    existingAttrs: Record<string, unknown> | undefined,
    spec: {
        memo?: string;
        clearMemo?: boolean;
    }
): Record<string, unknown> {
    const attrs = { ...(existingAttrs || {}) };
    let changed = false;

    if (spec.clearMemo) {
        if ("memo" in attrs) changed = true;
        delete attrs.memo;
        if ("memoFormat" in attrs) changed = true;
        delete attrs.memoFormat;
    } else if (spec.memo !== undefined) {
        if (attrs.memo !== spec.memo) changed = true;
        attrs.memo = spec.memo;
        
        if (attrs.memoFormat !== "markdown") {
            attrs.memoFormat = "markdown";
            changed = true;
        }
    }

    if (changed) {
        attrs.memoUpdatedAt = new Date().toISOString();
    }

    return attrs;
}

export type MindMapNode = {
    entity: string;
    memo?: string;
    clearMemo?: boolean;
    children?: MindMapNode[];
};

// Dynamically generate a deep schema to avoid $ref (which breaks some LLM APIs)
// while allowing practically unlimited depth (here unrolled to 10 levels deep).
const MAX_DEPTH = 10;

let DynamicMindMapNodeSchema: z.ZodTypeAny = z.object({
    entity: z.string().min(1).describe("Entity name and label."),
    memo: z.string().optional().describe("Optional memo text (always in markdown format)."),
    clearMemo: z.boolean().optional().describe("Set to true to clear existing memo content."),
});

for (let i = 0; i < MAX_DEPTH; i++) {
    DynamicMindMapNodeSchema = z.object({
        entity: z.string().min(1).describe("Entity name and label."),
        memo: z.string().optional().describe("Optional memo text (always in markdown format)."),
        clearMemo: z.boolean().optional().describe("Set to true to clear existing memo content."),
        children: z.array(DynamicMindMapNodeSchema).optional().describe("Child nodes."),
    });
}

export const MindMapNodeSchema: z.ZodType<MindMapNode> = DynamicMindMapNodeSchema as z.ZodType<MindMapNode>;

export const EdgeSpecSchema = z.object({
    from: z.string().min(1).describe("Source node alias."),
    to: z.string().min(1).describe("Target node alias."),
    label: z.string().optional().describe("Optional relationship label."),
});
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>;

export const DeleteEdgeSpecSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
});
export type DeleteEdgeSpec = z.infer<typeof DeleteEdgeSpecSchema>;

export const WriteGraphSpecSchema = z.object({
    instanceId: z.string().min(1).describe("Target graph canvas instance ID."),
    direction: DirectionSchema.describe("Layout direction: LR, TD, or RADIAL."),
    mode: ModeSchema.describe("replace = overwrite entire graph, merge = extend existing graph."),
    startFrom: z.string().optional().describe("(merge mode) Entity alias to anchor new nodes from."),
    root: MindMapNodeSchema.optional().describe("Recursive root node for mind maps."),
    nodes: z.array(NodeSpecSchema).optional().default([]).describe("List of nodes to create (if not using root)."),
    edges: z.array(EdgeSpecSchema).optional().default([]).describe("List of edges to create (if not using root)."),
    deleteNodes: z.array(z.string()).optional().describe("(merge mode) Entity aliases to delete."),
    deleteEdges: z.array(DeleteEdgeSpecSchema).optional().describe("(merge mode) Edges to delete."),
    staged: z.boolean().optional().describe("Whether to stage the changes for review."),
}).passthrough();
export type WriteGraphSpec = z.infer<typeof WriteGraphSpecSchema>;

/**
 * Flattens a hierarchical mind map into a flat list of nodes and edges.
 */
export function flattenMindMap(root: MindMapNode): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
    const nodes: NodeSpec[] = [];
    const edges: EdgeSpec[] = [];

    function traverse(node: MindMapNode) {
        nodes.push({
            entity: node.entity,
            name: node.entity,
            memo: node.memo,
            clearMemo: node.clearMemo
        });

        if (node.children) {
            for (const child of node.children) {
                edges.push({
                    from: node.entity,
                    to: child.entity
                });
                traverse(child);
            }
        }
    }

    traverse(root);
    return { nodes, edges };
}

export function assertUniqueNodeEntities(nodes: NodeSpec[]): void {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const node of nodes) {
        const entity = node.entity.trim();
        if (seen.has(entity)) {
            duplicates.add(entity);
            continue;
        }
        seen.add(entity);
    }

    if (duplicates.size > 0) {
        throw new Error(
            `Duplicate node entity aliases are not allowed: ${Array.from(duplicates).join(", ")}`,
        );
    }
}

function assertEdgeEndpointsExist(edges: EdgeSpec[], nodeIds: ReadonlySet<string>): void {
    for (const edge of edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new Error(`Edge references unknown node alias: ${edge.from} -> ${edge.to}`);
        }
    }
}

function collectConnectedNodeIds(
    seedNodeIds: Iterable<string>,
    edges: EdgeSpec[],
    validNodeIds: ReadonlySet<string>,
): Set<string> {
    // Build an undirected adjacency view so we can find the full affected
    // component regardless of edge direction.
    const adjacency = new Map<string, Set<string>>();

    for (const edge of edges) {
        if (!validNodeIds.has(edge.from) || !validNodeIds.has(edge.to)) {
            continue;
        }

        if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set<string>());
        if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set<string>());

        adjacency.get(edge.from)!.add(edge.to);
        adjacency.get(edge.to)!.add(edge.from);
    }

    const visited = new Set<string>();
    const queue: string[] = [];

    for (const nodeId of seedNodeIds) {
        if (!validNodeIds.has(nodeId) || visited.has(nodeId)) {
            continue;
        }

        visited.add(nodeId);
        queue.push(nodeId);
    }

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        for (const neighborId of adjacency.get(nodeId) || []) {
            if (visited.has(neighborId)) {
                continue;
            }

            visited.add(neighborId);
            queue.push(neighborId);
        }
    }

    return visited;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout Constants
// ─────────────────────────────────────────────────────────────────────────────

const DAGRE_NODE_WIDTH = DEFAULT_NODE_WIDTH;
const DAGRE_NODE_HEIGHT = DEFAULT_NODE_HEIGHT;
const NODE_SPACING_VAL = NODE_SPACING;

// Step sizes for layout spacing
const STEP_X = DEFAULT_NODE_WIDTH + NODE_SPACING_VAL;
const STEP_Y = DEFAULT_NODE_HEIGHT + NODE_SPACING_VAL;

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Layout Algorithm
// ─────────────────────────────────────────────────────────────────────────────

import dagre from "@dagrejs/dagre";
import { tree, hierarchy } from "d3-hierarchy";

/**
 * Computes node positions using a radial tree layout via d3-hierarchy.
 * Best for mind maps and hierarchical data.
 */
export function computeRadialLayout(
    nodes: NodeSpec[],
    edges: EdgeSpec[],
    anchorX = 0,
    anchorY = 0,
): Record<string, NodeLayout> {
    if (nodes.length === 0) return {};

    // 1. Build a parent-child map and a name lookup
    const parentMap = new Map<string, string[]>();
    const childToParent = new Map<string, string>();
    const nodeSet = new Set(nodes.map(n => n.entity));
    const nameMap = new Map(nodes.map(n => [n.entity, n.name || n.entity]));
    
    for (const edge of edges) {
        if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
        const children = parentMap.get(edge.from) || [];
        children.push(edge.to);
        parentMap.set(edge.from, children);
        childToParent.set(edge.to, edge.from);
    }

    // 2. Find the root (node with no parent)
    const rootEntity = nodes.find(n => !childToParent.has(n.entity))?.entity || nodes[0].entity;

    // 3. Create d3 hierarchy
    const d3Root = hierarchy(rootEntity, (d) => parentMap.get(d) || []);

    // 4. Compute Tree Layout
    // Size is [angle in radians, radius]
    const depth = d3Root.height || 1;
    const radiusScale = Math.max(STEP_X, STEP_Y) * 0.9;
    const treeLayout = tree<string>().size([2 * Math.PI, depth * radiusScale]);
    treeLayout(d3Root);

    // 5. Convert Polar to Cartesian
    const layoutByNodeId: Record<string, NodeLayout> = {};
    d3Root.descendants().forEach((d) => {
        const entityId = d.data;
        const name = nameMap.get(entityId) || entityId;
        
        // Calculate dynamic dimensions for this specific node
        const w = getHeaderWidthForName(name);
        const h = NODE_HEADER_HEIGHT;

        const angle = (d as any).x - Math.PI / 2;
        const dist = (d as any).y;
        
        const x = anchorX + (dist ?? 0) * Math.cos(angle ?? 0);
        const y = anchorY + (dist ?? 0) * Math.sin(angle ?? 0);

        layoutByNodeId[entityId] = {
            x: x - w / 2,
            y: y - h / 2,
            width: w,
            height: h
        };
    });

    return layoutByNodeId;
}

/**
 * Computes node positions using the Sugiyama algorithms via Dagre.
 * This is the same layout engine used by Mermaid for flowcharts.
 * 
 * @param nodes List of nodes to layout
 * @param edges List of edges defining the hierarchy
 * @param direction Layout direction ("LR" or "TD")
 * @param anchorX X offset for the entire layout
 * @param anchorY Y offset for the entire layout
 */
export function computeAutoLayout(
    nodes: NodeSpec[],
    edges: EdgeSpec[],
    direction: Direction,
    anchorX = 0,
    anchorY = 0,
    _startFrom?: string, // Kept for interface compatibility, though Dagre handles this globally
): Record<string, NodeLayout> {
    if (nodes.length === 0) {
        return {};
    }

    // 1. Initialize Dagre Graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({
        rankdir: direction,
        nodesep: NODE_SPACING_VAL, // Horizontal spacing between nodes
        ranksep: NODE_SPACING_VAL, // Vertical spacing between ranks
        marginx: 0,
        marginy: 0
    });
    g.setDefaultEdgeLabel(() => ({}));

    // 2. Add Nodes
    for (const node of nodes) {
        g.setNode(node.entity, { 
            width: DAGRE_NODE_WIDTH, 
            height: DAGRE_NODE_HEIGHT 
        });
    }

    // 3. Add Edges
    for (const edge of edges) {
        g.setEdge(edge.from, edge.to);
    }

    // 4. Compute Layout
    dagre.layout(g);

    // 5. Extract Positions
    // Dagre returns center coordinates (x,y), but our system uses top-left (x,y)
    const layoutByNodeId: Record<string, NodeLayout> = {};
    
    // If we are merging (have an anchor), we need to offset the whole graph
    // Dagre always starts at 0,0 locally.
    
    // Find the min x/y to normalize if needed (usually 0, but good to be safe)
    let minX = Infinity;
    let minY = Infinity;
    
    g.nodes().forEach((v) => {
        const node = g.node(v);
        // dagre node stats
        const topLeftX = node.x - node.width / 2;
        const topLeftY = node.y - node.height / 2;
        
        if (topLeftX < minX) minX = topLeftX;
        if (topLeftY < minY) minY = topLeftY;
    });

    if (minX === Infinity) minX = 0;
    if (minY === Infinity) minY = 0;

    g.nodes().forEach((v) => {
        const node = g.node(v);
        // Convert center-based to top-left-based and apply anchor/offset
        const x = (node.x - node.width / 2) - minX + anchorX;
        const y = (node.y - node.height / 2) - minY + anchorY;

        layoutByNodeId[v] = {
            x,
            y,
            width: node.width,
            height: node.height
        };
    });

    return layoutByNodeId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Spec Application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique relationship ID based on from/to entities.
 * Format: "rel-{from}-{to}" for deterministic IDs.
 */
function generateRelationshipId(from: string, to: string): string {
    return `rel-${from}-${to}`;
}

/**
 * Determines port IDs based on node positions.
 */
function getPortId(fromNodeId: string, toNodeId: string, layoutByNodeId: Record<string, NodeLayout>) {
    const fromLayout = layoutByNodeId[fromNodeId];
    const toLayout = layoutByNodeId[toNodeId];

    if (!fromLayout || !toLayout) {
        // Fallback to east/west if layout is missing for some reason
        return {
            fromPort: createPortId(fromNodeId, 'east'),
            toPort: createPortId(toNodeId, 'west')
        };
    }

    const fromDir = getBestDirection(fromLayout, toLayout);
    const toDir = getBestDirection(toLayout, fromLayout);

    return {
        fromPort: createPortId(fromNodeId, fromDir),
        toPort: createPortId(toNodeId, toDir)
    };
}

/**
 * Applies a WriteGraphSpec to create or update a GraphCanvasDTO.
 * 
 * @param existingPayload - Current graph state (null for new graph)
 * @param spec - The declarative graph specification
 * @returns Updated GraphCanvasDTO
 */
export function applyGraphSpec(
    existingPayload: GraphCanvasDTO | null,
    spec: WriteGraphSpec,
): GraphCanvasDTO {
    const now = new Date().toISOString();

    // If root is provided, it takes precedence over flat nodes/edges
    if (spec.root) {
        const { nodes, edges } = flattenMindMap(spec.root);
        spec = {
            ...spec,
            nodes: [...(spec.nodes || []), ...nodes],
            edges: [...(spec.edges || []), ...edges],
        };
    }

    assertUniqueNodeEntities(spec.nodes || []);

    if (spec.mode === "replace" || !existingPayload) {
        // Replace mode: create fresh graph
        return createFreshGraph(spec, now);
    }

    // Merge mode: extend existing graph
    return mergeIntoGraph(existingPayload, spec, now);
}

function createFreshGraph(spec: WriteGraphSpec, timestamp: string): GraphCanvasDTO {
    const nodeIds = new Set((spec.nodes || []).map((node) => node.entity));
    assertEdgeEndpointsExist(spec.edges || [], nodeIds);

    const layoutByNodeId = spec.direction === "RADIAL" 
        ? computeRadialLayout(spec.nodes || [], spec.edges || [])
        : computeAutoLayout(spec.nodes || [], spec.edges || [], spec.direction);

    // Build nodes and relationships records
    const nodes: GraphCanvasDTO["graph"]["nodes"] = {};
    for (const nodeSpec of (spec.nodes || [])) {
        nodes[nodeSpec.entity] = buildGraphNode(nodeSpec);
    }
    const relationships = buildRelationshipRecord(spec.edges || [], layoutByNodeId, nodeIds);

    return {
        schemaVersion: 1,
        type: "graph-canvas",
        graph: { nodes, relationships },
        layout: { layoutByNodeId },
        meta: {
            createdAt: timestamp,
            updatedAt: timestamp,
        },
    };
}

function mergeIntoGraph(
    existing: GraphCanvasDTO,
    spec: WriteGraphSpec,
    timestamp: string,
): GraphCanvasDTO {
    // Start with copies of existing data
    const nodes = { ...existing.graph.nodes };
    const relationships = { ...existing.graph.relationships };
    const layoutByNodeId = { ...existing.layout.layoutByNodeId };

    // Step 1: Process deletions first
    if (spec.deleteNodes) {
        for (const entityToDelete of spec.deleteNodes) {
            delete nodes[entityToDelete];
            delete layoutByNodeId[entityToDelete];

            // Cascade: remove relationships connected to deleted node
            for (const [relId, rel] of Object.entries(relationships)) {
                if (rel.from.nodeId === entityToDelete || rel.to.nodeId === entityToDelete) {
                    delete relationships[relId];
                }
            }
        }
    }

    if (spec.deleteEdges) {
        for (const edgeToDelete of spec.deleteEdges) {
            const relId = generateRelationshipId(edgeToDelete.from, edgeToDelete.to);
            delete relationships[relId];
        }
    }

    const nextNodeIds = new Set<string>([
        ...Object.keys(nodes),
        ...(spec.nodes || []).map((node) => node.entity),
    ]);
    assertEdgeEndpointsExist(spec.edges || [], nextNodeIds);

    const mergedNodeSpecsById = new Map<string, NodeSpec>();

    for (const existingNode of Object.values(nodes)) {
        mergedNodeSpecsById.set(existingNode.id, {
            entity: existingNode.id,
            name: existingNode.name,
        });
    }

    for (const node of spec.nodes || []) {
        mergedNodeSpecsById.set(node.entity, node);
    }

    const existingEdgesForLayout: EdgeSpec[] = Object.values(relationships).map((relationship) => ({
        from: relationship.from.nodeId,
        to: relationship.to.nodeId,
        label: (relationship.attrs?.label as string) || undefined,
    }));
    const mergedEdgesForLayout: EdgeSpec[] = [...existingEdgesForLayout, ...(spec.edges || [])];
    const affectedSeedNodeIds = new Set<string>([
        ...(spec.nodes || []).map((node) => node.entity),
        ...(spec.edges || []).flatMap((edge) => [edge.from, edge.to]),
        ...(spec.startFrom ? [spec.startFrom] : []),
    ]);
    // Re-layout scope is limited to the connected component touched by this
    // merge, keeping unrelated graph regions stable.
    const affectedNodeIds = collectConnectedNodeIds(
        affectedSeedNodeIds,
        mergedEdgesForLayout,
        nextNodeIds,
    );
    const affectedNodes = Array.from(affectedNodeIds)
        .map((nodeId) => mergedNodeSpecsById.get(nodeId))
        .filter((node): node is NodeSpec => !!node);
    const affectedEdges = mergedEdgesForLayout.filter(
        (edge) => affectedNodeIds.has(edge.from) && affectedNodeIds.has(edge.to),
    );

    // Step 2: Calculate anchor position for new nodes
    let anchorX = 0;
    let anchorY = 0;

    if (spec.startFrom && layoutByNodeId[spec.startFrom]) {
        const anchorLayout = layoutByNodeId[spec.startFrom];
        // Position new nodes starting from anchor, offset by one step in the direction
        if (spec.direction === "LR") {
            anchorX = anchorLayout.x + STEP_X;
            anchorY = anchorLayout.y;
        } else {
            anchorX = anchorLayout.x;
            anchorY = anchorLayout.y + STEP_Y;
        }
    } else {
        // No anchor: find the bounding box of existing layout and place new nodes outside
        const existingLayouts = Object.values(layoutByNodeId);
        if (existingLayouts.length > 0) {
            const maxX = Math.max(...existingLayouts.map(l => l.x + l.width));
            const maxY = Math.max(...existingLayouts.map(l => l.y + l.height));

            if (spec.direction === "LR") {
                anchorX = maxX + NODE_SPACING_VAL;
                anchorY = 0;
            } else {
                anchorX = 0;
                anchorY = maxY + NODE_SPACING_VAL;
            }
        }
    }

    const anchorNodeId =
        (spec.startFrom && affectedNodeIds.has(spec.startFrom) && layoutByNodeId[spec.startFrom]
            ? spec.startFrom
            : undefined) ||
        Array.from(affectedNodeIds).find((nodeId) => !!layoutByNodeId[nodeId]);

    // Step 4: Compute layout
    let newLayout: Record<string, NodeLayout>;
    if (spec.direction === "RADIAL") {
        // For Radial/Mindmap, the layout depends on the total structure to prevent overlaps.
        // We perform a global re-calculation of the layout for ALL nodes.
        const allNodesForLayout: NodeSpec[] = Object.values(nodes).map(n => ({
            entity: n.id
        }));
        
        const allEdgesForLayout: EdgeSpec[] = Object.values(relationships).map(r => ({
            from: r.from.nodeId,
            to: r.to.nodeId,
            label: (r.attrs?.label as string) || undefined
        }));

        const globalLayout = computeRadialLayout(allNodesForLayout, allEdgesForLayout, 0, 0);
        
        // Use the global layout for everyone (updating existing and new)
        newLayout = globalLayout;
    } else {
                if (affectedNodes.length === 0) {
                    newLayout = {};
                } else if (anchorNodeId) {
                    const localLayout = computeAutoLayout(affectedNodes, affectedEdges, spec.direction);
                    const anchorLayout = layoutByNodeId[anchorNodeId];
                    const localAnchorLayout = localLayout[anchorNodeId];
            // Preserve spatial continuity by pinning one existing node and
            // translating the newly computed component around it.
                    const offsetX = anchorLayout.x - localAnchorLayout.x;
                    const offsetY = anchorLayout.y - localAnchorLayout.y;

                    newLayout = {};
                    for (const [nodeId, layout] of Object.entries(localLayout)) {
                        newLayout[nodeId] = {
                            ...layout,
                            x: layout.x + offsetX,
                            y: layout.y + offsetY,
                        };
                    }
                } else {
                    newLayout = computeAutoLayout(affectedNodes, affectedEdges, spec.direction, anchorX, anchorY);
                }
    }

    // Step 5: Add new nodes and update positions
    for (const nodeSpec of (spec.nodes || [])) {
        if (!nodes[nodeSpec.entity]) {
            nodes[nodeSpec.entity] = buildGraphNode(nodeSpec);
        }
    }

    // Update ALL layout positions if we did a global re-layout, or just new ones if partial
    for (const [entityId, layout] of Object.entries(newLayout)) {
        layoutByNodeId[entityId] = layout;
    }

    // Step 6: Add/update relationships
    Object.assign(relationships, buildRelationshipRecord(spec.edges || [], layoutByNodeId, nextNodeIds));

    return {
        schemaVersion: 1,
        type: "graph-canvas",
        graph: { nodes, relationships },
        layout: { layoutByNodeId },
        meta: {
            createdAt: existing.meta?.createdAt,
            updatedAt: timestamp,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildGraphNode(spec: NodeSpec) {
    const baseAttrs = (spec as any).attrs || {};
    const attrs = mergeMemoAttrs(baseAttrs, spec);
    return {
        id: spec.entity,
        type: "card" as const,
        name: spec.name || spec.entity,
        attrs,
    };
}

function buildRelationshipRecord(
    edges: EdgeSpec[],
    layoutByNodeId: Record<string, NodeLayout>,
    nodeIds: ReadonlySet<string>,
): GraphCanvasDTO["graph"]["relationships"] {
    const relationships: GraphCanvasDTO["graph"]["relationships"] = {};
    for (const edge of edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new Error(`Edge references unknown node alias: ${edge.from} -> ${edge.to}`);
        }
        const relId = generateRelationshipId(edge.from, edge.to);
        const { fromPort, toPort } = getPortId(edge.from, edge.to, layoutByNodeId);

        relationships[relId] = {
            id: relId,
            from: { nodeId: edge.from, portId: fromPort },
            to: { nodeId: edge.to, portId: toPort },
            attrs: edge.label ? { label: edge.label } : undefined,
        };
    }
    return relationships;
}
