import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from "@shared/constants";
import { CanvasCommand } from "@shared/commands";
import { CanvasSnapshot, NodeLayout } from "./types";
import { addNode, removeNode, addRelationship, removeRelationship, updateNode } from "./operations";

/**
 * Reducer for Canvas state used by SyncClient to maintain a local copy of the graph.
 */
export function canvasStateReducer(state: CanvasSnapshot, command: CanvasCommand): CanvasSnapshot {
  let { graph, layoutByNodeId } = state;

  // Work with immutable domain operations. `graph` will be replaced when operations succeed.
  switch (command.type) {
    case 'graph:add_node': {
      const nodeId = command.nodeId;
      const res = addNode(graph, command.entity);
      if (res.ok) {
        graph = res.value;
        layoutByNodeId = {
          ...layoutByNodeId,
          [nodeId]: {
            x: command.position.x,
            y: command.position.y,
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
          },
        };
      }
      break;
    }
    case 'graph:update_node':
      {
        const res = updateNode(graph, command.nodeId, command.changes);
        if (res.ok) graph = res.value;
      }
      break;
    case 'graph:update_node_layout': {
      const nodeId = command.nodeId;
      if (layoutByNodeId[nodeId]) {
        Object.assign(layoutByNodeId[nodeId], command.layout);
      } else {
        layoutByNodeId[nodeId] = { 
          x: 0, 
          y: 0, 
          width: DEFAULT_NODE_WIDTH, 
          height: DEFAULT_NODE_HEIGHT, 
          ...command.layout 
        } as NodeLayout;
      }
      break;
    }
    case 'graph:remove_node': {
      const nodeId = command.nodeId;
      const res = removeNode(graph, nodeId);
      if (res.ok) {
        graph = res.value;
        const nextLayout = { ...layoutByNodeId };
        delete nextLayout[nodeId];
        layoutByNodeId = nextLayout;
      }
      break;
    }
    case 'graph:add_relationship':
      {
        const res = addRelationship(graph, command.relationship);
        if (res.ok) graph = res.value;
      }
      break;
    case 'graph:remove_relationship':
      {
        const res = removeRelationship(graph, command.relationshipId);
        if (res.ok) graph = res.value;
      }
      break;
  }

  return { graph, layoutByNodeId };
}
