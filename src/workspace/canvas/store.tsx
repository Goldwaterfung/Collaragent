import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type { CanvasAction, CanvasState, ViewportState } from './types'

import { applyCanvasCommand } from './commands/applyCommand'
import type { CanvasCommand } from './commands/types'
import type { CanvasCommand as SharedCanvasCommand } from '@shared/commands'
import { asGraphId, createEmptyGraph } from './domain'
import type { CanvasHistorySnapshot } from './types'
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext'
import { deserializeCanvas } from '@workspace/persistence/canvasSerialization'
import { instanceService } from '@shared/services/InstanceService'
import { canvasStateReducer } from './domain/canvasStateReducer'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'

// Helper type for what we expect from the service
type InstanceWithPayload = {
  instanceId: string // The service might return 'id' or 'instanceId' depending on schema
  id?: string
  payload: unknown
  metadata?: unknown
}

const initialViewport: ViewportState = {
  x: 0,
  y: 0,
  zoom: 1
}

/**
 * Builds an initial empty graph for new canvases.
 * Nodes are created with UUID node IDs; memo content is stored in node attrs.
 */
const buildInitialGraph = () => {
  return createEmptyGraph(asGraphId('graph-1'))
}

const initialState: CanvasState = {
  domain: {
    graph: buildInitialGraph()
  },
  layout: {
    layoutByNodeId: {}
  },
  ui: {
    viewport: initialViewport,
    selection: {
      nodeIds: [],
      relationshipIds: []
    },
    interaction: {
      connect: { status: 'idle' }
    },
    expandedNodeIds: {}
  },
  history: {
    undoStack: [],
    redoStack: [],
    maxSize: 100
  }
}

export const initialCanvasState = initialState

const snapshotOf = (state: CanvasState): CanvasHistorySnapshot => ({
  graph: state.domain.graph,
  layoutByNodeId: state.layout.layoutByNodeId
})

const restoreSnapshot = (state: CanvasState, snapshot: CanvasHistorySnapshot): CanvasState => {
  return {
    ...state,
    domain: {
      ...state.domain,
      graph: snapshot.graph
    },
    layout: {
      ...state.layout,
      layoutByNodeId: snapshot.layoutByNodeId
    },
    ui: {
      ...state.ui,
      selection: {
        nodeIds: [],
        relationshipIds: []
      },
      interaction: {
        ...state.ui.interaction,
        connect: { status: 'idle' }
      }
    }
  }
}

