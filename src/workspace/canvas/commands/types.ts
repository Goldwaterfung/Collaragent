import type {
  NodeId,
  RelationshipId,
  NodeEntity,
  RelationshipAttributes,
  RelationshipEntity
} from '@workspace/canvas/domain'
import type { Point } from '../types'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'

export type CanvasCommand =
  | {
      type: 'CreateNode'
      payload: {
        nodeId: NodeId
        name?: string
        x: number
        y: number
        width: number
        height: number
        attrs?: Record<string, unknown>
      }
    }
  | {
      type: 'MoveNode'
      payload: {
        nodeId: NodeId
        x: number
        y: number
      }
    }
  | {
      type: 'ResizeNode'
      payload: {
        nodeId: NodeId
        x: number
        y: number
        width: number
        height: number
        memoWidth?: number
      }
    }
  | {
      type: 'StartConnect'
      payload: {
        fromNodeId: NodeId
        start: Point
      }
    }
  | {
      type: 'UpdateConnectCursor'
      payload: {
        point: Point
      }
    }
  | {
      type: 'CancelConnect'
    }
  | {
      type: 'CommitConnect'
      payload: {
        relationshipId: RelationshipId
        toNodeId: NodeId
      }
    }
  | {
      type: 'DeleteNode'
      payload: { nodeId: NodeId }
    }
  | {
      type: 'DeleteRelationship'
      payload: { relationshipId: RelationshipId }
    }
  | {
      type: 'UpdateNode'
      payload: {
        nodeId: NodeId
        patch: Partial<Omit<NodeEntity, 'id'>>
      }
    }
  | {
      type: 'UpdateRelationship'
      payload: {
        relationshipId: RelationshipId
        patch: Partial<Omit<RelationshipAttributes, 'id'>>
      }
    }
  | {
      type: 'ReplaceGraph'
      payload: {
        dto: GraphCanvasDTO
        graphId?: string
      }
    }
  | {
      type: 'AddRelationship'
      payload: {
        relationship: RelationshipEntity
      }
    }
