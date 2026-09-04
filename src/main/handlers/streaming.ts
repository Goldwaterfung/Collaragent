import { WebContents } from 'electron'
import { HumanMessage } from '@langchain/core/messages'
import * as Channels from '../../shared/ipc/agent/channels'
import * as Types from '../../shared/ipc/agent/types'
import { AgentFactory } from '../agents/factory'
import { saveMessageToProject } from './chatPersistence'
import { agentCheckpointRegistry } from '@collaragent/checkpoint'
import { flushTelemetry } from '../../collaragent/telemetry/index'

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Handles the streaming of agent responses to the renderer process.
 * Uses dual 'messages' and 'updates' stream mode to stream tokens and metadata.
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

  // Use dual LangGraph stream mode: 'messages' for token/reasoning streaming,
  // and 'updates' for node state transitions (capturing Command-returned ToolMessages).
  const pendingBranchId = agentCheckpointRegistry.consumePendingBranch(threadId)
  const stream = await agent.stream(input, {
    configurable: {
      thread_id: threadId,
      ...ports,
      ...(pendingBranchId ? { checkpoint_id: pendingBranchId } : {})
    },
    signal: signal,
    streamMode: ['messages', 'updates'],
    recursionLimit: 200,
    callbacks: langfuseHandler ? [langfuseHandler] : []
  })

  let fullResponse = ''
  let activeToolCalls: Types.ToolCall[] = []
  let blocks: Types.MessageBlock[] = []
  let usage: Types.TokenUsage | undefined

  let textBuffer = ''
  let reasoningBuffer = ''
  let lastFlush = Date.now()
  const flushIntervalMs = 16
  const maxBufferSize = 64

  interface SubagentStreamBuffer {
    textBuffer: string
    reasoningBuffer: string
    toolCalls: Types.ToolCall[]
    blocks: Types.MessageBlock[]
    lastFlush: number
  }
  const subagentStreams = new Map<string, SubagentStreamBuffer>()

  const getOrCreateSubagentBuffer = (toolCallId: string): SubagentStreamBuffer => {
    let buf = subagentStreams.get(toolCallId)
    if (!buf) {
      buf = {
        textBuffer: '',
        reasoningBuffer: '',
        toolCalls: [],
        blocks: [],
        lastFlush: Date.now()
      }
      subagentStreams.set(toolCallId, buf)
    }
    return buf
  }

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

  const flushSubagentText = (targetToolCallId: string, force?: boolean) => {
    const buf = subagentStreams.get(targetToolCallId)
    if (!buf) return
    const now = Date.now()
    const hitTime = now - buf.lastFlush >= flushIntervalMs
    const hitSize =
      buf.textBuffer.length >= maxBufferSize || buf.reasoningBuffer.length >= maxBufferSize
    const shouldFlush = force || hitTime || hitSize

    const hasBuffers = buf.textBuffer.length > 0 || buf.reasoningBuffer.length > 0
    if (!shouldFlush || (!hasBuffers && !force)) return

    const payload: Types.AgentStreamChunk = {
      chunk: buf.textBuffer,
      reasoning: buf.reasoningBuffer || undefined,
      threadId,
      streamId,
      subagentToolCallId: targetToolCallId,
      toolCalls: buf.toolCalls.length > 0 ? buf.toolCalls : undefined,
      blocks: buf.blocks.length > 0 ? buf.blocks : undefined
    }

    sender.send(Channels.agentStreamChannel(streamId), payload)
    if (metrics) {
      metrics.ipcChunks += 1
      metrics.ipcBytes += Buffer.byteLength(JSON.stringify(payload))
      if (!metrics.firstChunkAt) metrics.firstChunkAt = Date.now()
    }
    buf.textBuffer = ''
    buf.reasoningBuffer = ''
    buf.lastFlush = now
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

  const emitSubagentToolUpdate = (targetToolCallId: string) => {
    const buf = subagentStreams.get(targetToolCallId)
    if (!buf) return
    const payload: Types.AgentStreamChunk = {
      chunk: '',
      threadId,
      streamId,
      subagentToolCallId: targetToolCallId,
      toolCalls: buf.toolCalls.length > 0 ? buf.toolCalls : undefined,
      blocks: buf.blocks.length > 0 ? buf.blocks : undefined
    }
    sender.send(Channels.agentStreamChannel(streamId), payload)
    if (metrics) {
      metrics.ipcChunks += 1
      metrics.ipcBytes += Buffer.byteLength(JSON.stringify(payload))
      if (!metrics.firstChunkAt) metrics.firstChunkAt = Date.now()
    }
  }

  let fatalError: Error | null = null
  try {
    for await (const rawItem of stream as AsyncIterable<unknown>) {
      if (!Array.isArray(rawItem) || rawItem.length < 2) continue
      const mode = rawItem[0]
      const streamPayload = rawItem[1]

      // Handle node updates (capturing ToolMessages emitted via Command)
      if (mode === 'updates') {
        if (isRecord(streamPayload)) {
          for (const nodeKey of Object.keys(streamPayload)) {
            const nodeUpdate = streamPayload[nodeKey]
            if (isRecord(nodeUpdate) && Array.isArray(nodeUpdate.messages)) {
              for (const rawMsg of nodeUpdate.messages) {
                if (!isRecord(rawMsg)) continue
                const msgType =
                  typeof rawMsg._getType === 'function'
                    ? (rawMsg._getType as () => string)()
                    : typeof rawMsg.type === 'string'
                      ? rawMsg.type
                      : ''

                const toolCallId =
                  typeof rawMsg.tool_call_id === 'string'
                    ? rawMsg.tool_call_id
                    : isRecord(rawMsg.kwargs) && typeof rawMsg.kwargs.tool_call_id === 'string'
                      ? rawMsg.kwargs.tool_call_id
                      : ''

                if (msgType === 'tool' || toolCallId) {
                  const rawArtifact =
                    'artifact' in rawMsg
                      ? rawMsg.artifact
                      : isRecord(rawMsg.kwargs) && 'artifact' in rawMsg.kwargs
                        ? rawMsg.kwargs.artifact
                        : undefined

                  const rawContent =
                    rawMsg.content !== undefined
                      ? rawMsg.content
                      : isRecord(rawMsg.kwargs)
                        ? rawMsg.kwargs.content
                        : undefined

                  const isError =
                    rawMsg.status === 'error' ||
                    (isRecord(rawMsg.kwargs) && rawMsg.kwargs.status === 'error')

                  let parsedResult: unknown = rawContent
                  if (rawArtifact !== undefined) {
                    parsedResult = rawArtifact
                  } else if (typeof rawContent === 'string') {
                    try {
                      parsedResult = JSON.parse(rawContent)
                    } catch {
                      parsedResult = rawContent
                    }
                  }

                  const tc = activeToolCalls.find((t) => t.id === toolCallId)
                  if (tc) {
                    tc.status = isError ? 'error' : 'completed'
                    tc.result = parsedResult
                    flushText(true)
                    emitToolUpdate()
                  } else {
                    for (const [subId, subBuf] of subagentStreams.entries()) {
                      const subTc = subBuf.toolCalls.find((t) => t.id === toolCallId)
                      if (subTc) {
                        subTc.status = isError ? 'error' : 'completed'
                        subTc.result = parsedResult
                        flushSubagentText(subId, true)
                        emitSubagentToolUpdate(subId)
                        break
                      }
                    }
                  }
                }
              }
            }
          }
        }
        continue
      }

      if (mode !== 'messages') continue

      const [chunk, rawMetadata] = Array.isArray(streamPayload)
        ? (streamPayload as [Record<string, unknown>, Record<string, unknown> | undefined])
        : [streamPayload as Record<string, unknown>, undefined]

      const metadata = rawMetadata || {}
      const subagentTag = Array.isArray(metadata.tags)
        ? (metadata.tags as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.startsWith('subagent:'))
            .map((t) => t.slice('subagent:'.length))[0]
        : undefined

      const metadataSubagentId =
        typeof metadata.subagentToolCallId === 'string' ? metadata.subagentToolCallId : undefined

      const checkpointNs = typeof metadata.checkpoint_ns === 'string' ? metadata.checkpoint_ns : ''
      const isNestedInTools = checkpointNs.includes('tools:') && checkpointNs.includes('|')

      const fallbackSubagentId = isNestedInTools
        ? activeToolCalls.find(
            (tc) => (tc.name === 'task' || tc.name === 'dynamic_task') && tc.status !== 'completed'
          )?.id
        : undefined

      const subagentToolCallId = metadataSubagentId || subagentTag || fallbackSubagentId

      let content = ''
      const type = typeof chunk._getType === 'function' ? (chunk._getType as () => string)() : ''

      // 1. Handle Tool Calls (from AI Message)
      if (Array.isArray(chunk.tool_calls) && chunk.tool_calls.length > 0) {
        if (subagentToolCallId) {
          const subBuf = getOrCreateSubagentBuffer(subagentToolCallId)
          for (const rawTc of chunk.tool_calls as Record<string, unknown>[]) {
            const tcId = typeof rawTc.id === 'string' ? rawTc.id : `sub_tc_${Date.now()}`
            const existingCall = subBuf.toolCalls.find((t) => t.id === tcId)
            if (!existingCall) {
              subBuf.toolCalls.push({
                id: tcId,
                name: typeof rawTc.name === 'string' ? rawTc.name : 'unknown',
                args:
                  rawTc.args && typeof rawTc.args === 'object'
                    ? (rawTc.args as Record<string, unknown>)
                    : {},
                status: 'pending'
              })
              subBuf.blocks.push({ type: 'tool', toolId: tcId })
            }
          }
          flushSubagentText(subagentToolCallId, true)
          emitSubagentToolUpdate(subagentToolCallId)
        } else {
          for (const rawTc of chunk.tool_calls as Record<string, unknown>[]) {
            const tcId = typeof rawTc.id === 'string' ? rawTc.id : `tc_${Date.now()}`
            const existingCall = activeToolCalls.find((t) => t.id === tcId)
            if (!existingCall) {
              activeToolCalls.push({
                id: tcId,
                name: typeof rawTc.name === 'string' ? rawTc.name : 'unknown',
                args:
                  rawTc.args && typeof rawTc.args === 'object'
                    ? (rawTc.args as Record<string, unknown>)
                    : {},
                status: 'pending'
              })
              blocks.push({ type: 'tool', toolId: tcId })
            }
          }
          flushText(true)
          emitToolUpdate()
        }
      }

      // 2. Handle Tool Results (from Tool Message)
      if (type === 'tool') {
        const toolCallId = typeof chunk.tool_call_id === 'string' ? chunk.tool_call_id : ''
        const tc = activeToolCalls.find((t) => t.id === toolCallId)
        if (tc) {
          tc.status = 'completed'
          const rawArtifact = (chunk as unknown as { artifact?: unknown }).artifact
          if (rawArtifact !== undefined) {
            tc.result = rawArtifact
          } else {
            try {
              tc.result =
                typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content
            } catch {
              tc.result = chunk.content
            }
          }
          flushText(true)
          emitToolUpdate()
        } else if (subagentToolCallId) {
          const subBuf = subagentStreams.get(subagentToolCallId)
          const subTc = subBuf?.toolCalls.find((t) => t.id === toolCallId)
          if (subTc && subBuf) {
            subTc.status = 'completed'
            try {
              subTc.result =
                typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content
            } catch {
              subTc.result = chunk.content
            }
            flushSubagentText(subagentToolCallId, true)
            emitSubagentToolUpdate(subagentToolCallId)
          }
        }
      }

      // Extract token usage metadata from the chunk (often on its own or final chunk)
      if (chunk.usage_metadata && !subagentToolCallId) {
        const rawUsage = chunk.usage_metadata as Record<string, unknown>
        const outDetails = rawUsage.output_token_details as Record<string, unknown> | undefined
        const inDetails = rawUsage.input_token_details as Record<string, unknown> | undefined
        usage = {
          inputTokens: typeof rawUsage.input_tokens === 'number' ? rawUsage.input_tokens : 0,
          outputTokens: typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : 0,
          totalTokens: typeof rawUsage.total_tokens === 'number' ? rawUsage.total_tokens : 0,
          reasoningTokens:
            typeof outDetails?.reasoning === 'number' ? outDetails.reasoning : undefined,
          cachedInputTokens:
            typeof inDetails?.cache_read === 'number' ? inDetails.cache_read : undefined
        }
        console.info(
          `[streaming] Captured usage for ${threadId}: In=${usage.inputTokens} Out=${usage.outputTokens}`
        )
      }

      // 3. Handle Regular Content
      const rawContent = chunk.content
      const rawBlocks = (chunk.content_blocks || chunk.contentBlocks) as unknown

      if ((rawContent || rawBlocks) && type !== 'tool') {
        const contentBlocks =
          rawBlocks && Array.isArray(rawBlocks)
            ? rawBlocks
            : Array.isArray(rawContent)
              ? rawContent
              : [{ type: 'text', text: rawContent?.toString() || '' }]

        for (const rawB of contentBlocks) {
          const block = rawB as Record<string, unknown>
          const isText = block.type === 'text' || typeof rawB === 'string'
          const isReasoning =
            block.type === 'reasoning' ||
            block.type === 'thinking' ||
            block.type === 'redacted_thinking'

          if (isText) {
            const textValue = String(typeof rawB === 'string' ? rawB : block.text || '')
            if (textValue) {
              if (subagentToolCallId) {
                const subBuf = getOrCreateSubagentBuffer(subagentToolCallId)
                const lastBlock = subBuf.blocks[subBuf.blocks.length - 1]
                if (lastBlock && lastBlock.type === 'text') {
                  lastBlock.content += textValue
                } else {
                  subBuf.blocks.push({ type: 'text', content: textValue })
                }
                subBuf.textBuffer += textValue
                flushSubagentText(subagentToolCallId)
              } else {
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
            }
          } else if (isReasoning) {
            const reasoningValue = String(block.reasoning || block.thinking || block.data || '')
            if (reasoningValue) {
              if (subagentToolCallId) {
                const subBuf = getOrCreateSubagentBuffer(subagentToolCallId)
                const lastBlock = subBuf.blocks[subBuf.blocks.length - 1]
                if (lastBlock && lastBlock.type === 'reasoning') {
                  lastBlock.content += reasoningValue
                } else {
                  subBuf.blocks.push({ type: 'reasoning', content: reasoningValue })
                }
                subBuf.reasoningBuffer += reasoningValue
                flushSubagentText(subagentToolCallId)
              } else {
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
    }
  } catch (err: unknown) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    const isAbort = errorObj.name === 'AbortError' || errorObj.message === 'terminated'
    if (!isAbort) {
      fatalError = errorObj
      console.error(`[streaming] Stream encountered fatal error for ${threadId}:`, err)
    } else {
      console.info(`[streaming] Stream aborted for ${threadId}, performing partial save.`)
    }
  }

  flushText(true)
  for (const subId of subagentStreams.keys()) {
    flushSubagentText(subId, true)
  }

  // Final State Reconciliation:
  // Reconcile activeToolCalls with underlying graph state to ensure all completed
  // tool messages and subagent artifacts are captured before persisting to project history.
  if (ports?.apiPort && typeof agent.getState === 'function') {
    try {
      const graphState = (await agent.getState({
        configurable: {
          thread_id: threadId,
          ...ports
        }
      })) as Record<string, unknown> | undefined

      if (graphState && isRecord(graphState.values) && Array.isArray(graphState.values.messages)) {
        for (const rawMsg of graphState.values.messages) {
          if (!isRecord(rawMsg)) continue
          const toolCallId =
            typeof rawMsg.tool_call_id === 'string'
              ? rawMsg.tool_call_id
              : isRecord(rawMsg.kwargs) && typeof rawMsg.kwargs.tool_call_id === 'string'
                ? rawMsg.kwargs.tool_call_id
                : ''
          if (!toolCallId) continue

          const tc = activeToolCalls.find((t) => t.id === toolCallId)
          if (tc) {
            const isError =
              rawMsg.status === 'error' ||
              (isRecord(rawMsg.kwargs) && rawMsg.kwargs.status === 'error')
            if (tc.status === 'pending') {
              tc.status = isError ? 'error' : 'completed'
            }
            if (tc.result === undefined) {
              const rawArtifact =
                'artifact' in rawMsg
                  ? rawMsg.artifact
                  : isRecord(rawMsg.kwargs) && 'artifact' in rawMsg.kwargs
                    ? rawMsg.kwargs.artifact
                    : undefined
              if (rawArtifact !== undefined) {
                tc.result = rawArtifact
              } else {
                const rawContent =
                  rawMsg.content !== undefined
                    ? rawMsg.content
                    : isRecord(rawMsg.kwargs)
                      ? rawMsg.kwargs.content
                      : undefined
                if (rawContent !== undefined) {
                  try {
                    tc.result = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent
                  } catch {
                    tc.result = rawContent
                  }
                }
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      console.warn(`[streaming] State reconciliation warning for ${threadId}:`, err)
    }
  }

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
