import { NodeId, NodeEntity, RelationshipId, RelationshipEntity } from '@workspace/canvas/domain'
import { Block, Comment, DocumentPayload } from '@shared/schemas/instances'
import { RelationalLedgerEntry } from '@shared/wiki/types'

export type Command = CanvasCommand | EditorCommand | LedgerCommand

// --- Canvas Commands ---

export type CanvasCommand =
  | AddNodeCommand
  | UpdateNodeCommand
  | UpdateNodeLayoutCommand
  | RemoveNodeCommand
  | AddRelationshipCommand
  | UpdateRelationshipCommand
  | RemoveRelationshipCommand

export interface StagedCommand {
  staged?: boolean
  previousState?: unknown
}

export interface AddNodeCommand extends StagedCommand {
  type: 'graph:add_node'
  nodeId: NodeId
  entity: NodeEntity
  position: { x: number; y: number }
}

export interface UpdateNodeCommand extends StagedCommand {
  type: 'graph:update_node'
  nodeId: NodeId
  changes: Partial<Omit<NodeEntity, 'id'>>
}

export interface UpdateNodeLayoutCommand extends StagedCommand {
  type: 'graph:update_node_layout'
  nodeId: NodeId
  layout: {
    x?: number
    y?: number
    width?: number
    height?: number
  }
}

export interface RemoveNodeCommand extends StagedCommand {
  type: 'graph:remove_node'
  nodeId: NodeId
}

export interface AddRelationshipCommand extends StagedCommand {
  type: 'graph:add_relationship'
  relationshipId: RelationshipId
  relationship: RelationshipEntity
}

export interface UpdateRelationshipCommand extends StagedCommand {
  type: 'graph:update_relationship'
  relationshipId: RelationshipId
  changes: Partial<Omit<RelationshipEntity, 'id'>>
}

export interface RemoveRelationshipCommand extends StagedCommand {
  type: 'graph:remove_relationship'
  relationshipId: RelationshipId
}

// --- Editor Commands ---

export type EditorCommand =
  | UpdateBlockCommand
  | InsertBlockCommand
  | RemoveBlockCommand
  | UpdateCommentsCommand
  | ReplaceDocumentCommand

export interface UpdateBlockCommand extends StagedCommand {
  type: 'editor:update_block'
  blockId: string
  changes: Partial<Block>
}

export interface InsertBlockCommand extends StagedCommand {
  type: 'editor:insert_block'
  index: number
  block: Block
}

export interface RemoveBlockCommand extends StagedCommand {
  type: 'editor:remove_block'
  blockId: string
}

export interface UpdateCommentsCommand extends StagedCommand {
  type: 'editor:update_comments'
  comments: Record<string, Comment>
}

export interface ReplaceDocumentCommand extends StagedCommand {
  type: 'editor:replace_document'
  payload: DocumentPayload
}

// --- Ledger Commands ---

export type LedgerCommand =
  | UpsertLedgerEdgeCommand
  | RemoveLedgerEdgeCommand
  | DegradeLedgerEdgeCommand
  | RestoreLedgerEdgeCommand

export interface UpsertLedgerEdgeCommand extends StagedCommand {
  type: 'ledger:upsert_edge'
  entry: RelationalLedgerEntry
}

export interface RemoveLedgerEdgeCommand extends StagedCommand {
  type: 'ledger:remove_edge'
  edgeId: string
}

export interface DegradeLedgerEdgeCommand extends StagedCommand {
  type: 'ledger:degrade_edge'
  edgeId: string
  reason: 'anchor_lost'
}

export interface RestoreLedgerEdgeCommand extends StagedCommand {
  type: 'ledger:restore_edge'
  edgeId: string
  anchor: {
    blockId: string
    justification: string
    selectedTextSnippet?: string
  }
}
