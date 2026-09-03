import { describe, it, expect } from 'vitest'
import { applyCanvasCommand } from '../commands/applyCommand'
import { asGraphId, asNodeId, createEmptyGraph } from '../domain'
import type { CanvasState } from '../types'
import type { CanvasCommand } from '../commands/types'

describe('Canvas Multi-Node Movement & Commands', () => {
  const createInitialTestState = (): CanvasState => {
    const node1Id = asNodeId('node-1')
    const node2Id = asNodeId('node-2')

    let state: CanvasState = {
      domain: {
        graph: createEmptyGraph(asGraphId('graph-test'))
      },
      layout: {
        layoutByNodeId: {}
      },
      ui: {
        viewport: { x: 0, y: 0, zoom: 1 },
        selection: {
          nodeIds: [node1Id, node2Id],
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

    // Create 2 nodes
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

    state = applyCanvasCommand(state, {
      type: 'CreateNode',
      payload: {
        nodeId: node2Id,
        name: 'Node 2',
        x: 500,
        y: 200,
        width: 300,
        height: 200
      }
    })

    return state
  }

  it('translates multiple nodes when batch MoveNode commands are executed', () => {
    let state = createInitialTestState()
    const node1Id = asNodeId('node-1')
    const node2Id = asNodeId('node-2')

    const dx = 50
    const dy = -30

    const moveCommands: CanvasCommand[] = [
      {
        type: 'MoveNode',
        payload: {
          nodeId: node1Id,
          x: state.layout.layoutByNodeId[node1Id].x + dx,
          y: state.layout.layoutByNodeId[node1Id].y + dy
        }
      },
      {
        type: 'MoveNode',
        payload: {
          nodeId: node2Id,
          x: state.layout.layoutByNodeId[node2Id].x + dx,
          y: state.layout.layoutByNodeId[node2Id].y + dy
        }
      }
    ]

    for (const cmd of moveCommands) {
      state = applyCanvasCommand(state, cmd)
    }

    expect(state.layout.layoutByNodeId[node1Id]).toEqual({
      x: 150,
      y: 70,
      width: 300,
      height: 200
    })
    expect(state.layout.layoutByNodeId[node2Id]).toEqual({
      x: 550,
      y: 170,
      width: 300,
      height: 200
    })
  })
})
