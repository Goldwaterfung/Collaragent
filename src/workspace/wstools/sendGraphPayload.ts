import type { GraphCanvasDTO } from "@workspace/persistence/graphCanvasDto";
import { connectToCanvas, type ConnectionOverrides } from "@workspace/sync/ClientConnection";
import { CanvasDiffEngine } from "@collaragent/runtime";

export type SendGraphPayloadOptions = {
    payload: GraphCanvasDTO;
} & ConnectionOverrides;

/**
 * Sends a graph canvas payload update to the server using granular diff sync.
 * @param options The payload and connection overrides.
 * @returns The instance ID and client ID.
 */
export async function sendGraphPayload({ payload, ...overrides }: SendGraphPayloadOptions) {
    const instanceId = overrides.instanceId || "default";
    const client = await connectToCanvas(instanceId, overrides);
    const clientId = client.getClientId();

    try {
        const currentSnapshot = client.getSnapshot();
        const commands = CanvasDiffEngine.computeDiff(currentSnapshot, {
            instanceId,
            direction: "LR",
            mode: "replace",
            nodes: Object.values(payload.graph?.nodes || {}).map((n: any) => ({
                entity: n.id,
                name: n.name,
                memo: n.attrs?.memo
            })),
            edges: Object.values(payload.graph?.relationships || {}).map((r: any) => ({
                from: r.from?.nodeId || r.from,
                to: r.to?.nodeId || r.to,
                label: r.attrs?.label
            }))
        });

        if (commands.length > 0) {
            await client.sendBatch(commands.map(cmd => ({ ...cmd, staged: false })));
        }
    } finally {
        client.disconnect();
    }

    return { instanceId, clientId };
}
