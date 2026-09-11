import type { CanvasCommand } from './types'
import type { CanvasCommand as SharedCanvasCommand } from '@shared/commands'
import { createCardinalPorts } from '@workspace/canvas/domain/portUtils'
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants'
import { asNodeId, asRelationshipId, asPortId, type PortEntity } from '@workspace/canvas/domain'

/**
 * Maps an incoming or diffed SharedCanvasCommand (wire protocol) to a local CanvasCommand.
 */
export function mapSharedToLocal(cmd: SharedCanvasCommand): CanvasCommand | null {
  switch (cmd.type) {
    case 'graph:add_node':
      return {
        type: 'CreateNode',
        payload: {
          nodeId: asNodeId(cmd.nodeId),
          name: cmd.entity.name,
          x: cmd.position.x,
          y: cmd.position.y,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
          attrs: cmd.entity.attrs
        }
      }
    case 'graph:update_node':
      return {
        type: 'UpdateNode',
        payload: {
          nodeId: asNodeId(cmd.nodeId),
          patch: cmd.changes
        }
      }
    case 'graph:update_node_layout': {
      const { x, y, width, height } = cmd.layout
      if (width !== undefined && height !== undefined) {
        return {
          type: 'ResizeNode',
          payload: {
            nodeId: asNodeId(cmd.nodeId),
            x: x ?? 0,
            y: y ?? 0,
            width,
            height
          }
        }
      }
      if (x !== undefined && y !== undefined) {
        return {
          type: 'MoveNode',
          payload: { nodeId: asNodeId(cmd.nodeId), x, y }
        }
      }
      return null
    }
    case 'graph:add_relationship':
      return {
        type: 'AddRelationship',
        payload: {
          relationship: {
            id: asRelationshipId(cmd.relationship.id),
            from: {
              nodeId: asNodeId(cmd.relationship.from.nodeId),
              ...(cmd.relationship.from.portId
                ? { portId: asPortId(cmd.relationship.from.portId) }
                : {})
            },
            to: {
              nodeId: asNodeId(cmd.relationship.to.nodeId),
              ...(cmd.relationship.to.portId
                ? { portId: asPortId(cmd.relationship.to.portId) }
                : {})
            },
            attrs: cmd.relationship.attrs ?? {}
          }
        }
      }
    case 'graph:update_relationship':
      return {
        type: 'UpdateRelationship',
        payload: {
          relationshipId: asRelationshipId(cmd.relationshipId),
          patch: cmd.changes
        }
      }
    case 'graph:remove_node':
      return { type: 'DeleteNode', payload: { nodeId: asNodeId(cmd.nodeId) } }
    case 'graph:remove_relationship':
      return {
        type: 'DeleteRelationship',
        payload: { relationshipId: asRelationshipId(cmd.relationshipId) }
      }
    default:
      return null
  }
}

/**
 * Maps a local domain CanvasCommand to a wire SharedCanvasCommand.
 */
export function mapLocalToShared(cmd: CanvasCommand): SharedCanvasCommand | null {
  switch (cmd.type) {
    case 'CreateNode': {
      const { nodeId, x, y, name, attrs, width, height } = cmd.payload

      // Generate ports to satisfy Shared NodeEntity type
      const ports = createCardinalPorts(nodeId, width, height)
      const sharedPorts: Record<string, PortEntity> = {}
      for (const [pid, p] of Object.entries(ports)) {
        sharedPorts[pid] = {
          ...p,
          isConnected: p.isConnected ?? false
        }
      }

      return {
        type: 'graph:add_node',
        nodeId,
        entity: {
          id: nodeId,
          type: 'card',
          name: name || 'Node',
          attrs: attrs || {},
          ports: sharedPorts
        },
        position: { x, y }
      }
    }
    case 'MoveNode':
      return {
        type: 'graph:update_node_layout',
        nodeId: cmd.payload.nodeId,
        layout: { x: cmd.payload.x, y: cmd.payload.y }
      }
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
      }
    case 'UpdateNode':
      return {
        type: 'graph:update_node',
        nodeId: cmd.payload.nodeId,
        changes: cmd.payload.patch
      }
    case 'AddRelationship':
      return {
        type: 'graph:add_relationship',
        relationshipId: cmd.payload.relationship.id,
        relationship: cmd.payload.relationship
      }
    case 'UpdateRelationship':
      return {
        type: 'graph:update_relationship',
        relationshipId: cmd.payload.relationshipId,
        changes: cmd.payload.patch
      }
    case 'DeleteNode':
      return { type: 'graph:remove_node', nodeId: cmd.payload.nodeId }
    case 'DeleteRelationship':
      return { type: 'graph:remove_relationship', relationshipId: cmd.payload.relationshipId }

    default:
      return null
  }
}
