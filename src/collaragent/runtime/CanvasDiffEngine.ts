import { 
    CanvasSnapshot
} from "@workspace/canvas/domain/types";
import { 
    CanvasCommand
} from "@shared/commands";
import { createCardinalPorts } from "@workspace/canvas/domain/portUtils";
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@shared/constants";
import { WriteGraphSpec, applyGraphSpec } from "@workspace/wstools/graphSchemaConverter";
import { GraphCanvasDTO } from "@workspace/persistence/graphCanvasDto";
export class CanvasDiffEngine {
    
    /**
     * Computes the list of commands needed to transition from `currentGraph` to the state described by `spec`.
     */
    static computeDiff(snapshot: CanvasSnapshot | null | undefined, spec: WriteGraphSpec): CanvasCommand[] {
        const commands: CanvasCommand[] = [];

        // 1. Convert Current Domain Graph -> DTO (for the legacy converter to work)
        const currentDto = this.domainToDto(snapshot);
        const currentLayoutByNodeId = currentDto?.layout?.layoutByNodeId ?? {};

        // 2. Calculate Projected DTO using existing logic
        // This handles layout, auto-positioning, and merge/replace logic
        const projectedDto = applyGraphSpec(currentDto, spec);

        // 3. Diff DTOs (Projected vs Current) to generate Atomic Commands
        
        // --- RELATIONSHIPS ---
        const currentRels = currentDto ? currentDto.graph.relationships : {};
        const projectedRels = projectedDto.graph.relationships;

        // A. Remove Relationships first, before node removals.
        for (const relId of Object.keys(currentRels)) {
            if (!projectedRels[relId]) {
                commands.push({
                    type: 'graph:remove_relationship',
                    relationshipId: relId as any
                });
            }
        }

        // --- NODES ---
        const currentNodes = currentDto ? currentDto.graph.nodes : {};
        const projectedNodes = projectedDto.graph.nodes;

        // B. Remove Nodes
        for (const nodeId of Object.keys(currentNodes)) {
            if (!projectedNodes[nodeId]) {
                 commands.push({
                    type: 'graph:remove_node',
                    nodeId: nodeId as any
                 });
            }
        }

        // B. Add/Update Nodes
        for (const nodeId of Object.keys(projectedNodes)) {
            const projNode = projectedNodes[nodeId];
            const currNode = currentNodes[nodeId];
            const layout = projectedDto.layout.layoutByNodeId[nodeId];

            if (!currNode) {
                // ADD
                commands.push({
                    type: 'graph:add_node',
                    nodeId: nodeId as any,
                    entity: {
                        id: nodeId as any,
                        type: 'card', 
                        name: projNode.name,
                        attrs: projNode.attrs || {},
                        ports: createCardinalPorts(
                            nodeId as any,
                            layout?.width ?? DEFAULT_NODE_WIDTH,
                            layout?.height ?? DEFAULT_NODE_HEIGHT
                        ),
                    },
                    position: {
                        x: layout?.x ?? 0,
                        y: layout?.y ?? 0
                    }
                });
            } else {
                // UPDATE (Check name and attrs)
                const attrsChanged = JSON.stringify(currNode.attrs || {}) !== JSON.stringify(projNode.attrs || {});
                if (currNode.name !== projNode.name || attrsChanged) {
                    commands.push({
                        type: 'graph:update_node',
                        nodeId: nodeId as any,
                        changes: {
                            name: projNode.name,
                            attrs: projNode.attrs || {}
                        }
                    });
                }
                // Check layout update (Movement)
                if (layout && currNode) {
                    const currLayout = currentLayoutByNodeId[nodeId];
                    if (!currLayout || currLayout.x !== layout.x || currLayout.y !== layout.y) {
                        commands.push({
                            type: 'graph:update_node_layout',
                            nodeId: nodeId as any,
                            layout: {
                                x: layout.x,
                                y: layout.y
                            }
                        });
                    }
                }
            }
        }

        // C. Add Relationships
        for (const relId of Object.keys(projectedRels)) {
            if (!currentRels[relId]) {
                 const rel = projectedRels[relId];
                 commands.push({
                    type: 'graph:add_relationship',
                    relationshipId: relId as any,
                    relationship: {
                        id: relId as any,
                        from: { nodeId: rel.from.nodeId as any, portId: rel.from.portId as any },
                        to: { nodeId: rel.to.nodeId as any, portId: rel.to.portId as any },
                        attrs: rel.attrs || {}
                    }
                 });
            }
        }

        return commands;
    }

    private static domainToDto(snapshot: CanvasSnapshot | null | undefined): GraphCanvasDTO | null {
        if (!snapshot || !snapshot.graph) return null;
        const graph = (snapshot as any).graph;
        const sourceLayout = (snapshot as any).layoutByNodeId || (snapshot as any).layout || {};
        
        // Convert Domain Graph back to DTO structure for the Converter
        // This is a lossy conversion if Domain has more data than DTO, but mostly it matches.
        
        const nodes: Record<string, any> = {};
        // Handle both DTO structure (.nodes) and Domain structure (.nodesById)
        const sourceNodes = (graph as any).nodes || graph.nodesById || {};
        
        for (const [id, node] of Object.entries(sourceNodes) as any[]) {
            nodes[id] = {
                id: node.id,
                type: node.type,
                name: node.name,
                attrs: node.attrs || {},
            };
        }

        const relationships: Record<string, any> = {};
        const sourceRels = (graph as any).relationships || graph.relationshipsById || {};

        for (const [id, rel] of Object.entries(sourceRels) as any[]) {
             relationships[id] = {
                id: rel.id,
                from: rel.from,
                to: rel.to,
                attrs: rel.attrs
             };
        }
        
        // Map layout
        const layoutByNodeId: Record<string, any> = {};
        if (sourceLayout) {
             for (const [id, l] of Object.entries(sourceLayout) as [string, any][]) {
                 layoutByNodeId[id] = {
                     x: l.x,
                     y: l.y,
                     width: l.width,
                     height: l.height
                 };
             }
        }
        
        // Note: graphSchemaConverter assumes layoutByNodeId is populated for merge logic.
        
        return {
            schemaVersion: 1,
            type: 'graph-canvas',
            graph: { nodes, relationships },
            layout: { layoutByNodeId },
            meta: {}
        };
    }
}
