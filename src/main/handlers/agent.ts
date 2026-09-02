import { ipcMain } from 'electron'
import { AgentFactory } from '../agents/factory'
import * as Channels from '../../shared/ipc/agent/channels'
import * as Types from '../../shared/ipc/agent/types'
import { HumanMessage } from '@langchain/core/messages'
import crypto from 'crypto'
import { streamAgentResponse } from './streaming'
import { saveMessageToProject } from './chatPersistence'
import { agentCheckpointRegistry } from '@collaragent/checkpoint'
import { flushTelemetry } from '../../collaragent/telemetry/index'

// Track active streams for abortion
const activeStreams = new Map<string, AbortController>()

export function abortAgentStream(threadId: string): boolean {
  if (activeStreams.has(threadId)) {
    activeStreams.get(threadId)?.abort()
    activeStreams.delete(threadId)
    return true
  }
  return false
}

export function registerAgentHandlers(agentFactory: AgentFactory) {
  // 1. Chat (One-shot)
  ipcMain.handle(
    Channels.AGENT_CHAT,
    async (_, request: Types.AgentChatRequest): Promise<Types.AgentChatResponse> => {
      const threadId = request.threadId || crypto.randomUUID()

      // Create Agent for this turn (re-created per request to pick up config changes)
      const agent = await agentFactory.createAgent({ threadId, apiPort: request.apiPort })

      const controller = new AbortController()
      activeStreams.set(threadId, controller)

      // Initialize Langfuse Telemetry via AgentFactory
      const langfuseHandler = await agentFactory.getTelemetryHandler({
        threadId,
        sessionId: threadId,
        tags: ['desktop-chat-oneshot']
      })

      try {
        // Save User Message to Project-backed history
        if (request.apiPort) {
          await saveMessageToProject(
            request.apiPort,
            threadId,
            'user',
            request.message,
            undefined,
            undefined,
            undefined,
            undefined,
            request.clientMessageId
          ).catch(() => {})
        }

        // LangGraph agents typically expect an object with a 'messages' key
        const input = { messages: [new HumanMessage(request.message)] }

        const pendingBranchId = agentCheckpointRegistry.consumePendingBranch(threadId)
        const configurable: Record<string, unknown> = {
          thread_id: threadId,
          wsPort: request.wsPort,
          apiPort: request.apiPort
        }
        if (pendingBranchId) {
          configurable.checkpoint_id = pendingBranchId
        }

        const result = await agent.invoke(input, {
          configurable,
          signal: controller.signal,
          recursionLimit: 200,
          callbacks: langfuseHandler ? [langfuseHandler] : []
        })

        // Extract the last message from the state
        const messages =
          (
            result as {
              messages?: Array<{
                content?: unknown
                usage_metadata?: {
                  input_tokens?: number
                  output_tokens?: number
                  total_tokens?: number
                  output_token_details?: { reasoning?: number }
                  input_token_details?: { cache_read?: number }
                }
              }>
            }
          ).messages || []
        const lastMsg = messages[messages.length - 1]
        const output = lastMsg?.content?.toString() || ''

        // Extract token usage if available in the one-shot response
        let usage: Types.TokenUsage | undefined = undefined
        if (lastMsg?.usage_metadata) {
          usage = {
            inputTokens: lastMsg.usage_metadata.input_tokens || 0,
            outputTokens: lastMsg.usage_metadata.output_tokens || 0,
            totalTokens: lastMsg.usage_metadata.total_tokens || 0,
            reasoningTokens: lastMsg.usage_metadata.output_token_details?.reasoning,
            cachedInputTokens: lastMsg.usage_metadata.input_token_details?.cache_read
          }
        }

        // Save Assistant Message to Project-backed history
        if (output && request.apiPort) {
          await saveMessageToProject(
            request.apiPort,
            threadId,
            'assistant',
            output,
            undefined,
            undefined,
            undefined,
            usage,
            request.clientAssistantMessageId
          ).catch(() => {})
        }

        // Update registry with latest checkpoint
        if (request.apiPort) {
          const persistenceManager = agentFactory.getPersistenceManager()
          const newCheckpointId = await persistenceManager.getLatestCheckpointId(threadId, {
            apiPort: request.apiPort,
            checkpointNs: ''
          })
          if (newCheckpointId) {
            agentCheckpointRegistry.setEffective(threadId, newCheckpointId)
          }
        }

        return { output, threadId }
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : 'Agent run failed'
        console.error('Agent chat failed:', e)
        throw new Error(errMsg)
      } finally {
        if (langfuseHandler) {
          await flushTelemetry(langfuseHandler)
        }
        activeStreams.delete(threadId)
      }
    }
  )

  // 2. Stream
  ipcMain.on(Channels.AGENT_STREAM, async (event, request: Types.AgentStreamRequest) => {
    const threadId = request.threadId || crypto.randomUUID()
    const streamId = request.streamId || crypto.randomUUID()
    const receivedAt = Date.now()
    const metrics = { ipcChunks: 0, ipcBytes: 0, firstChunkAt: undefined as number | undefined }

    const controller = new AbortController()
    activeStreams.set(threadId, controller)

    try {
      await streamAgentResponse(
        agentFactory,
        threadId,
        request.message,
        controller.signal,
        event.sender,
        streamId,
        { wsPort: request.wsPort, apiPort: request.apiPort },
        {
          clientMessageId: request.clientMessageId,
          clientAssistantMessageId: request.clientAssistantMessageId
        },
        metrics
      )

      // Signal stream completion
      event.sender.send(Channels.agentStreamEndChannel(streamId), { threadId, streamId })

      const doneAt = Date.now()
      const ttftMs =
        metrics.firstChunkAt && request.clientSentAt
          ? metrics.firstChunkAt - request.clientSentAt
          : undefined
      const setupMs = metrics.firstChunkAt ? metrics.firstChunkAt - receivedAt : undefined
      console.info(
        `[stream] thread=${threadId} stream=${streamId} ttftMs=${ttftMs ?? 'n/a'} ` +
          `setupMs=${setupMs ?? 'n/a'} ipcChunks=${metrics.ipcChunks} ` +
          `ipcBytes=${metrics.ipcBytes} totalMs=${doneAt - receivedAt}`
      )
    } catch (error: any) {
      // Ignore AbortError or "terminated" error (from undici/fetch) if it was user-initiated
      const isAbort =
        error.name === 'AbortError' ||
        error.message === 'terminated' ||
        (error.cause && error.cause.message === 'terminated')

      if (!isAbort) {
        console.error('Agent stream failed:', error)
        event.sender.send(Channels.agentStreamErrorChannel(streamId), {
          error: error.message,
          threadId,
          streamId
        })
      } else {
        // Ensure UI is reset even if aborted
        event.sender.send(Channels.agentStreamEndChannel(streamId), { threadId, streamId })
      }
    } finally {
      activeStreams.delete(threadId)
    }
  })

  // 3. Abort
  ipcMain.handle(Channels.AGENT_ABORT, async (_, threadId: string) => {
    return abortAgentStream(threadId)
  })
}
