import { useCallback } from 'react';
import { useCanvas } from '@workspace/canvas/store';
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext';
import { CanvasHydrationError, deserializeCanvas } from '@workspace/persistence/canvasSerialization';
import { createCardinalPorts } from '@workspace/canvas/domain/portUtils';
import { useSyncSession } from '@workspace/hooks/useSyncSession';
import type { CanvasCommand } from '@workspace/canvas/commands/types';
import type { CanvasCommand as SharedCanvasCommand } from '@shared/commands';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants';

export default function CanvasWebSocketSyncPlugin() {
    const { dispatch, subscribe } = useCanvas();
    const { instanceId, wsPort } = useInstanceContext();

    const handleSnapshot = useCallback((msg: any) => {
        // Convert DTO format to Domain Graph format
        const dto = {
            schemaVersion: 1 as const,
            type: 'graph-canvas' as const,
            graph: msg.graph as any,
            layout: { layoutByNodeId: msg.layout as any },
            meta: {}
        };
        try {
            const { graph, layoutByNodeId } = deserializeCanvas(dto, { graphId: `graph-${instanceId}` });
            dispatch({
                type: 'HYDRATE_CANVAS',
                payload: {
                    graph,
                    layoutByNodeId: layoutByNodeId as any
                }
            });
        } catch (error) {
            if (error instanceof CanvasHydrationError) {
                console.error('[CanvasSyncPlugin] Canvas hydration validation failed', {
                    instanceId,
                    graphId: error.graphId,
                    graphErrors: error.graphErrors,
                });
            } else {
                console.error('[CanvasSyncPlugin] Unexpected canvas hydration error', {
                    instanceId,
                    error,
                });
            }
            // Surface the hydrate failure to avoid silently rendering an empty graph.
            throw error;
        }
    }, [dispatch, instanceId]);

    const handleRemoteCommand = useCallback((cmd: SharedCanvasCommand) => {
        // Map Shared Command -> Local Command
        const localCmd = mapSharedToLocal(cmd);
        if (localCmd) {
            dispatch({ type: 'COMMAND', payload: localCmd });
        }
    }, [dispatch]);

    useSyncSession<SharedCanvasCommand, any, CanvasCommand>({
        instanceId,
        path: 'ws/canvas',
        host: wsPort ? `localhost:${wsPort}` : undefined,
        clientIdPrefix: 'ui-',
        onSnapshot: handleSnapshot,
        onRemoteCommand: handleRemoteCommand,
        subscribeToLocal: subscribe,
        mapLocalToShared
    });

    return null;
}

// --- Mappers ---

function mapSharedToLocal(cmd: SharedCanvasCommand): CanvasCommand | null {
    console.log('[WebSocketSyncPlugin] mapSharedToLocal', cmd.type, cmd);
    switch (cmd.type) {
        case 'graph:add_node':
            console.log('[WebSocketSyncPlugin] mapSharedToLocal graph:add_node', { nodeId: cmd.nodeId, name: cmd.entity.name });
            return {
                type: 'CreateNode',
                payload: {
                    nodeId: cmd.nodeId as any,
                    name: cmd.entity.name,
                    x: cmd.position.x,
                    y: cmd.position.y,
                    width: DEFAULT_NODE_WIDTH,
                    height: DEFAULT_NODE_HEIGHT,
                    attrs: cmd.entity.attrs
                }
            };
        case 'graph:update_node':
            return {
                type: 'UpdateNode',
                payload: {
                    nodeId: cmd.nodeId as any,
                    patch: cmd.changes as any
                }
            };
        case 'graph:update_node_layout':
            const { x, y, width, height } = cmd.layout;
            if (x !== undefined && y !== undefined && width === undefined && height === undefined) {
                return {
                    type: 'MoveNode',
                    payload: { nodeId: cmd.nodeId as any, x, y }
                };
            }
            if (width !== undefined && height !== undefined) {
                return {
                    type: 'ResizeNode',
                    payload: {
                        nodeId: cmd.nodeId as any,
                        x: x ?? 0,
                        y: y ?? 0,
                        width,
                        height
                    }
                };
            }
            return null;

        case 'graph:add_relationship':
            console.log('[WebSocketSyncPlugin] mapSharedToLocal graph:add_relationship', { id: cmd.relationshipId, from: cmd.relationship.from, to: cmd.relationship.to });
            return {
                type: 'AddRelationship',
                payload: { relationship: cmd.relationship as any }
            };
        case 'graph:update_relationship':
            return {
                type: 'UpdateRelationship',
                payload: {
                    relationshipId: cmd.relationshipId as any,
                    patch: cmd.changes as any
                }
            };
        case 'graph:remove_node':
            return { type: 'DeleteNode', payload: { nodeId: cmd.nodeId as any } };
        case 'graph:remove_relationship':
            return { type: 'DeleteRelationship', payload: { relationshipId: cmd.relationshipId as any } };
        default:
            return null;
    }
}

function mapLocalToShared(cmd: CanvasCommand): SharedCanvasCommand | null {
    console.log('[WebSocketSyncPlugin] mapLocalToShared', cmd.type, cmd);
    switch (cmd.type) {
        case 'CreateNode':
            const { nodeId, x, y, name, attrs, width, height } = cmd.payload;
            console.log('[WebSocketSyncPlugin] mapLocalToShared CreateNode', { nodeId, name });

            // Generate ports to satisfy Shared NodeEntity type
            const ports = createCardinalPorts(nodeId, width, height);
            const sharedPorts: Record<string, any> = {};
            for (const [pid, p] of Object.entries(ports)) {
                sharedPorts[pid] = {
                    ...p,
                    isConnected: p.isConnected ?? false
                };
            }

            return {
                type: 'graph:add_node',
                nodeId,
                entity: {
                    id: nodeId,
                    type: 'card',
                    name: name || 'Node',
                    attrs: attrs || {},
                    ports: sharedPorts as any
                },
                position: { x, y }
            };
        case 'MoveNode':
            return {
                type: 'graph:update_node_layout',
                nodeId: cmd.payload.nodeId,
                layout: { x: cmd.payload.x, y: cmd.payload.y }
            };
        case 'ResizeNode':
            return {
                type: 'graph:update_node_layout',
                nodeId: cmd.payload.nodeId,
                layout: {
                    x: cmd.payload.x,
                    y: cmd.payload.y,
                    width: cmd.payload.width,
                    height: cmd.payload.height
                }
            };
        case 'UpdateNode':
            return {
                type: 'graph:update_node',
                nodeId: cmd.payload.nodeId,
                changes: cmd.payload.patch as any
            };
        case 'AddRelationship':
            console.log('[WebSocketSyncPlugin] mapLocalToShared AddRelationship', { id: cmd.payload.relationship.id });
            return {
                type: 'graph:add_relationship',
                relationshipId: cmd.payload.relationship.id,
                relationship: cmd.payload.relationship as any
            };
        case 'UpdateRelationship':
            return {
                type: 'graph:update_relationship',
                relationshipId: cmd.payload.relationshipId,
                changes: cmd.payload.patch as any
            };
        case 'DeleteNode':
            return { type: 'graph:remove_node', nodeId: cmd.payload.nodeId };
        case 'DeleteRelationship':
            return { type: 'graph:remove_relationship', relationshipId: cmd.payload.relationshipId };

        default:
            return null;
    }
}
