import { connectToCanvas } from "@workspace/sync/ClientConnection";
import { CanvasDiffEngine } from "@collaragent/runtime";
import { createGraphPayload, generateNodeId, generateRelationshipId } from "./createGraphPayload";
import {
    assertUniqueNodeEntities,
    type NodeSpec,
    type EdgeSpec,
    type DeleteEdgeSpec,
    type WriteGraphSpec,
    WriteGraphSpecSchema,
} from "./graphSchemaConverter";
import { isCanonicalNodeId } from "@workspace/persistence/graphCanvasDto";

// ─────────────────────────────────────────────────────────────────────────────
// 1. readGraph
// ─────────────────────────────────────────────────────────────────────────────

export type ReadGraphOptions = {
    instanceId: string;
    wsPort?: number;
    includeMemo?: boolean;
};

/**
 * Reads the full graph state from the server via WebSocket.
 */
export async function executeReadGraph(options: ReadGraphOptions) {
    const targetId = options.instanceId?.trim() || '';
    
    // Connect as a client to get the snapshot
    const client = await connectToCanvas(targetId, { port: options.wsPort });
    
    // Get the derived state
    const snapshot = client.getSnapshot();

    const graph = (snapshot as any)?.graph || {};
    const nodeRecords = graph.nodesById || graph.nodes || {};
    const relationshipRecords = graph.relationshipsById || graph.relationships || {};

    const nodes = Object.values(nodeRecords as Record<string, any>).map((node: any) => {
        const hasMemo = !!(node?.attrs?.memo);
        const resultNode: any = {
            nodeId: node?.id,
            entity: node?.name,
            hasMemo
        };
        if (options.includeMemo && hasMemo) {
            resultNode.memo = node?.attrs?.memo;
        }
        return resultNode;
    });

    const nodeNameById = new Map<string, string>();
    for (const rawNode of Object.values(nodeRecords as Record<string, any>)) {
        const nodeId = typeof rawNode?.id === "string" ? rawNode.id : "";
        const nodeName = typeof rawNode?.name === "string" ? rawNode.name : "";
        if (nodeId && nodeName) {
            nodeNameById.set(nodeId, nodeName);
        }
    }

    const edges = Object.values(relationshipRecords as Record<string, any>).map((relationship: any) => ({
        from: nodeNameById.get(relationship?.from?.nodeId) || relationship?.from?.nodeId,
        to: nodeNameById.get(relationship?.to?.nodeId) || relationship?.to?.nodeId,
        label: relationship?.attrs?.label,
    }));
    
    // Clean up
    client.disconnect();
    
    return { 
        nodes,
        edges,
        instanceId: options.instanceId, 
        clientId: (client as any).clientId 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. writeGraph
// ─────────────────────────────────────────────────────────────────────────────

export type WriteGraphOptions = WriteGraphSpec & {
    wsPort?: number;
    apiPort?: number;
    staged?: boolean;
};

function resolveGraphSpecIdentity(
    spec: WriteGraphSpec,
    currentGraph: any,
): WriteGraphSpec {
    assertUniqueNodeEntities(spec.nodes || []);

    const nodesMap = currentGraph?.graph?.nodesById || currentGraph?.graph?.nodes || {};
    const currentNodes = Object.values(nodesMap) as any[];

    // 1. Build lookup tables for existing nodes
    const byNameEntries = currentNodes
        .map((n): [string | undefined, string] => [n.name?.trim().toLowerCase(), n.id as string])
        .filter((entry): entry is [string, string] => !!entry[0]);
    const byName = new Map<string, string>(byNameEntries);
    const byId = new Map(currentNodes.map(n => [n.id as string, n]));

    const aliasToNodeId = new Map<string, string>();
    const resolvedNodesById = new Map<string, NodeSpec>();
    const aliasByResolvedNodeId = new Map<string, string>();

    const normalizeNodeRef = (ref: string) => ref.trim().toLowerCase();

    for (const node of spec.nodes || []) {
        const alias = node.entity;

        // 2. Resolve identity: Name Match > ID Match > New UUID
        const resolvedNodeId: string =
            byName.get(alias.toLowerCase()) ||
            (isCanonicalNodeId(alias) && byId.has(alias) ? alias : undefined) ||
            generateNodeId();

        const existingAlias = aliasByResolvedNodeId.get(resolvedNodeId);
        if (existingAlias && existingAlias !== alias) {
            throw new Error(
                `Multiple node aliases resolved to the same node: ${existingAlias}, ${alias}`,
            );
        }

        aliasToNodeId.set(alias, resolvedNodeId);
        aliasByResolvedNodeId.set(resolvedNodeId, alias);
        resolvedNodesById.set(resolvedNodeId, {
            ...node,
            entity: resolvedNodeId,
            name: node.name || node.entity, // Preserve display name
        });
    }

    const resolveRef = (ref: string) =>
        aliasToNodeId.get(ref) ||
        byName.get(normalizeNodeRef(ref)) ||
        (byId.has(ref) ? ref : undefined);

    const resolvedStartFrom = spec.startFrom ? resolveRef(spec.startFrom) : undefined;
    const resolvedDeleteNodes = (spec.deleteNodes || [])
        .map(resolveRef)
        .filter((v): v is string => !!v);

    const resolvedEdges: EdgeSpec[] = [];
    for (const edge of spec.edges || []) {
        const from = resolveRef(edge.from);
        const to = resolveRef(edge.to);
        if (!from || !to) {
            throw new Error(`Unable to resolve edge endpoint(s): ${edge.from} -> ${edge.to}`);
        }
        resolvedEdges.push({ ...edge, from, to });
    }

    const resolvedDeleteEdges: DeleteEdgeSpec[] = [];
    for (const edge of spec.deleteEdges || []) {
        const from = resolveRef(edge.from);
        const to = resolveRef(edge.to);
        if (from && to) {
            resolvedDeleteEdges.push({ ...edge, from, to });
        }
    }

    return {
        ...spec,
        startFrom: resolvedStartFrom,
        nodes: Array.from(resolvedNodesById.values()),
        edges: resolvedEdges,
        deleteNodes: resolvedDeleteNodes,
        deleteEdges: resolvedDeleteEdges,
    };
}

/**
 * Writes a graph using a declarative specification.
 * 
 * In "replace" mode, the entire graph is overwritten with the new spec.
 * In "merge" mode, new nodes/edges are added to the existing graph,
 * optionally starting from a specified anchor node.
 * 
 * @param options The declarative graph specification
 * @returns The updated graph payload
 */
export async function executeWriteGraph(options: WriteGraphOptions) {
    const validatedSpec = WriteGraphSpecSchema.parse(options);
    const { instanceId } = validatedSpec;
    const targetId = instanceId?.trim() || '';

    // 1. Connect to the Realtim System
    const client = await connectToCanvas(targetId, { port: options.wsPort });
    
    // 2. Observe Current State & Provision New Instances
    // The client automatically syncs state on connect
    const currentGraph = client.getSnapshot();
    
    if (!currentGraph) {
        client.disconnect();
        throw new Error("Failed to retrieve graph snapshot");
    }

    // Removed auto document provisioning for canvas nodes.
    // They are now memo-backed directly in the graph serialization.

    const resolvedSpec = resolveGraphSpecIdentity(validatedSpec, currentGraph);

    // 3. Compute Diff (Atomic Commands)
    // We assume currentGraph is the source of truth
    const commands = CanvasDiffEngine.computeDiff(currentGraph, resolvedSpec);

    // 4. Execute Commands
    // Send them in batch sequentially and await acknowledgments
    const staged = options.staged ?? true;
    try {
        if (commands.length > 0) {
            await client.sendBatch(commands.map(cmd => ({ ...cmd, staged })));
        }
    } finally {
        // 5. Cleanup
        client.disconnect();
    }

    // 6. Return success
    return { 
        instanceId, 
        status: 'success' 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for MCP Server
// ─────────────────────────────────────────────────────────────────────────────

export { createGraphPayload, generateNodeId, generateRelationshipId };
export { WriteGraphSpecSchema } from "./graphSchemaConverter";
