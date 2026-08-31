import { Graph, NodeId, RelationshipId } from './domain'
import { CanvasSnapshot, NodeLayout } from './domain/types'
import type { CanvasCommand } from './commands/types'

export type { NodeLayout, CanvasSnapshot }

export interface Point {
  x: number
  y: number
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface UiSelectionState {
  nodeIds: NodeId[]
  relationshipIds: RelationshipId[]
}

export interface ConnectSessionState {
  status: 'idle' | 'connecting'
  fromNodeId?: NodeId
  start?: Point
  current?: Point
}

export interface Node {
  id: string
  x: number
  y: number
  width: number
  height: number
  type: 'card'
  content?: any
  selected?: boolean
}

export interface Edge {
  id: RelationshipId
  source: NodeId
  target: NodeId
  sourceHandle?: string
  targetHandle?: string
}

/**
 * Phase 3: Explicit state boundaries.
 * - Domain: graph structure + semantic data (no viewport, no layout coordinates)
 * - Layout: geometry keyed by node id (per-user / non-domain)
 * - UI: viewport + selection + interaction sessions (Phase 4)
 */
export interface CanvasDomainState {
  graph: Graph
}

export interface CanvasLayoutState {
  layoutByNodeId: Record<NodeId, NodeLayout>
}

export interface CanvasUiState {
  viewport: ViewportState
  selection: UiSelectionState
  interaction: {
    connect: ConnectSessionState
  }
}

export type CanvasHistorySnapshot = CanvasSnapshot

export interface CanvasHistoryState {
  undoStack: CanvasHistorySnapshot[]
  redoStack: CanvasHistorySnapshot[]
  maxSize: number
  lastMerge?: {
    at: number
    commandType: 'MoveNode' | 'ResizeNode'
    nodeIdsKey: string
  }
}

export interface CanvasState {
  domain: CanvasDomainState
  layout: CanvasLayoutState
  ui: CanvasUiState
  history: CanvasHistoryState
}

export type CanvasAction =
  | { type: 'PAN'; payload: Point }
  | { type: 'ZOOM'; payload: { factor: number; center: Point } }
  | { type: 'SET_VIEWPORT'; payload: ViewportState }
  | {
      type: 'HYDRATE_CANVAS'
      payload: { graph: Graph; layoutByNodeId: Record<NodeId, NodeLayout> }
    }
  | { type: 'SELECT_NODE'; payload: { id: NodeId; multi: boolean } }
  | { type: 'SELECT_RELATIONSHIP'; payload: { id: RelationshipId; multi: boolean } }
  | { type: 'SET_SELECTION'; payload: { nodeIds: NodeId[]; relationshipIds?: RelationshipId[] } }
  | { type: 'DESELECT_ALL' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COMMAND'; payload: CanvasCommand }
  | { type: 'COMMANDS'; payload: CanvasCommand[] }
