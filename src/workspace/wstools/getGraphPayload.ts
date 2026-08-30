import { GraphCanvasDTOSchema } from "@workspace/persistence/graphCanvasDto";
import { connectToCanvas, type ConnectionOverrides } from "@workspace/sync/ClientConnection";

export type GetGraphPayloadOptions = ConnectionOverrides & { type?: string };

/**
 * Fetches the graph payload from the server using the standardized SyncClient connection.
 * @param overrides Connection overrides (instanceId, host, port, type).
 * @returns The graph payload, instance ID, and client ID.
 * @throws If the instance is not a graph-canvas document or doesn't exist.
 */
export async function getGraphPayload(overrides: GetGraphPayloadOptions = {}) {
    const instanceId = overrides.instanceId || "default";
    const client = await connectToCanvas(instanceId, overrides);
    const clientId = client.getClientId();

    try {
        const snapshot = client.getSnapshot();
        if (!snapshot) {
            throw new Error(`Failed to retrieve graph snapshot for instance: ${instanceId}`);
        }

        const rawPayload = (snapshot as any)?.graph ? {
            type: "graph-canvas" as const,
            schemaVersion: 1 as const,
            graph: (snapshot as any).graph,
            layout: { layoutByNodeId: (snapshot as any).layout ?? {} }
        } : ((snapshot as any)?.payload ?? snapshot);

        const parsed = GraphCanvasDTOSchema.safeParse(rawPayload);
        if (!parsed.success) {
            throw new Error(`Instance '${instanceId}' is not a graph-canvas document or has invalid schema.`);
        }

        return { payload: parsed.data, instanceId, clientId };
    } finally {
        client.disconnect();
    }
}
