import { describe, it, expect, vi } from 'vitest'
import { CanvasDiffEngine } from '@collaragent/runtime/CanvasDiffEngine'
import { serializeCanvasSnapshot } from '@workspace/persistence/canvasSerialization'
import { mapSharedToLocal, mapLocalToShared } from '../commands/commandMapping'
import { asGraphId, asNodeId, createEmptyGraph } from '../domain'
import { applyCanvasCommand } from '../commands/applyCommand'
import type { CanvasHistorySnapshot, CanvasState } from '../types'
import type { CanvasCommand } from '../commands/types'

describe('Canvas Undo Synchronization & Diff Engine', () => {
  const createInitialState = (): CanvasState => {
    const node1Id = asNodeId('node-1')
    let state: CanvasState = {
      domain: {
        graph: createEmptyGraph(asGraphId('graph-test'))
      },
      layout: {
        layoutByNodeId: {}
      },
      ui: {
        viewport: { x: 0, y: 0, zoom: 1 },
        selection: { nodeIds: [], relationshipIds: [] },
        interaction: { connect: { status: 'idle' } },
        expandedNodeIds: {}
      },
      history: {
        undoStack: [],
        redoStack: [],
        maxSize: 100
      }
    }

    state = applyCanvasCommand(state, {
      type: 'CreateNode',
      payload: {
        nodeId: node1Id,
        name: 'Node 1',
        x: 100,
        y: 100,
        width: 300,
        height: 200
      }
    })

    return state
  }

  it('diffDtos detects layout dimension changes (width/height)', () => {
    const initial = createInitialState()
    const initialSnapshot: CanvasHistorySnapshot = {
      graph: initial.domain.graph,
      layoutByNodeId: initial.layout.layoutByNodeId
    }
    const initialDto = serializeCanvasSnapshot(initialSnapshot)

    // Resize node-1
    const resizedSnapshot: CanvasHistorySnapshot = {
      graph: initial.domain.graph,
      layoutByNodeId: {
        ...initial.layout.layoutByNodeId,
        [asNodeId('node-1')]: { x: 100, y: 100, width: 450, height: 350 }
      }
    }
    const resizedDto = serializeCanvasSnapshot(resizedSnapshot)

    // Diff from resized -> initial (as in an undo)
    const diffCommands = CanvasDiffEngine.diffDtos(resizedDto, initialDto)

    expect(diffCommands.length).toBe(1)
    expect(diffCommands[0].type).toBe('graph:update_node_layout')
    if (diffCommands[0].type === 'graph:update_node_layout') {
      expect(diffCommands[0].nodeId).toBe(asNodeId('node-1'))
      expect(diffCommands[0].layout.width).toBe(300)
      expect(diffCommands[0].layout.height).toBe(200)
    }
  })

  it('diffDtos generates remove_node command when undoing node creation', () => {
    const emptySnapshot: CanvasHistorySnapshot = {
      graph: createEmptyGraph(asGraphId('graph-test')),
      layoutByNodeId: {}
    }
    const emptyDto = serializeCanvasSnapshot(emptySnapshot)

    const stateWithNode = createInitialState()
    const nodeSnapshot: CanvasHistorySnapshot = {
      graph: stateWithNode.domain.graph,
      layoutByNodeId: stateWithNode.layout.layoutByNodeId
    }
    const nodeDto = serializeCanvasSnapshot(nodeSnapshot)

    // Undoing node creation: diff from nodeDto -> emptyDto
    const undoCommands = CanvasDiffEngine.diffDtos(nodeDto, emptyDto)

    expect(undoCommands.length).toBe(1)
    expect(undoCommands[0].type).toBe('graph:remove_node')
    if (undoCommands[0].type === 'graph:remove_node') {
      expect(undoCommands[0].nodeId).toBe(asNodeId('node-1'))
    }

    // Redoing node creation: diff from emptyDto -> nodeDto
    const redoCommands = CanvasDiffEngine.diffDtos(emptyDto, nodeDto)
    expect(redoCommands.length).toBe(1)
    expect(redoCommands[0].type).toBe('graph:add_node')
    if (redoCommands[0].type === 'graph:add_node') {
      expect(redoCommands[0].nodeId).toBe(asNodeId('node-1'))
    }
  })

  it('maps diffed SharedCanvasCommands to local CanvasCommands for subscriber notification', () => {
    const emptySnapshot: CanvasHistorySnapshot = {
      graph: createEmptyGraph(asGraphId('graph-test')),
      layoutByNodeId: {}
    }
    const emptyDto = serializeCanvasSnapshot(emptySnapshot)

    const stateWithNode = createInitialState()
    const nodeSnapshot: CanvasHistorySnapshot = {
      graph: stateWithNode.domain.graph,
      layoutByNodeId: stateWithNode.layout.layoutByNodeId
    }
    const nodeDto = serializeCanvasSnapshot(nodeSnapshot)

    // Undoing node creation: nodeDto -> emptyDto
    const undoShared = CanvasDiffEngine.diffDtos(nodeDto, emptyDto)
    const localCommands: CanvasCommand[] = []

    for (const sharedCmd of undoShared) {
      const localCmd = mapSharedToLocal(sharedCmd)
      if (localCmd) localCommands.push(localCmd)
    }

    expect(localCommands.length).toBe(1)
    expect(localCommands[0].type).toBe('DeleteNode')
    if (localCommands[0].type === 'DeleteNode') {
      expect(localCommands[0].payload.nodeId).toBe(asNodeId('node-1'))
    }

    // Roundtrip back to shared wire command
    const wireCmd = mapLocalToShared(localCommands[0])
    expect(wireCmd).not.toBeNull()
    expect(wireCmd?.type).toBe('graph:remove_node')
  })

  it('simulates the full undo/redo subscriber notification lifecycle', () => {
    const initial = createInitialState()
    const snapshotBeforeMove: CanvasHistorySnapshot = {
      graph: initial.domain.graph,
      layoutByNodeId: initial.layout.layoutByNodeId
    }

    // User moves node to (250, 400)
    const stateAfterMove = applyCanvasCommand(initial, {
      type: 'MoveNode',
      payload: { nodeId: asNodeId('node-1'), x: 250, y: 400 }
    })

    const snapshotAfterMove: CanvasHistorySnapshot = {
      graph: stateAfterMove.domain.graph,
      layoutByNodeId: stateAfterMove.layout.layoutByNodeId
    }

    const subscriberSpy = vi.fn<(cmd: CanvasCommand) => void>()

    // Simulate Undo:
    const currentDto = serializeCanvasSnapshot(snapshotAfterMove)
    const targetDto = serializeCanvasSnapshot(snapshotBeforeMove)
    const undoDiff = CanvasDiffEngine.diffDtos(currentDto, targetDto)

    for (const sharedCmd of undoDiff) {
      const localCmd = mapSharedToLocal(sharedCmd)
      if (localCmd) subscriberSpy(localCmd)
    }

    expect(subscriberSpy).toHaveBeenCalledTimes(1)
    const notifiedCmd = subscriberSpy.mock.calls[0][0]
    expect(notifiedCmd.type).toBe('MoveNode')
    if (notifiedCmd.type === 'MoveNode') {
      expect(notifiedCmd.payload.x).toBe(100)
      expect(notifiedCmd.payload.y).toBe(100)
    }

    // Simulate Redo:
    subscriberSpy.mockClear()
    const redoDiff = CanvasDiffEngine.diffDtos(targetDto, currentDto)
    for (const sharedCmd of redoDiff) {
      const localCmd = mapSharedToLocal(sharedCmd)
      if (localCmd) subscriberSpy(localCmd)
    }

    expect(subscriberSpy).toHaveBeenCalledTimes(1)
    const redoneCmd = subscriberSpy.mock.calls[0][0]
    expect(redoneCmd.type).toBe('MoveNode')
    if (redoneCmd.type === 'MoveNode') {
      expect(redoneCmd.payload.x).toBe(250)
      expect(redoneCmd.payload.y).toBe(400)
    }
  })
})
