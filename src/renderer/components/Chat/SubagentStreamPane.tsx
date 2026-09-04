import React, { useEffect, useRef, useState, useMemo } from 'react'
import { renderMarkdown } from '../../utils/markdown'
import type { ToolCall } from './types'
import { useChatStore } from '../../store/chatStore'
import { parseSubagentTaskFromToolCall } from './subagentUtils'
import ToolCallCard from './ToolCallCard'
import ReasoningCard from './ReasoningCard'

interface SubagentStreamPaneProps {
  toolCallId: string
  /** Raw tool object from the active stream or message history */
  tool: ToolCall
  onBack: () => void
}

export const SubagentStreamPane: React.FC<SubagentStreamPaneProps> = ({
  toolCallId,
  tool,
  onBack
}) => {
  const storeTask = useChatStore((s) => s.subagentTasks[toolCallId])
  const parsedTask = useMemo(() => parseSubagentTaskFromToolCall(tool), [tool])
  const task = storeTask || parsedTask

  const resultRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const agentType = task.subagentType
  const description = task.description
  const result = task.result
  const status = task.status
  const session = task.session

  // Auto-scroll to result when it arrives
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [result])

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const statusConfig = {
    pending: {
      dot: 'bg-amber-400 animate-pulse',
      label: 'Queued',
      badge: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    running: {
      dot: 'bg-accent animate-pulse',
      label: 'Running…',
      badge: 'bg-accent/10 text-accent border-accent/30'
    },
    completed: {
      dot: 'bg-emerald-400',
      label: 'Completed',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    },
    error: {
      dot: 'bg-red-400',
      label: 'Error',
      badge: 'bg-red-50 text-red-700 border-red-200'
    }
  }[status] ?? {
    dot: 'bg-gray-400',
    label: 'Unknown',
    badge: 'bg-surface-100 text-gray-600 border-surface-200'
  }

  const sessionMessages = session?.messages || []
  const executionTurns = sessionMessages.filter((m) => m.role !== 'user')

  return (
    <div
      id={`subagent-pane-${toolCallId}`}
      className="flex flex-col h-full bg-surface-50 animate-in slide-in-from-right duration-200"
    >
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200 bg-white/80 backdrop-blur-sm shrink-0">
        <button
          id="subagent-back-btn"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors group cursor-pointer focus:outline-none"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="group-hover:-translate-x-0.5 transition-transform"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Back</span>
        </button>

        <div className="w-px h-4 bg-surface-200" />

        {/* Agent identity */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent/15 text-accent shrink-0">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
            </svg>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-accent leading-none">
              {tool.name === 'dynamic_task' ? 'Dynamic Task' : 'Subagent Task'}
            </span>
            <span className="text-sm font-semibold text-gray-800 leading-tight truncate">
              {agentType}
            </span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Session turn count if available */}
        {sessionMessages.length > 0 ? (
          <span className="hidden sm:inline-block text-[11px] font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-md border border-accent/20">
            {sessionMessages.length} turns · {session?.toolCalls?.length || 0} tools
          </span>
        ) : (task.liveBlocks && task.liveBlocks.length > 0) ||
          (task.liveToolCalls && task.liveToolCalls.length > 0) ? (
          <span className="hidden sm:inline-block text-[11px] font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-md border border-accent/20 animate-pulse">
            {task.liveBlocks?.length || 0} blocks · {task.liveToolCalls?.length || 0} tools
          </span>
        ) : null}

        {/* Status pill */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${statusConfig.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
          <span>{statusConfig.label}</span>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-6">
          {/* 1. Task Objective / Prompt Card */}
          {description && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Task Objective
                </p>
              </div>
              <div className="bg-surface-100/60 border border-surface-200 rounded-xl px-4 py-3">
                <div
                  className="chat-markdown prose max-w-none text-sm wrap-break-word"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
                />
              </div>
            </div>
          )}

          {/* 2. Nested Subagent Execution Stream */}
          {executionTurns.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 border-b border-surface-200 pb-2">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Execution Trace ({executionTurns.length} turns)
                </p>
              </div>

              <div className="space-y-4 pl-2 border-l-2 border-accent/30 ml-2">
                {executionTurns.map((msg, mIdx) => (
                  <div key={msg.id || mIdx} className="space-y-3">
                    {/* Blocks in order (reasoning, tool calls, text) */}
                    {msg.blocks && msg.blocks.length > 0 ? (
                      msg.blocks.map((block, bIdx) => {
                        if (block.type === 'reasoning') {
                          return (
                            <ReasoningCard
                              key={`reasoning-${bIdx}`}
                              content={block.content}
                              isStreaming={false}
                            />
                          )
                        }
                        if (block.type === 'tool') {
                          const subTool =
                            msg.toolCalls?.find((t) => t.id === block.toolId) ||
                            session?.toolCalls?.find((t) => t.id === block.toolId)
                          return subTool ? (
                            <div key={`tool-${bIdx}`} className="py-1">
                              <ToolCallCard tool={subTool} />
                            </div>
                          ) : null
                        }
                        if (block.type === 'text' && block.content.trim()) {
                          return (
                            <div
                              key={`text-${bIdx}`}
                              className="chat-markdown prose max-w-none text-sm wrap-break-word bg-white/80 p-3 rounded-lg border border-surface-200"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content) }}
                            />
                          )
                        }
                        return null
                      })
                    ) : (
                      <>
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="space-y-2">
                            {msg.toolCalls.map((subTool) => (
                              <ToolCallCard key={subTool.id} tool={subTool} />
                            ))}
                          </div>
                        )}
                        {msg.content && msg.content.trim() && (
                          <div
                            className="chat-markdown prose max-w-none text-sm wrap-break-word"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2b. Live Streaming Trace (while actively running before session is finalized) */}
          {executionTurns.length === 0 && task.liveBlocks && task.liveBlocks.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 border-b border-surface-200 pb-2">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent animate-pulse"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Live Execution Trace ({task.liveBlocks.length} blocks)
                </p>
              </div>

              <div className="space-y-4 pl-2 border-l-2 border-accent/30 ml-2">
                {task.liveBlocks.map((block, bIdx) => {
                  if (block.type === 'reasoning') {
                    return (
                      <ReasoningCard
                        key={`live-reasoning-${bIdx}`}
                        content={block.content}
                        isStreaming={
                          status === 'running' && bIdx === (task.liveBlocks?.length ?? 0) - 1
                        }
                      />
                    )
                  }
                  if (block.type === 'tool') {
                    const subTool = task.liveToolCalls?.find((t) => t.id === block.toolId)
                    return subTool ? (
                      <div key={`live-tool-${bIdx}`} className="py-1">
                        <ToolCallCard tool={subTool} />
                      </div>
                    ) : null
                  }
                  if (block.type === 'text' && block.content.trim()) {
                    return (
                      <div
                        key={`live-text-${bIdx}`}
                        className="chat-markdown prose max-w-none text-sm wrap-break-word bg-white/80 p-3 rounded-lg border border-surface-200"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content) }}
                      />
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )}

          {/* 3. Final Synthesized Report Section */}
          {result && (
            <div ref={resultRef} className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-500"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Synthesized Report
                  </p>
                </div>

                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 transition-colors cursor-pointer focus:outline-none"
                  title="Copy report to clipboard"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              <div className="bg-white border border-surface-200 rounded-xl p-4 sm:p-5 shadow-sm">
                {/* Agent avatar row */}
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-surface-100">
                  <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 capitalize">
                    {agentType}
                  </span>
                  <span className="text-[10px] text-emerald-700 font-mono bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded ml-1">
                    Final Report
                  </span>
                  {task?.completedAt && (
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {new Date(task.completedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div
                  className="chat-markdown prose max-w-none text-sm sm:text-base wrap-break-word"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SubagentStreamPane
