import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useChatStore } from '../../store/chatStore'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { AgentStream } from './AgentStream'
import { TodoCard } from './TodoCard'
import { ChatMessage } from '../../types/ui'
import { SubagentStreamPane } from './SubagentStreamPane'
import type { ToolCall } from './types'
import { parseSubagentTaskFromToolCall } from './subagentUtils'
import * as Channels from '@shared/ipc/agent/channels'
import * as Types from '@shared/ipc/agent/types'
import { useProjectSession } from '@workspace/contexts/project/ProjectSession'
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext'
import { useSkillsContext } from '@workspace/contexts/skills/SkillsContext'
import * as ChatService from '@shared/services/ChatService'
import type { CheckpointBundleSummary } from '@shared/ipc/checkpoints/types'
import {
  COLLAR_CHECKPOINT_RESTORED_EVENT,
  type CheckpointRestoredDetail
} from '@shared/checkpoints/events'
import { getStreamErrorPresentation } from '../../utils/streamErrors'
import { ChatIcon } from '../../assets/icons/ChatIcon'
import { ChevronDownIcon } from '../../assets/icons/ChevronDownIcon'

export interface ChatProps {
  sessionId?: string
}

export const Chat: React.FC<ChatProps> = ({ sessionId }) => {
  const {
    messages: globalMessages,
    messagesByThread,
    streamingParams,
    addMessage,
    addThreadMessage,
    setStreaming,
    resetStreaming,
    threadId,
    setThreadId,
    setThreadMessages,
    setThreadDraftInput,
    upsertSubagentTask
  } = useChatStore()

  const currentThreadId = sessionId || threadId
  const messages = (sessionId ? messagesByThread[sessionId] : undefined) || globalMessages

  const { activeProjectId, instanceId, openInstanceIds, projects } = useInstanceContext()
  const { wsPort, apiPort, hasSession } = useProjectSession()
  const { skills } = useSkillsContext()

  const activeProjectIdRef = useRef(activeProjectId)
  const instanceIdRef = useRef(instanceId)
  const openInstanceIdsRef = useRef(openInstanceIds)
  const projectsRef = useRef(projects)

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
    instanceIdRef.current = instanceId
    openInstanceIdsRef.current = openInstanceIds
    projectsRef.current = projects
  }, [activeProjectId, instanceId, openInstanceIds, projects])

  // Hydrate session history when a sessionId is provided and messages are empty
  useEffect(() => {
    if (!sessionId || !hasSession || !apiPort) return
    const threadMsgs = useChatStore.getState().messagesByThread[sessionId]
    if (!threadMsgs || threadMsgs.length === 0) {
      ChatService.getMessages(sessionId)
        .then((history) => {
          if (history && history.length > 0) {
            setThreadMessages(sessionId, history as unknown as ChatMessage[])
          }
        })
        .catch((err) => {
          console.error('Failed to load session history for', sessionId, err)
        })
    }
  }, [sessionId, hasSession, apiPort, setThreadMessages])

  // Derive active streaming state for current view
  const activeStreaming =
    currentThreadId && streamingParams[currentThreadId]
      ? streamingParams[currentThreadId]
      : {
          isStreaming: false,
          accumulatedContent: '',
          blocks: [],
          tokensReceived: 0,
          startTime: null,
          currentMessage: ''
        }

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const streamMessageIdsRef = useRef<Map<string, { assistantId: string }>>(new Map())
  const [checkpointBundles, setCheckpointBundles] = useState<CheckpointBundleSummary[]>([])
  const [checkpointBusy, setCheckpointBusy] = useState(false)
  const [checkpointError, setCheckpointError] = useState<string | null>(null)

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const atBottom = distanceFromBottom <= 80
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom
      setIsAtBottom(atBottom)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    isAtBottomRef.current = true
    setIsAtBottom(true)
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  // ── Subagent pane navigation ──
  // Stores the toolCallId that the user last clicked "View Task" on.
  const [activeSubagentToolCallId, setActiveSubagentToolCallId] = useState<string | null>(null)

  const activeSubagentTool: ToolCall | null = useMemo(() => {
    if (!activeSubagentToolCallId) return null
    const activeTCs = activeStreaming.toolCalls || []
    const fromStream = activeTCs.find((tc) => tc.id === activeSubagentToolCallId)
    if (fromStream) return fromStream
    for (const msg of messages) {
      const found = msg.toolCalls?.find((tc) => tc.id === activeSubagentToolCallId)
      if (found) return found
    }
    return null
  }, [activeSubagentToolCallId, activeStreaming.toolCalls, messages])

  const handleOpenSubagentTask = useCallback((toolCallId: string) => {
    setActiveSubagentToolCallId(toolCallId)
  }, [])

  const handleCloseSubagentTask = useCallback(() => {
    setActiveSubagentToolCallId(null)
  }, [])

  // Seed subagentTasks store from historical messages on mount / message change
  useEffect(() => {
    for (const msg of messages) {
      if (!msg.toolCalls) continue
      for (const tc of msg.toolCalls) {
        if (tc.name !== 'task' && tc.name !== 'dynamic_task') continue
        upsertSubagentTask(parseSubagentTaskFromToolCall(tc))
      }
    }
  }, [messages, upsertSubagentTask])

  // 1. Instant scroll during high-frequency token streaming.
  //    Only scrolls when the user is pinned to the bottom (isAtBottomRef.current === true).
  //    Using direct container.scrollTop = container.scrollHeight eliminates
  //    animation frame conflicts (stroboscopic jitter) and allows effortless upward breakout.
  useEffect(() => {
    if (!activeStreaming.isStreaming && !activeStreaming.accumulatedContent) return
    const container = messagesContainerRef.current
    if (!container || !isAtBottomRef.current) return

    container.scrollTop = container.scrollHeight
  }, [activeStreaming.accumulatedContent, activeStreaming.blocks, activeStreaming.isStreaming])

  // 2. Scroll to bottom on completed message additions if user is at bottom
  const prevMessagesLengthRef = useRef(messages.length)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const messagesCountIncreased = messages.length > prevMessagesLengthRef.current
    prevMessagesLengthRef.current = messages.length

    if (isAtBottomRef.current) {
      if (messagesCountIncreased) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      } else {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [messages])

  // Reset sticky-bottom pin on thread/session switch
  useEffect(() => {
    isAtBottomRef.current = true
    setIsAtBottom(true)
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [sessionId])

  const refreshBundles = useCallback(
    async (targetThreadId?: string) => {
      const activeThreadId = targetThreadId || currentThreadId
      if (!activeThreadId || !window.checkpointIPC) return
      setCheckpointError(null)
      try {
        const res = await window.checkpointIPC.list({
          threadId: activeThreadId,
          projectId: activeProjectIdRef.current
        })
        const sorted = [...(res.bundles || [])].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        )
        setCheckpointBundles(sorted)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load checkpoints'
        setCheckpointError(message)
      }
    },
    [currentThreadId]
  )

  const refreshBundlesRef = useRef(refreshBundles)
  useEffect(() => {
    refreshBundlesRef.current = refreshBundles
  }, [refreshBundles])

  useEffect(() => {
    void refreshBundles()
  }, [refreshBundles])

  const startStream = useCallback(
    (request: Types.AgentStreamRequest) => {
      const streamId = request.streamId || crypto.randomUUID()
      request.streamId = streamId
      if (!request.clientSentAt) request.clientSentAt = Date.now()

      const onStreamChunk = (_event: unknown, data: Types.AgentStreamChunk) => {
        const state = useChatStore.getState()

        if (data.subagentToolCallId) {
          state.updateSubagentStream(
            data.subagentToolCallId,
            data.chunk,
            data.reasoning,
            data.toolCalls,
            data.blocks
          )
          return
        }

        if (data.threadId) {
          const currentParam = state.streamingParams[data.threadId] || {
            accumulatedContent: '',
            blocks: [],
            toolCalls: [],
            currentMessage: '',
            isStreaming: true,
            currentNode: undefined,
            tokensReceived: 0,
            startTime: null,
            currentInterrupt: undefined
          }
          const delta = data.chunk || ''
          const deltaReasoning = data.reasoning || ''
          const nextContent = (currentParam.accumulatedContent || '') + delta

          let nextBlocks = currentParam.blocks ? [...currentParam.blocks] : []
          const currentToolCalls = currentParam.toolCalls || []

          if (data.toolCalls && data.toolCalls.length > 0) {
            const existingIds = new Set(currentToolCalls.map((tc: ToolCall) => tc.id))
            for (const tc of data.toolCalls) {
              if (!existingIds.has(tc.id)) {
                nextBlocks.push({ type: 'tool', toolId: tc.id })
              }
            }
          }

          if (delta) {
            const lastBlock = nextBlocks[nextBlocks.length - 1]
            if (lastBlock && lastBlock.type === 'text') {
              lastBlock.content += delta
            } else {
              nextBlocks.push({ type: 'text', content: delta })
            }
          }

          if (deltaReasoning) {
            const lastBlock = nextBlocks[nextBlocks.length - 1]
            if (lastBlock && lastBlock.type === 'reasoning') {
              lastBlock.content += deltaReasoning
            } else {
              nextBlocks.push({ type: 'reasoning', content: deltaReasoning })
            }
          }

          state.updateStreamingContent(
            data.threadId,
            nextContent,
            undefined,
            data.toolCalls || currentToolCalls,
            nextBlocks,
            data.usage
          )
        }
      }

      const cleanup = () => {
        removeChunkListener()
        removeEndListener()
        removeErrorListener()
      }

      const onStreamEnd = async (_event: unknown, data: { threadId: string; streamId: string }) => {
        const state = useChatStore.getState()
        const threadStream = state.streamingParams[data.threadId]

        if (threadStream) {
          const finalContent = threadStream.accumulatedContent
          const finalToolCalls = threadStream.toolCalls
          const finalBlocks = threadStream.blocks

          const assistantId =
            streamMessageIdsRef.current.get(data.streamId)?.assistantId || crypto.randomUUID()
          const assistantMessage: ChatMessage = {
            id: assistantId,
            role: 'assistant',
            content: finalContent,
            toolCalls: finalToolCalls,
            blocks: finalBlocks,
            usage: threadStream.usage,
            timestamp: new Date(),
            metadata: { threadId: data.threadId }
          }

          if (data.threadId) {
            state.addThreadMessage(data.threadId, assistantMessage)
          } else {
            addMessage(assistantMessage)
          }

          resetStreaming(data.threadId)
        }

        streamMessageIdsRef.current.delete(data.streamId)
        cleanup()

        const targetProjectId = activeProjectIdRef.current || projectsRef.current[0]?.id
        if (targetProjectId && window.checkpointIPC && data.threadId) {
          try {
            await window.checkpointIPC.create({
              threadId: data.threadId,
              projectId: targetProjectId,
              includeInstances: 'all',
              activeInstanceId: instanceIdRef.current,
              openInstanceIds: openInstanceIdsRef.current,
              reason: 'auto',
              label: 'Turn checkpoint'
            })
            await refreshBundlesRef.current(data.threadId)
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : 'Failed to create post-turn checkpoint'
            console.error('Failed to create post-turn checkpoint:', err)
            setCheckpointError(message)
          }
        }
      }

      const onStreamError = (
        _event: unknown,
        data: { error: string; threadId?: string; streamId?: string }
      ) => {
        console.error('Stream error:', data.error)
        const state = useChatStore.getState()

        if (data.threadId) {
          const threadStream = state.streamingParams[data.threadId]
          if (threadStream) {
            const finalContent = threadStream.accumulatedContent
            const finalToolCalls = threadStream.toolCalls
            const finalBlocks = threadStream.blocks
            const hasRenderableContent = Boolean(
              (finalContent && finalContent.trim().length > 0) ||
              (finalBlocks && finalBlocks.length > 0) ||
              (finalToolCalls && finalToolCalls.length > 0)
            )

            if (hasRenderableContent) {
              const assistantId = data.streamId
                ? streamMessageIdsRef.current.get(data.streamId)?.assistantId || crypto.randomUUID()
                : crypto.randomUUID()
              const assistantMessage: ChatMessage = {
                id: assistantId,
                role: 'assistant',
                content: finalContent,
                toolCalls: finalToolCalls,
                blocks: finalBlocks,
                usage: threadStream.usage,
                timestamp: new Date(),
                metadata: { threadId: data.threadId }
              }
              state.addThreadMessage(data.threadId, assistantMessage)
              if (apiPort) {
                void ChatService.postMessage(data.threadId, {
                  id: assistantId,
                  role: 'assistant',
                  content: finalContent,
                  toolCalls: finalToolCalls,
                  blocks: finalBlocks,
                  usage: threadStream.usage,
                  timestamp: Date.now(),
                  metadata: { threadId: data.threadId }
                })
              }
            }
          }

          const presentation = getStreamErrorPresentation(data.error || 'Stream failed')
          const errorId = crypto.randomUUID()
          const errorMessage: ChatMessage = {
            id: errorId,
            role: 'system',
            content: presentation.content,
            actions: presentation.actions,
            blocks: [{ type: 'text', content: presentation.content }],
            timestamp: new Date(),
            metadata: { threadId: data.threadId }
          }
          state.addThreadMessage(data.threadId, errorMessage)
          if (apiPort) {
            void ChatService.postMessage(data.threadId, {
              id: errorId,
              role: 'system',
              content: presentation.content,
              actions: presentation.actions,
              blocks: [{ type: 'text', content: presentation.content }],
              timestamp: Date.now(),
              metadata: { threadId: data.threadId }
            })
          }
        }

        if (data.threadId) {
          resetStreaming(data.threadId)
        }

        if (data.streamId) {
          streamMessageIdsRef.current.delete(data.streamId)
        }
        cleanup()
      }

      const removeChunkListener = window.electron.ipcRenderer.on(
        Channels.agentStreamChannel(streamId),
        onStreamChunk
      )
      const removeEndListener = window.electron.ipcRenderer.on(
        Channels.agentStreamEndChannel(streamId),
        onStreamEnd
      )
      const removeErrorListener = window.electron.ipcRenderer.on(
        Channels.agentStreamErrorChannel(streamId),
        onStreamError
      )

      window.electron.ipcRenderer.send(Channels.AGENT_STREAM, request)
    },
    [streamMessageIdsRef, resetStreaming, addMessage, apiPort]
  )

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || activeStreaming.isStreaming) return

      const userMessageId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: content,
        timestamp: new Date()
      }

      // Ensure we have a thread id for persistence and agent
      let sid = sessionId || threadId
      if (!sid) {
        sid = crypto.randomUUID()
        setThreadId(sid)
      }

      addThreadMessage(sid, userMessage)

      isAtBottomRef.current = true
      setIsAtBottom(true)
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth'
        })
      }

      // Note: We used to explicitly persist the user message here via ChatService.postMessage.
      // That is now removed because the backend Agent automatically persists the input message
      // when processing AGENT_STREAM. Keeping addThreadMessage above ensures immediate UI feedback (Optimistic Update).

      let promptForAgent = userMessage.content
      const slashMatch = userMessage.content.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/)
      if (slashMatch) {
        const skillName = slashMatch[1]
        const promptText = slashMatch[2] || ''
        const targetSkill = skills.find((s) => s.name.toLowerCase() === skillName.toLowerCase())
        if (targetSkill) {
          promptForAgent = `<SKILL>The user requested you read and use the "${targetSkill.name}" skill. The path to the skill file is:\n${targetSkill.skillMdPath}</SKILL>\n\n${promptText || `Please apply the ${targetSkill.name} skill to assist me.`}`
        }
      }

      const request: Types.AgentStreamRequest = {
        message: promptForAgent,
        threadId: sid || undefined,
        wsPort: wsPort || undefined,
        apiPort: apiPort || undefined,
        clientMessageId: userMessageId,
        clientAssistantMessageId: assistantMessageId
      }

      setStreaming(sid, true)
      const streamId = request.streamId || crypto.randomUUID()
      request.streamId = streamId
      streamMessageIdsRef.current.set(streamId, { assistantId: assistantMessageId })
      startStream(request)
    },
    [
      activeStreaming.isStreaming,
      addThreadMessage,
      apiPort,
      sessionId,
      setStreaming,
      setThreadId,
      skills,
      startStream,
      threadId,
      wsPort
    ]
  )

  const handleSystemAction = useCallback(
    (input: string) => {
      void handleSendMessage(input)
    },
    [handleSendMessage]
  )

  const handleCancelMessage = useCallback(async () => {
    const sid = sessionId || threadId
    if (!sid) return
    // Mark as no longer streaming immediately to stop the typing indicator,
    // but keep the content in streamingParams so it can be moved to history
    // by the final onStreamEnd signal.
    setStreaming(sid, false)
    try {
      await window.electron.ipcRenderer.invoke(Channels.AGENT_ABORT, sid)
    } catch (e) {
      console.error('Failed to abort stream:', e)
      // Fallback: if abort failed, we still need to clear state
      resetStreaming(sid)
    }
  }, [sessionId, threadId, setStreaming, resetStreaming])

  const handleResume = useCallback(
    async (decision: unknown) => {
      console.log('Resuming with decision:', decision)
      const message = `[Resumed with decision: ${JSON.stringify(decision)}]`
      const userMessageId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: message,
        timestamp: new Date()
      }
      addMessage(userMessage)

      isAtBottomRef.current = true
      setIsAtBottom(true)
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: 'smooth'
        })
      }

      // Ensure threadId exists
      let sid = threadId
      if (!sid) {
        sid = crypto.randomUUID()
        setThreadId(sid)
      }

      // Note: Persistence is handled by backend Agent

      setStreaming(sid, true)
      const streamId = crypto.randomUUID()
      streamMessageIdsRef.current.set(streamId, { assistantId: assistantMessageId })
      startStream({
        message: message,
        threadId: sid,
        streamId,
        wsPort: wsPort || undefined,
        apiPort: apiPort || undefined,
        clientMessageId: userMessageId,
        clientAssistantMessageId: assistantMessageId
      })
    },
    [addMessage, apiPort, setStreaming, setThreadId, startStream, threadId, wsPort]
  )

  const handleRestoreCheckpoint = useCallback(
    async (bundleId: string, restoreContent?: string) => {
      const targetId = currentThreadId
      if (!targetId || !window.checkpointIPC) return
      setCheckpointBusy(true)
      setCheckpointError(null)
      try {
        await window.checkpointIPC.restore({
          threadId: targetId,
          bundleId,
          createAutoCheckpoint: false,
          reason: 'restore'
        })

        window.dispatchEvent(
          new CustomEvent<CheckpointRestoredDetail>(COLLAR_CHECKPOINT_RESTORED_EVENT, {
            detail: {
              threadId: targetId,
              bundleId,
              timestamp: Date.now()
            }
          })
        )

        const history = await ChatService.getMessages(targetId)
        setThreadMessages(targetId, history as unknown as ChatMessage[])
        resetStreaming(targetId)

        if (restoreContent) {
          setThreadDraftInput(targetId, restoreContent)
        }

        await refreshBundles(targetId)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to restore checkpoint'
        setCheckpointError(message)
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `Error: ${message}`,
          timestamp: new Date()
        })
      } finally {
        setCheckpointBusy(false)
      }
    },
    [
      currentThreadId,
      window.checkpointIPC,
      resetStreaming,
      setThreadMessages,
      setThreadDraftInput,
      refreshBundles,
      setCheckpointBusy,
      setCheckpointError,
      addMessage
    ]
  )

  interface TodoItem {
    status: string
    content: string
  }

  const historyTodos = useMemo(() => {
    // Check message history in reverse
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const tools = msg.toolCalls || []
      // Check tools in reverse to get latest update
      for (let j = tools.length - 1; j >= 0; j--) {
        if (tools[j].name === 'write_todos') {
          const todos = tools[j].args['todos']
          if (Array.isArray(todos)) return todos as unknown as TodoItem[]
        }
      }
    }
    return []
  }, [messages])

  const activeTodos = useMemo(() => {
    // Check active stream first (find last instance)
    const activeTools = activeStreaming.toolCalls || []
    for (let i = activeTools.length - 1; i >= 0; i--) {
      if (activeTools[i].name === 'write_todos') {
        const todos = activeTools[i].args['todos']
        if (Array.isArray(todos)) return todos as unknown as TodoItem[]
      }
    }
    return historyTodos
  }, [activeStreaming.toolCalls, historyTodos])

  return (
    <div className="flex flex-col h-full w-full bg-surface-50 min-w-0 relative">
      {/* Subagent Task Pane (overlays the main content) */}
      {activeSubagentToolCallId && activeSubagentTool ? (
        <SubagentStreamPane
          toolCallId={activeSubagentToolCallId}
          tool={activeSubagentTool}
          onBack={handleCloseSubagentTask}
        />
      ) : (
        <>
          {/* Messages Area - responsive padding & centered */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto min-w-0 w-full custom-scrollbar flex flex-col items-center"
          >
            <div className="reading-column p-3 sm:p-4 md:p-6 flex-1 flex flex-col min-w-0">
              {checkpointError && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center justify-between"
                >
                  <span>{checkpointError}</span>
                  <button
                    type="button"
                    onClick={() => setCheckpointError(null)}
                    className="p-1 hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
                    aria-label="Dismiss checkpoint error"
                  >
                    ✕
                  </button>
                </div>
              )}

              {messages.length === 0 && !activeStreaming.isStreaming ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 my-auto animate-in fade-in zoom-in-95 duration-300">
                  <div className="w-12 h-12 rounded-2xl bg-surface-200 flex items-center justify-center mb-4 text-black/70">
                    <ChatIcon width={24} height={24} />
                  </div>
                  <p className="text-xs sm:text-sm text-[var(--ev-c-text-3)] max-w-sm">
                    Ask questions, create documents, build canvas graphs, or inspect agent
                    workflows.
                  </p>
                </div>
              ) : (
                <>
                  <MessageList
                    messages={messages}
                    checkpointBundles={checkpointBundles}
                    checkpointBusy={checkpointBusy || activeStreaming.isStreaming}
                    onRestoreCheckpoint={handleRestoreCheckpoint}
                    onSystemAction={handleSystemAction}
                    onOpenSubagentTask={handleOpenSubagentTask}
                  />

                  {/* Active Agent Stream */}
                  <div className="mt-4">
                    <AgentStream
                      isStreaming={activeStreaming.isStreaming}
                      currentNode={activeStreaming.currentNode}
                      interrupt={activeStreaming.currentInterrupt}
                      toolCalls={activeStreaming.toolCalls}
                      blocks={activeStreaming.blocks}
                      onResume={handleResume}
                      onOpenSubagentTask={handleOpenSubagentTask}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Floating Scroll-to-Bottom Button */}
          {!isAtBottom && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
              <button
                type="button"
                onClick={scrollToBottom}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/95 border border-surface-200 shadow-sm rounded-full text-[var(--ev-c-text-2)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-100 transition-all focus:outline-none cursor-pointer backdrop-blur-sm"
                aria-label="Scroll to bottom"
              >
                <ChevronDownIcon width={14} height={14} />
                <span>Scroll to bottom</span>
              </button>
            </div>
          )}

          {/* Active Todos Display */}
          <div className="w-full px-4 shrink-0 flex justify-center">
            <div className="reading-column">
              <TodoCard todos={activeTodos} />
            </div>
          </div>

          {/* Input Area - MessageInput Component */}
          <div className="w-full px-4 pb-4 sm:pb-6 pt-2 shrink-0 flex justify-center">
            <div className="reading-column">
              <MessageInput
                onSendMessage={handleSendMessage}
                onCancelMessage={handleCancelMessage}
                disabled={activeStreaming.isStreaming}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