const isUndoableCommand = (command: CanvasCommand): boolean => {
  switch (command.type) {
    case 'CreateNode':
    case 'MoveNode':
    case 'ResizeNode':
    case 'CommitConnect':
    case 'DeleteNode':

    case 'DeleteRelationship':
    case 'UpdateNode':
    case 'UpdateRelationship':
    case 'AddRelationship':
    case 'ReplaceGraph':
      return true
    case 'StartConnect':
    case 'UpdateConnectCursor':
    case 'CancelConnect':
      return false
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}

const maybeMergeSnapshot = (
  state: CanvasState,
  commands: CanvasCommand[]
): { shouldPush: boolean; nextHistory: CanvasState['history'] } => {
  const now = Date.now()

  const isAllMove = commands.length > 0 && commands.every((c) => c.type === 'MoveNode')
  const isSingleResize = commands.length === 1 && commands[0].type === 'ResizeNode'

  if (!isAllMove && !isSingleResize) {
    return {
      shouldPush: true,
      nextHistory: {
        ...state.history,
        lastMerge: undefined
      }
    }
  }

  const commandType: 'MoveNode' | 'ResizeNode' = isAllMove ? 'MoveNode' : 'ResizeNode'
  const nodeIdsKey = isAllMove
    ? commands
        .map((c) => (c as Extract<CanvasCommand, { type: 'MoveNode' }>).payload.nodeId)
        .sort()
        .join(',')
    : (commands[0] as Extract<CanvasCommand, { type: 'ResizeNode' }>).payload.nodeId

  const last = state.history.lastMerge
  const withinWindow = last ? now - last.at <= 250 : false
  const sameStream =
    withinWindow && last?.commandType === commandType && last?.nodeIdsKey === nodeIdsKey

  return {
    // If it's part of the same move/resize stream, don't push another snapshot;
    // this makes one undo revert the whole drag/resize gesture.
    shouldPush: !sameStream,
    nextHistory: {
      ...state.history,
      lastMerge: {
        at: now,
        commandType,
        nodeIdsKey
      }
    }
  }
}

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'HYDRATE_CANVAS': {
      return {
        ...state,
        domain: {
          ...state.domain,
          graph: action.payload.graph
        },
        layout: {
          ...state.layout,
          layoutByNodeId: action.payload.layoutByNodeId
        },
        ui: {
          ...state.ui,
          selection: {
            nodeIds: [],
            relationshipIds: []
          },
          interaction: {
            ...state.ui.interaction,
            connect: { status: 'idle' }
          }
        },
        history: {
          ...state.history,
          undoStack: [],
          redoStack: [],
          lastMerge: undefined
        }
      }
    }

    case 'PAN':
      return {
        ...state,
        ui: {
          ...state.ui,
          viewport: {
            ...state.ui.viewport,
            x: state.ui.viewport.x + action.payload.x,
            y: state.ui.viewport.y + action.payload.y
          }
        }
      }

    case 'ZOOM': {
      const { factor, center } = action.payload
      const newZoom = Math.max(0.15, Math.min(3.0, state.ui.viewport.zoom * factor))

      const worldCenter = {
        x: (center.x - state.ui.viewport.x) / state.ui.viewport.zoom,
        y: (center.y - state.ui.viewport.y) / state.ui.viewport.zoom
      }

      const newX = center.x - worldCenter.x * newZoom
      const newY = center.y - worldCenter.y * newZoom

      return {
        ...state,
        ui: {
          ...state.ui,
          viewport: {
            x: newX,
            y: newY,
            zoom: newZoom
          }
        }
      }
    }

    case 'SET_VIEWPORT':
      return {
        ...state,
        ui: {
          ...state.ui,
          viewport: action.payload
        }
      }

    case 'SELECT_NODE': {
      const { id, multi } = action.payload
      const nodeIds = state.ui.selection.nodeIds

      if (multi) {
        return {
          ...state,
          ui: {
            ...state.ui,
            selection: {
              ...state.ui.selection,
              nodeIds: nodeIds.includes(id) ? nodeIds.filter((sid) => sid !== id) : [...nodeIds, id]
            }
          }
        }
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          selection: {
            nodeIds: [id],
            relationshipIds: []
          }
        }
      }
    }

    case 'SELECT_RELATIONSHIP': {
      const { id, multi } = action.payload
      const relationshipIds = state.ui.selection.relationshipIds

      if (multi) {
        return {
          ...state,
          ui: {
            ...state.ui,
            selection: {
              ...state.ui.selection,
              relationshipIds: relationshipIds.includes(id)
                ? relationshipIds.filter((rid) => rid !== id)
                : [...relationshipIds, id]
            }
          }
        }
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          selection: {
            nodeIds: [],
            relationshipIds: [id]
          }
        }
      }
    }

    case 'SET_SELECTION':
      return {
        ...state,
        ui: {
          ...state.ui,
          selection: {
            nodeIds: action.payload.nodeIds,
            relationshipIds: action.payload.relationshipIds ?? []
          }
        }
      }

    case 'DESELECT_ALL':
      return {
        ...state,
        ui: {
          ...state.ui,
          selection: {
            nodeIds: [],
            relationshipIds: []
          }
        }
      }

    case 'TOGGLE_EXPAND_NODE': {
      const { nodeId } = action.payload
      const current = !!state.ui.expandedNodeIds[nodeId]
      return {
        ...state,
        ui: {
          ...state.ui,
          expandedNodeIds: {
            ...state.ui.expandedNodeIds,
            [nodeId]: !current
          }
        }
      }
    }

    case 'SET_NODE_EXPANDED': {
      const { nodeId, expanded } = action.payload
      return {
        ...state,
        ui: {
          ...state.ui,
          expandedNodeIds: {
            ...state.ui.expandedNodeIds,
            [nodeId]: expanded
          }
        }
      }
    }

    case 'UNDO': {
      const undoStack = state.history.undoStack
      if (undoStack.length === 0) return state

      const previous = undoStack[undoStack.length - 1]
      const currentSnapshot = snapshotOf(state)

      const next = restoreSnapshot(state, previous)
      return {
        ...next,
        history: {
          ...state.history,
          undoStack: undoStack.slice(0, -1),
          redoStack: [...state.history.redoStack, currentSnapshot].slice(-state.history.maxSize),
          lastMerge: undefined
        }
      }
    }

    case 'REDO': {
      const redoStack = state.history.redoStack
      if (redoStack.length === 0) return state

      const nextSnap = redoStack[redoStack.length - 1]
      const currentSnapshot = snapshotOf(state)

      const next = restoreSnapshot(state, nextSnap)
      return {
        ...next,
        history: {
          ...state.history,
          undoStack: [...state.history.undoStack, currentSnapshot].slice(-state.history.maxSize),
          redoStack: redoStack.slice(0, -1),
          lastMerge: undefined
        }
      }
    }

    case 'COMMAND':
    case 'COMMANDS': {
      const commands = action.type === 'COMMAND' ? [action.payload] : action.payload

      const anyUndoable = commands.some(isUndoableCommand)
      const baseSnapshot = anyUndoable ? snapshotOf(state) : undefined

      let nextState = state
      for (const command of commands) {
        nextState = applyCanvasCommand(nextState, command)
      }

      if (!anyUndoable) return nextState

      // Merge successive MoveNode/ResizeNode to avoid filling the stack during drags.
      const mergeInfo = maybeMergeSnapshot(state, commands)

      if (!baseSnapshot) return nextState
      if (nextState === state) return state

      const nextUndoStack = mergeInfo.shouldPush
        ? [...state.history.undoStack, baseSnapshot].slice(-state.history.maxSize)
        : state.history.undoStack

      return {
        ...nextState,
        history: {
          ...mergeInfo.nextHistory,
          undoStack: nextUndoStack,
          redoStack: []
        }
      }
    }

    default:
      return state
  }
}

