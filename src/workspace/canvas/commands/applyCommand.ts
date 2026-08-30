import type { CanvasState } from '../types';
import type { CanvasCommand } from './types';
import { addNode, addRelationship, removeNode, removeRelationship, updateNode, updateRelationship } from '../domain/operations';
import { createCardinalPorts, updatePortPositions } from '../domain/portUtils';
import { deserializeCanvas } from '@workspace/persistence/canvasSerialization';

const assertNever = (value: never): never => value;

export const applyCanvasCommand = (state: CanvasState, command: CanvasCommand): CanvasState => {
  switch (command.type) {
    case 'CreateNode': {
      const { nodeId, name, x, y, width, height, attrs } = command.payload;

      // Generate 4 cardinal ports (N, E, S, W) for the new node
      const ports = createCardinalPorts(nodeId, width, height);

      const nextGraphRes = addNode(state.domain.graph, {
        id: nodeId,
        type: 'card',
        name: name ?? `Node ${String(nodeId).split('-').pop() ?? ''}`.trim(),
        attrs: attrs ?? {},
        ports,
      });

      if (!nextGraphRes.ok) return state;

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: nextGraphRes.value,
        },
        layout: {
          ...state.layout,
          layoutByNodeId: {
            ...state.layout.layoutByNodeId,
            [nodeId]: { x, y, width, height },
          },
        },
      };
    }

    case 'MoveNode': {
      const { nodeId, x, y } = command.payload;
      const prev = state.layout.layoutByNodeId[nodeId];
      if (!prev) return state;

      return {
        ...state,
        layout: {
          ...state.layout,
          layoutByNodeId: {
            ...state.layout.layoutByNodeId,
            [nodeId]: {
              ...prev,
              x,
              y,
            },
          },
        },
      };
    }

    case 'ResizeNode': {
      const { nodeId, x, y, width, height } = command.payload;
      const prev = state.layout.layoutByNodeId[nodeId];
      if (!prev) return state;

      // Get the existing node to update port positions
      const node = state.domain.graph.nodesById[nodeId];
      const updatedPorts = node ? updatePortPositions(node.ports, width, height) : {};

      // Update node with recalculated port positions
      const updatedNode = node ? { ...node, ports: updatedPorts } : undefined;

      return {
        ...state,
        domain: updatedNode ? {
          ...state.domain,
          graph: {
            ...state.domain.graph,
            nodesById: {
              ...state.domain.graph.nodesById,
              [nodeId]: updatedNode,
            },
          },
        } : state.domain,
        layout: {
          ...state.layout,
          layoutByNodeId: {
            ...state.layout.layoutByNodeId,
            [nodeId]: {
              ...prev,
              x,
              y,
              width,
              height,
            },
          },
        },
      };
    }

    case 'StartConnect': {
      const { fromNodeId, start } = command.payload;
      return {
        ...state,
        ui: {
          ...state.ui,
          interaction: {
            ...state.ui.interaction,
            connect: {
              status: 'connecting',
              fromNodeId,
              start,
              current: start,
            },
          },
        },
      };
    }

    case 'UpdateConnectCursor': {
      const { point } = command.payload;
      const connect = state.ui.interaction.connect;
      if (connect.status !== 'connecting') return state;

      return {
        ...state,
        ui: {
          ...state.ui,
          interaction: {
            ...state.ui.interaction,
            connect: {
              ...connect,
              current: point,
            },
          },
        },
      };
    }

    case 'CancelConnect': {
      return {
        ...state,
        ui: {
          ...state.ui,
          interaction: {
            ...state.ui.interaction,
            connect: { status: 'idle' },
          },
        },
      };
    }

    case 'CommitConnect': {
      const connect = state.ui.interaction.connect;
      if (connect.status !== 'connecting' || !connect.fromNodeId) {
        return state;
      }

      const { relationshipId, toNodeId } = command.payload;
      if (connect.fromNodeId === toNodeId) {
        return {
          ...state,
          ui: {
            ...state.ui,
            selection: {
              ...state.ui.selection,
              nodeIds: [toNodeId],
            },
            interaction: {
              ...state.ui.interaction,
              connect: { status: 'idle' },
            },
          },
        };
      }

      const nextGraphRes = addRelationship(state.domain.graph, {
        id: relationshipId,
        from: { nodeId: connect.fromNodeId },
        to: { nodeId: toNodeId },
        attrs: {},
      });

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: nextGraphRes.ok ? nextGraphRes.value : state.domain.graph,
        },
        ui: {
          ...state.ui,
          interaction: {
            ...state.ui.interaction,
            connect: { status: 'idle' },
          },
        },
      };
    }

    case 'DeleteNode': {
      const { nodeId } = command.payload;

      // Remove the node (domain operation handles cascading relationship removal)
      const res = removeNode(state.domain.graph, nodeId);
      if (!res.ok) return state;

      // Remove layout entry
      const nextLayoutByNodeId = { ...state.layout.layoutByNodeId };
      delete nextLayoutByNodeId[nodeId];

      // Remove from selection if selected
      const nextNodeIds = state.ui.selection.nodeIds.filter((id) => id !== nodeId);

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: res.value,
        },
        layout: {
          ...state.layout,
          layoutByNodeId: nextLayoutByNodeId,
        },
        ui: {
          ...state.ui,
          selection: {
            ...state.ui.selection,
            nodeIds: nextNodeIds,
          },
        },
      };
    }

    case 'DeleteRelationship': {
      const { relationshipId } = command.payload;

      // Remove the relationship
      const res = removeRelationship(state.domain.graph, relationshipId);
      if (!res.ok) return state;

      // Remove from selection if selected
      const nextRelationshipIds = state.ui.selection.relationshipIds.filter(
        (id) => id !== relationshipId
      );

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: res.value,
        },
        ui: {
          ...state.ui,
          selection: {
            ...state.ui.selection,
            relationshipIds: nextRelationshipIds,
          },
        },
      };
    }

    case 'UpdateNode': {
      const { nodeId, patch } = command.payload;
      const res = updateNode(state.domain.graph, nodeId, patch);
      if (!res.ok) return state;

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: res.value,
        },
      };
    }

    case 'UpdateRelationship': {
      const { relationshipId, patch } = command.payload;
      const res = updateRelationship(state.domain.graph, relationshipId, patch);
      if (!res.ok) return state;

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: res.value,
        },
      };
    }

    case 'AddRelationship': {
      const { relationship } = command.payload;
      const res = addRelationship(state.domain.graph, relationship);
      if (!res.ok) return state;

      return {
        ...state,
        domain: {
          ...state.domain,
          graph: res.value,
        },
      };
    }

    case 'ReplaceGraph': {
      const { graph, layoutByNodeId } = deserializeCanvas(command.payload.dto, {
        graphId: command.payload.graphId,
      });

      return {
        ...state,
        domain: {
          ...state.domain,
          graph,
        },
        layout: {
          ...state.layout,
          layoutByNodeId: layoutByNodeId as any,
        },
        ui: {
          ...state.ui,
          selection: {
            nodeIds: [],
            relationshipIds: [],
          },
          interaction: {
            ...state.ui.interaction,
            connect: { status: 'idle' },
          },
        },
      };
    }

    default: {
      // Exhaustiveness guard
      assertNever(command);
      return state;
    }
  }
};
