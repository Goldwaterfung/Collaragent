import React from 'react';
import type { Edge as EdgeType, NodeLayout } from '../types';
import type { NodeEntity, PortEntity, RelationshipAttributes } from '../domain/types';
import type { PortId } from '../domain/ids';
import { EdgePath } from './EdgePath';
import { Attribute } from './Attribute';
import { useCanvas } from '../store';
import { getBestDirection } from '../domain/portUtils';

interface EdgeProps {
  edge: EdgeType;
  sourceLayout: NodeLayout;
  targetLayout: NodeLayout;
  /** Source node entity containing ports */
  sourceNode?: NodeEntity;
  /** Target node entity containing ports */
  targetNode?: NodeEntity;
  /** Relationship attributes (label, etc.) */
  attrs?: RelationshipAttributes;
}

const getBezierPoint = (
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) => {
  const oneMinusT = 1 - t;
  const mt2 = oneMinusT * oneMinusT;
  const mt3 = mt2 * oneMinusT;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * oneMinusT * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * oneMinusT * t2 * p2.y + t3 * p3.y,
  };
};

/**
 * Determines the best port to use for a connection based on relative positions.
 * Uses a simple heuristic: choose the port that faces toward the other node.
 */
const selectBestPort = (
  ports: Record<PortId, PortEntity>,
  nodeLayout: NodeLayout,
  otherLayout: NodeLayout
): PortEntity | null => {
  const portList = Object.values(ports);
  if (portList.length === 0) return null;

  const direction = getBestDirection(nodeLayout, otherLayout);

  // To keep it robust and match exactly what it did before (finding by normal vector):
  const targetNormal = direction === 'east' ? { x: 1, y: 0 } :
    direction === 'west' ? { x: -1, y: 0 } :
      direction === 'south' ? { x: 0, y: 1 } :
        { x: 0, y: -1 };

  return portList.find((p) =>
    p.normalVector.x === targetNormal.x && p.normalVector.y === targetNormal.y
  ) ?? portList[0];
};

/**
 * Calculates the absolute position of a port given the node's layout.
 */
const getPortAbsolutePosition = (
  port: PortEntity,
  nodeLayout: NodeLayout
): { x: number; y: number } => {
  return {
    x: nodeLayout.x + port.relativePosition.x,
    y: nodeLayout.y + port.relativePosition.y,
  };
};

/**
 * Edge component renders a Bezier curve connection between two nodes.
 * 
 * When nodes have ports, the edge connects port-to-port using the port's
 * normalVector to determine the curve's "launch angle". This creates
 * smooth, non-overlapping connections that help solve the "hairball" problem.
 */
export const Edge: React.FC<EdgeProps> = ({
  edge,
  sourceLayout,
  targetLayout,
  sourceNode,
  targetNode,
  attrs,
}) => {
  const { state, dispatch, dispatchCommand } = useCanvas();
  const [isHovered, setIsHovered] = React.useState(false);

  const isSelected = state.ui.selection.relationshipIds.includes(edge.id);

  // Default positions (node centers/borders) as fallback
  let startX = sourceLayout.x + sourceLayout.width / 2;
  let startY = sourceLayout.y + sourceLayout.height / 2;
  let endX = targetLayout.x + targetLayout.width / 2;
  let endY = targetLayout.y + targetLayout.height / 2;

  // Normal vectors for Bezier control points (default: horizontal)
  let sourceNormal = { x: 1, y: 0 };
  let targetNormal = { x: -1, y: 0 };

  // If source node has ports, use the best one
  if (sourceNode?.ports && Object.keys(sourceNode.ports).length > 0) {
    const sourcePort = selectBestPort(sourceNode.ports, sourceLayout, targetLayout);
    if (sourcePort) {
      const pos = getPortAbsolutePosition(sourcePort, sourceLayout);
      startX = pos.x;
      startY = pos.y;
      sourceNormal = sourcePort.normalVector;
    }
  }

  // If target node has ports, use the best one
  if (targetNode?.ports && Object.keys(targetNode.ports).length > 0) {
    const targetPort = selectBestPort(targetNode.ports, targetLayout, sourceLayout);
    if (targetPort) {
      const pos = getPortAbsolutePosition(targetPort, targetLayout);
      endX = pos.x;
      endY = pos.y;
      targetNormal = targetPort.normalVector;
    }
  }

  // Calculate Bezier control points using normal vectors
  // The control point offset scales with distance for smoother curves
  const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
  const controlOffset = Math.min(dist * 0.4, 120);

  // Control points extend in the direction of the port's normal vector
  const cx1 = startX + sourceNormal.x * controlOffset;
  const cy1 = startY + sourceNormal.y * controlOffset;
  const cx2 = endX + targetNormal.x * controlOffset;
  const cy2 = endY + targetNormal.y * controlOffset;

  const path = `M ${startX} ${startY} C ${cx1} ${cy1} ${cx2} ${cy2} ${endX} ${endY}`;

  // Calculate midpoint for the label (t=0.5)
  const mid = getBezierPoint(
    0.5,
    { x: startX, y: startY },
    { x: cx1, y: cy1 },
    { x: cx2, y: cy2 },
    { x: endX, y: endY }
  );

  const handleEdgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({
      type: 'SELECT_RELATIONSHIP',
      payload: {
        id: edge.id,
        multi: e.shiftKey,
      },
    });
  };

  return (
    <g className="canvas-edge">
      <EdgePath
        path={path}
        markerEnd={isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)'}
        selected={isSelected}
        hovered={isHovered}
        onEdgeClick={handleEdgeClick}
        onEdgeMouseEnter={() => setIsHovered(true)}
        onEdgeMouseLeave={() => setIsHovered(false)}
      />
      <foreignObject
        x={mid.x - 70}
        y={mid.y - 18}
        width={140}
        height={36}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <Attribute
          value={attrs?.label || ''}
          edgeSelected={isSelected}
          edgeHovered={isHovered}
          onChange={(val) => {
            dispatchCommand({
              type: 'UpdateRelationship',
              payload: {
                relationshipId: edge.id,
                patch: { label: val },
              },
            });
          }}
        />
      </foreignObject>
    </g>
  );
};