const CanvasContext = createContext<{
  state: CanvasState
  dispatch: React.Dispatch<CanvasAction>
  dispatchCommand: (command: CanvasCommand) => void
  dispatchTransaction: (commands: CanvasCommand[]) => void
  applyWorkspaceRestore: (snapshot: GraphCanvasDTO, commands: SharedCanvasCommand[]) => void
  subscribe: (callback: (command: CanvasCommand) => void) => () => void
} | null>(null)

export const CanvasProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(canvasReducer, initialState)
  const { instanceId } = useInstanceContext()

  const subscribersRef = useRef<Set<(cmd: CanvasCommand) => void>>(new Set())

  const subscribe = (callback: (cmd: CanvasCommand) => void) => {
    subscribersRef.current.add(callback)
    return () => {
      subscribersRef.current.delete(callback)
    }
  }

  const canvasInstanceId = useMemo(() => {
    const base = instanceId?.trim()
    // In the UUID-based system, if we're inside a CanvasProvider, it means
    // the Workspace already determined this instance is a canvas type.
    // We use the instanceId directly (it's a UUID, not prefixed).
    return base || ''
  }, [instanceId])

  const isHydratingRef = useRef(false)

  // Load canvas from persisted payload when switching instance ids.
  useEffect(() => {
    if (!canvasInstanceId) return

    let cancelled = false
    isHydratingRef.current = true

    ;(async () => {
      try {
        // Fetch instance data using the shared service
        // The service returns the instance summary + payload
        const data = (await instanceService.getById(
          canvasInstanceId
        )) as unknown as InstanceWithPayload

        if (cancelled) return
        if (!data) return // Should catch 404 in service usually

        // API returns 'content' field for instance data
        const content = (data as any).content ?? (data as any).payload
        if (!content || typeof content !== 'object') return
        if ((content as any).type !== 'graph-canvas') return

        const { graph, layoutByNodeId } = deserializeCanvas(content, {
          graphId: `graph-${canvasInstanceId}`
        })
        dispatch({
          type: 'HYDRATE_CANVAS',
          payload: {
            graph,
            layoutByNodeId: layoutByNodeId as any
          }
        })
      } catch (err) {
        console.error('Failed to hydrate canvas document:', err)
        const hydrateError = err instanceof Error ? err : new Error(String(err))
        // Do not silently swallow hydration failures; surface them to global handlers.
        queueMicrotask(() => {
          throw hydrateError
        })
      } finally {
        isHydratingRef.current = false
      }
    })()

    return () => {
      cancelled = true
      isHydratingRef.current = false
    }
  }, [canvasInstanceId])

  // Autosave is now handled by WebSocketSyncPlugin

  const dispatchCommand = useCallback(
    (command: CanvasCommand) => {
      dispatch({ type: 'COMMAND', payload: command })
      // Notify subscribers (e.g. SyncPlugin)
      subscribersRef.current.forEach((cb) => cb(command))
    },
    [dispatch]
  )

  const applyWorkspaceRestore = (snapshotDto: GraphCanvasDTO, commands: SharedCanvasCommand[]) => {
    const { graph, layoutByNodeId } = deserializeCanvas(snapshotDto, {
      graphId: `graph-${canvasInstanceId}`
    })
    let snapshot = { graph, layoutByNodeId }
    for (const command of commands) {
      snapshot = canvasStateReducer(snapshot, command)
    }

    dispatch({
      type: 'HYDRATE_CANVAS',
      payload: {
        graph: snapshot.graph,
        layoutByNodeId: snapshot.layoutByNodeId as any
      }
    })
  }

  const dispatchTransaction = useCallback(
    (commands: CanvasCommand[]) => {
      dispatch({ type: 'COMMANDS', payload: commands })
      // Notify subscribers for each command in the transaction
      subscribersRef.current.forEach((cb) => {
        commands.forEach((command) => cb(command))
      })
    },
    [dispatch]
  )

  return (
    <CanvasContext.Provider
      value={{
        state,
        dispatch,
        dispatchCommand,
        dispatchTransaction,
        applyWorkspaceRestore,
        subscribe
      }}
    >
      {children}
    </CanvasContext.Provider>
  )
}

export const useCanvas = (): {
  state: CanvasState
  dispatch: React.Dispatch<CanvasAction>
  dispatchCommand: (command: CanvasCommand) => void
  dispatchTransaction: (commands: CanvasCommand[]) => void
  applyWorkspaceRestore: (snapshot: GraphCanvasDTO, commands: SharedCanvasCommand[]) => void
  subscribe: (callback: (command: CanvasCommand) => void) => () => void
} => {
  const context = useContext(CanvasContext)
  if (!context) {
    throw new Error('useCanvas must be used within a CanvasProvider')
  }
  return context
}
