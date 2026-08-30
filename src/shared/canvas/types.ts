import { Graph, NodeId } from './entities';

export interface NodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A snapshot of the entire canvas state, including the graph structure
 * and the visual layout of nodes.
 */
export interface CanvasSnapshot {
  graph: Graph;
  layoutByNodeId: Record<NodeId, NodeLayout>;
}
