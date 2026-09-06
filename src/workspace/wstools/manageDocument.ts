import { connectToEditor } from '@workspace/sync/ClientConnection'
import { DocumentDiffEngine } from '@collaragent/runtime'
import { DocumentPayload } from '@workspace/persistence/editorContent'
import { z } from 'zod'

/**
 * Schema for document writing specification.
 */
export const WriteDocumentSpecSchema = z.object({
  instanceId: z.string().describe('The ID of the document instance to write to.'),
  payload: z.any().describe('The target DocumentPayload structure.'),
  wsPort: z.number().optional().describe('Optional WebSocket port for connection.'),
  staged: z.boolean().optional().default(true).describe('Whether to stage the changes for review.'),
  threadId: z.string().optional().describe('The thread/session ID of the executing agent.')
})

export type WriteDocumentSpec = z.input<typeof WriteDocumentSpecSchema>

export const ExecuteDocumentCommandsSpecSchema = z.object({
  instanceId: z.string().describe('The ID of the document instance.'),
  commands: z.array(z.any()).describe('Array of EditorCommand to execute.'),
  wsPort: z.number().optional().describe('Optional WebSocket port for connection.'),
  staged: z.boolean().optional().default(true).describe('Whether to stage the changes for review.'),
  threadId: z.string().optional().describe('The thread/session ID of the executing agent.')
})

export type ExecuteDocumentCommandsSpec = z.input<typeof ExecuteDocumentCommandsSpecSchema>

/**
 * Reads the full document state from the server via SyncClient.
 */
export async function executeReadDocument(options: { instanceId: string; wsPort?: number }) {
  const client = await connectToEditor(options.instanceId, { port: options.wsPort })

  // SyncClient automatically populates snapshot on connect
  const snapshot = client.getSnapshot()

  client.disconnect()

  return snapshot
}

/**
 * Writes a document using a granular diff-based approach.
 *
 * Instead of overwriting the entire document (Snapshot-based), this tool
 * computes the difference between the server state and the target state,
 * then emits atomic 'editor:insert_block', 'editor:update_block', etc.
 * commands.
 *
 * This preserves authorship logs and supports surgical checkpoint restores.
 */
export async function executeWriteDocument(options: WriteDocumentSpec) {
  const validated = WriteDocumentSpecSchema.parse(options)
  const { instanceId, payload, wsPort, staged, threadId } = validated

  // 1. Connect to the Realtime System
  const client = await connectToEditor(instanceId, { port: wsPort })

  try {
    // 2. Observe Current State
    const current = client.getSnapshot() as DocumentPayload
    if (!current) {
      throw new Error(`Failed to retrieve document snapshot for instance: ${instanceId}`)
    }

    // 3. Compute Diff (Atomic Commands)
    const target = payload as DocumentPayload
    const commands = DocumentDiffEngine.computeDocumentDiff(current, target)

    // 4. Execute Commands with OCC
    const baseVersion = client.getServerVersion?.() ?? undefined
    if (commands.length > 0) {
      await client.sendBatch(
        commands.map((cmd) => ({ ...cmd, staged })),
        { threadId, baseVersion }
      )
    }

    return {
      instanceId,
      status: 'success',
      commandsEmitted: commands.length
    }
  } finally {
    // 5. Cleanup
    client.disconnect()
  }
}

/**
 * Directly executes pre-computed atomic commands on the server.
 * This prevents double-diffing architectures from accidentally
 * overwriting or removing blocks due to state divergence.
 */
export async function executeDocumentCommands(options: ExecuteDocumentCommandsSpec) {
  const validated = ExecuteDocumentCommandsSpecSchema.parse(options)
  const { instanceId, commands, wsPort, staged, threadId } = validated

  // 1. Connect to the Realtime System
  const client = await connectToEditor(instanceId, { port: wsPort })

  try {
    // 2. Execute Commands with OCC
    const baseVersion = client.getServerVersion?.() ?? undefined
    if (commands.length > 0) {
      await client.sendBatch(
        commands.map((cmd) => ({ ...cmd, staged })),
        { threadId, baseVersion }
      )
    }

    return {
      instanceId,
      status: 'success',
      commandsEmitted: commands.length
    }
  } finally {
    // 3. Cleanup
    client.disconnect()
  }
}
