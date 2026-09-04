import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import { connectToCanvas, type ConnectionOverrides } from '@workspace/sync/ClientConnection'
import { CanvasDiffEngine } from '@collaragent/runtime'

export type SendGraphPayloadOptions = {
  payload: GraphCanvasDTO
} & ConnectionOverrides

/**
 * Sends a graph canvas payload update to the server using granular diff sync.
 * @param options The payload and connection overrides.
 * @returns The instance ID and client ID.
 */
export async function sendGraphPayload({ payload, ...overrides }: SendGraphPayloadOptions) {
  const instanceId = overrides.instanceId || 'default'
  const client = await connectToCanvas(instanceId, overrides)
  const clientId = client.getClientId()

  try {
    const currentSnapshot = client.getSnapshot()
    const commands = CanvasDiffEngine.computeDiff(currentSnapshot, {
      instanceId,
      direction: 'LR',
      mode: 'replace',
      nodes: Object.values(payload.graph?.nodes || {}).map((n) => {
        const attrs = n.attrs as Record<string, unknown> | undefined
        const memo = typeof attrs?.memo === 'string' ? attrs.memo : undefined
        const group = typeof attrs?.clusterId === 'string' ? attrs.clusterId : undefined
        return {
          entity: n.id,
          name: n.name,
          memo,
          group,
          attrs
        }
      }),
      edges: Object.values(payload.graph?.relationships || {}).map((r) => ({
        from:
          typeof r.from === 'object' && r.from !== null && 'nodeId' in r.from
            ? r.from.nodeId
            : String(r.from),
        to:
          typeof r.to === 'object' && r.to !== null && 'nodeId' in r.to
            ? r.to.nodeId
            : String(r.to),
        label: typeof r.attrs?.label === 'string' ? r.attrs.label : undefined
      }))
    })

    if (commands.length > 0) {
      await client.sendBatch(commands.map((cmd) => ({ ...cmd, staged: false })))
    }
  } finally {
    client.disconnect()
  }

  return { instanceId, clientId }
}
