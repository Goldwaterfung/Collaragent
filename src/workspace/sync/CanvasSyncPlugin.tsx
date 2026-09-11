import { useCallback, useEffect } from 'react'
import { useCanvas } from '@workspace/canvas/store'
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext'
import { CanvasHydrationError, deserializeCanvas } from '@workspace/persistence/canvasSerialization'
import type { NodeId } from '@workspace/canvas/domain'
import type { NodeLayout } from '@workspace/canvas/types'
import { useSyncSession } from '@workspace/hooks/useSyncSession'
import type { CanvasCommand } from '@workspace/canvas/commands/types'
import type { CanvasCommand as SharedCanvasCommand } from '@shared/commands'
import { COLLAR_CHECKPOINT_RESTORED_EVENT } from '@shared/checkpoints/events'

export default function CanvasWebSocketSyncPlugin() {
  const { dispatch, subscribe } = useCanvas()
  const { instanceId, wsPort } = useInstanceContext()

  const handleSnapshot = useCallback(
    (msg: unknown) => {
      // Convert DTO format to Domain Graph format
      const snapshotRecord = (msg && typeof msg === 'object' ? msg : {}) as Record<string, unknown>
      const dto = {
        schemaVersion: 1 as const,
        type: 'graph-canvas' as const,
        graph: snapshotRecord.graph,
        layout: { layoutByNodeId: snapshotRecord.layout },
        meta: {}
      }
      try {
        const { graph, layoutByNodeId } = deserializeCanvas(dto, { graphId: `graph-${instanceId}` })
        dispatch({
          type: 'HYDRATE_CANVAS',
          payload: {
            graph,
            layoutByNodeId: layoutByNodeId as unknown as Record<NodeId, NodeLayout>
          }
        })
      } catch (error) {
        if (error instanceof CanvasHydrationError) {
          console.error('[CanvasSyncPlugin] Canvas hydration validation failed', {
            instanceId,
            graphId: error.graphId,
            graphErrors: error.graphErrors
          })
        } else {
          console.error('[CanvasSyncPlugin] Unexpected canvas hydration error', {
            instanceId,
            error
          })
        }
        // Surface the hydrate failure to avoid silently rendering an empty graph.
        throw error
      }
    },
    [dispatch, instanceId]
  )

  const handleRemoteCommand = useCallback(
    (cmd: SharedCanvasCommand) => {
      // Map Shared Command -> Local Command
      const localCmd = mapSharedToLocal(cmd)
      if (localCmd) {
        dispatch({ type: 'COMMAND', payload: localCmd })
      }
    },
    [dispatch]
  )

  const { client } = useSyncSession<SharedCanvasCommand, unknown, CanvasCommand>({
    instanceId,
    path: 'ws/canvas',
    host: wsPort ? `localhost:${wsPort}` : undefined,
    clientIdPrefix: 'ui-',
    onSnapshot: handleSnapshot,
    onRemoteCommand: handleRemoteCommand,
    subscribeToLocal: subscribe,
    mapLocalToShared
  })

  useEffect(() => {
    const handleCheckpointRestored = () => {
      client?.requestSync()
    }

    window.addEventListener(COLLAR_CHECKPOINT_RESTORED_EVENT, handleCheckpointRestored)
    return () => {
      window.removeEventListener(COLLAR_CHECKPOINT_RESTORED_EVENT, handleCheckpointRestored)
    }
  }, [client])

  return null
}

export { mapSharedToLocal, mapLocalToShared } from '@workspace/canvas/commands/commandMapping'
import { mapSharedToLocal, mapLocalToShared } from '@workspace/canvas/commands/commandMapping'
