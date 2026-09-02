import { WebContents } from 'electron'
import { HumanMessage } from '@langchain/core/messages'
import * as Channels from '../../shared/ipc/agent/channels'
import * as Types from '../../shared/ipc/agent/types'
import { AgentFactory } from '../agents/factory'
import { saveMessageToProject } from './chatPersistence'
import { agentCheckpointRegistry } from '@collaragent/checkpoint'
import { flushTelemetry } from '../../collaragent/telemetry/index'

/**
 * Handles the streaming of agent responses to the renderer process.
 * Uses 'messages' stream mode to stream tokens and metadata.
 */
export async function streamAgentResponse(
  agentFactory: AgentFactory,
  threadId: string,
  userMessage: string,
  signal: AbortSignal,
  sender: WebContents,
  streamId: string,
  ports?: { wsPort?: number; apiPort?: number },
  clientIds?: { clientMessageId?: string; clientAssistantMessageId?: string },
  metrics?: { ipcChunks: number; ipcBytes: number; firstChunkAt?: number }
): Promise<void> {
  const agent = await agentFactory.createAgent({ threadId, apiPort: ports?.apiPort })
  const input = { messages: [new HumanMessage(userMessage)] }

  // Save User Message to History
  if (ports?.apiPort) {
    saveMessageToProject(
      ports.apiPort,
      threadId,
      'user',
      userMessage,
      undefined,
      undefined,
      undefined,
      undefined,
      clientIds?.clientMessageId
    ).catch(() => {})
  }

  // Initialize Langfuse Telemetry via AgentFactory
  const langfuseHandler = await agentFactory.getTelemetryHandler({
    threadId,
    sessionId: threadId,
    tags: ['desktop-chat']
  })

  // Use standard LangGraph 'messages' stream mode for token streaming
  // This provides [chunk, metadata] tuples
  const pendingBranchId = agentCheckpointRegistry.consumePendingBranch(threadId)
  const stream = await agent.stream(input, {
    configurable: {
      thread_id: threadId,
      ...ports,
      ...(pendingBranchId ? { checkpoint_id: pendingBranchId } : {})
    },
    signal: signal,
    streamMode: 'messages',
    recursionLimit: 200,
    callbacks: langfuseHandler ? [langfuseHandler] : []
  })

  let fullResponse = ''
  let activeToolCalls: any[] = []
  let blocks: Types.MessageBlock[] = []
  let usage: Types.TokenUsage | undefined

  let textBuffer = ''
  let reasoningBuffer = ''
  let lastFlush = Date.now()
  const flushIntervalMs = 16
  const maxBufferSize = 64

  const flushText = (force?: boolean) => {
    const now = Date.now()
    const hitTime = now - lastFlush >= flushIntervalMs
    const hitSize = textBuffer.length >= maxBufferSize || reasoningBuffer.length >= maxBufferSize
    const shouldFlush = force || hitTime || hitSize

    const hasBuffers = textBuffer.length > 0 || reasoningBuffer.length > 0
    if (!shouldFlush || (!hasBuffers && (!force || !usage))) return

    const payload: Types.AgentStreamChunk = {
      chunk: textBuffer,
      reasoning: reasoningBuffer || undefined,
      threadId,
      streamId,
      usage
    }

    sender.send(Channels.agentStreamChannel(streamId), payload)
    if (metrics) {
      metrics.ipcChunks += 1
      metrics.ipcBytes += Buffer.byteLength(JSON.stringify(payload))
      if (!metrics.firstChunkAt) metrics.firstChunkAt = Date.now()
    }
    textBuffer = ''
    reasoningBuffer = ''
    lastFlush = now
  }

  const emitToolUpdate = () => {
    const payload: Types.AgentStreamChunk = {
      chunk: '',
      threadId,
      streamId,
      toolCalls: activeToolCalls.length > 0 ? activeToolCalls : undefined,
      usage
    }
    sender.send(Channels.agentStreamChannel(streamId), payload)
    if (metrics) {
      metrics.ipcChunks += 1
      metrics.ipcBytes += Buffer.byteLength(JSON.stringify(payload))
      if (!metrics.firstChunkAt) metrics.firstChunkAt = Date.now()
    }
  }

  let fatalError: any = null
  try {
    for await (const [chunk] of stream) {
      console.log('[streaming] Raw chunk:', JSON.stringify(chunk, null, 2))
      let content = ''
      const type = (chunk as any)._getType?.() || ''

      // 1. Handle Tool Calls (from AI Message)
      if ((chunk as any).tool_calls && (chunk as any).tool_calls.length > 0) {
        for (const tc of (chunk as any).tool_calls) {
          const existingCall = activeToolCalls.find((t) => t.id === tc.id)
          if (!existingCall) {
            activeToolCalls.push({
              id: tc.id,
              name: tc.name,
              args: tc.args,
              status: 'pending'
            })
            // Add tool block in order
            blocks.push({ type: 'tool', toolId: tc.id })
          }
        }
        flushText(true)
        emitToolUpdate()
      }

      // 2. Handle Tool Results (from Tool Message)
      if (type === 'tool') {
        const toolCallId = (chunk as any).tool_call_id
        const tc = activeToolCalls.find((t) => t.id === toolCallId)
        if (tc) {
          tc.status = 'completed'
          try {
            // Attempt to parse result if it's JSON
            tc.result =
              typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content
          } catch (e) {
            tc.result = chunk.content
          }
          flushText(true)
          emitToolUpdate()
        }
      }

      // Extract token usage metadata from the chunk (often on its own or final chunk)
      if ((chunk as any).usage_metadata) {
        usage = {
          inputTokens: (chunk as any).usage_metadata.input_tokens || 0,
          outputTokens: (chunk as any).usage_metadata.output_tokens || 0,
          totalTokens: (chunk as any).usage_metadata.total_tokens || 0,
          reasoningTokens: (chunk as any).usage_metadata.output_token_details?.reasoning,
          cachedInputTokens: (chunk as any).usage_metadata.input_token_details?.cache_read
        }
        console.info(
          `[streaming] Captured usage for ${threadId}: In=${usage.inputTokens} Out=${usage.outputTokens}`
        )
      }

      // 3. Handle Regular Content
      // Check both chunk.content (standard) and chunk.content_blocks / contentBlocks (extended/provider specific)
      const rawContent = (chunk as any).content
      const rawBlocks = (chunk as any).content_blocks || (chunk as any).contentBlocks

      if ((rawContent || rawBlocks) && type !== 'tool') {
        const contentBlocks =
          rawBlocks && Array.isArray(rawBlocks)
            ? rawBlocks
            : Array.isArray(rawContent)
              ? rawContent
              : [{ type: 'text', text: rawContent?.toString() || '' }]

        for (const block of contentBlocks) {
          if (block.type === 'text' || typeof block === 'string') {
            const textValue = String(typeof block === 'string' ? block : block.text || '')
            if (textValue) {
              content += textValue
              fullResponse += textValue

              const lastBlock = blocks[blocks.length - 1]
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.content += textValue
              } else {
                blocks.push({ type: 'text', content: textValue })
              }

              textBuffer += textValue
              flushText()
            }
          } else if (
            block.type === 'reasoning' ||
            block.type === 'thinking' ||
            block.type === 'redacted_thinking'
          ) {
            const reasoningValue = String(block.reasoning || block.thinking || block.data || '')
            if (reasoningValue) {
              const lastBlock = blocks[blocks.length - 1]
              if (lastBlock && lastBlock.type === 'reasoning') {
                lastBlock.content += reasoningValue
              } else {
                blocks.push({ type: 'reasoning', content: reasoningValue })
              }

              reasoningBuffer += reasoningValue
              flushText()
            }
          }
        }
      }
    }
  } catch (err: any) {
    const isAbort = err.name === 'AbortError' || err.message === 'terminated'
    if (!isAbort) {
      fatalError = err
      console.error(`[streaming] Stream encountered fatal error for ${threadId}:`, err)
    } else {
      console.info(`[streaming] Stream aborted for ${threadId}, performing partial save.`)
    }
  }

  flushText(true)

  // Save Assistant Message to History (Partial or Full)
  // We save even on abort to align the UI history with the agent's internal state.
  if ((fullResponse || activeToolCalls.length > 0) && ports?.apiPort) {
    if (usage) {
      console.info(`[streaming] Saving assistant message with final usage for ${threadId}:`, usage)
    }
    await saveMessageToProject(
      ports.apiPort,
      threadId,
      'assistant',
      fullResponse,
      activeToolCalls,
      blocks,
      undefined,
      usage,
      clientIds?.clientAssistantMessageId
    ).catch((err) => {
      console.error(`[streaming] FAILED to save assistant message for ${threadId}:`, err)
    })
  }

  // Update the registry with the new effective checkpoint.
  // We do this even on abort to ensure the next turn accurately branches from
  // the state LangGraph actually reached (including completed tools).
  if (ports?.apiPort) {
    const persistenceManager = agentFactory.getPersistenceManager()
    if (persistenceManager) {
      const newCheckpointId = await persistenceManager.getLatestCheckpointId(threadId, {
        apiPort: ports.apiPort,
        checkpointNs: ''
      })
      if (newCheckpointId) {
        agentCheckpointRegistry.setEffective(threadId, newCheckpointId)
      }
    }
  }

  // Flush any pending telemetry traces asynchronously
  if (langfuseHandler) {
    await flushTelemetry(langfuseHandler)
  }

  // If there was a fatal error, re-throw it so the handler can emit the error signal
  if (fatalError) {
    throw fatalError
  }
}
