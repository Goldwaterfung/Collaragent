import { fileURLToPath } from "node:url";
import { DocumentPayload } from "@workspace/persistence/editorContent";
import {
  connectToEditor,
  type ConnectionOverrides,
} from "@workspace/sync/ClientConnection";

export type GetDocumentOptions = ConnectionOverrides;

/**
 * Gets the document payload from the server.
 */
export async function getDocumentPayload(overrides: GetDocumentOptions = {}) {
  const instanceId = overrides.instanceId || "default";
  
  const client = await connectToEditor(instanceId, overrides);
  const snapshot = client.getSnapshot();
  const clientId = client.getClientId();
  
  // Cleanup
  client.disconnect();

  if (!snapshot) {
    throw new Error(`Failed to retrieve snapshot for ${instanceId}`);
  }

  // Support both { blocks, comments } and { payload: { blocks, comments } }
  const payload = (snapshot.blocks ? snapshot : snapshot.payload) as DocumentPayload;
  
  return { payload, instanceId, clientId };
}

async function main() {
  const { payload } = await getDocumentPayload();
  
  // Enhance payload with block indices
  const indexedPayload = {
    ...payload,
    blocks: payload.blocks.map((block, index) => ({
      index,
      ...block,
    })),
  };
  
  console.log(JSON.stringify(indexedPayload, null, 2));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Failed to fetch document:", err);
    process.exitCode = 1;
  });
}
