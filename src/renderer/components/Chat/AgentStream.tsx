import React, { useEffect, useState, useMemo } from 'react'
import { AgentStreamProps } from '../../types/ui'
import { renderMarkdown } from '../../utils/markdown'
import ToolCallCard from './ToolCallCard'
import ReasoningCard from './ReasoningCard'
import { LoadingIcon } from '../../assets/icons/LoadingIcon'
import ProgressContainer from './ProgressContainer'
import { groupBlocksByTodos } from './groupBlocks'
import { useChatStore } from '../../store/chatStore'
import { parseSubagentTaskFromToolCall } from './subagentUtils'

interface StreamedMarkdownProps {
  content: string
}

const StreamedMarkdown: React.FC<StreamedMarkdownProps> = ({ content }) => {
  return (
    <div
      className="chat-markdown prose max-w-none text-black wrap-break-word"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )
}

export const AgentStream: React.FC<AgentStreamProps> = ({
  isStreaming,
  currentNode,
  interrupt,
  toolCalls,
  blocks,
  onResume,
  onOpenSubagentTask
}) => {
  if (!isStreaming && !blocks?.length && !interrupt) return null

  const upsertSubagentTask = useChatStore((s) => s.upsertSubagentTask)

  // Sync tool calls that are task/dynamic_task into the subagentTasks store
  // so SubagentTaskCard and SubagentStreamPane can read status/result.
  useMemo(() => {
    if (!toolCalls) return
    for (const tc of toolCalls) {
      if (tc.name !== 'task' && tc.name !== 'dynamic_task') continue
      upsertSubagentTask(parseSubagentTaskFromToolCall(tc))
    }
  }, [toolCalls, upsertSubagentTask])

  const [statusIndex, setStatusIndex] = useState(0)

  useEffect(() => {
    if (!isStreaming) {
      setStatusIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % 2)
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [isStreaming])

  const groupedBlocks = useMemo(() => groupBlocksByTodos(blocks, toolCalls), [blocks, toolCalls])

  const streamingStatus = statusIndex === 0 ? 'Working...' : 'Generating...'

  const lastReasoningIndex = blocks
    ? [...blocks]
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.type === 'reasoning')
        .pop()?.i
    : undefined

  return (
    <div className="agent-stream py-4 space-y-4">
      <div className="flex items-center space-x-2 text-xs font-mono uppercase text-gray-500">
        <div className="w-6 h-6 flex items-center">
          <LoadingIcon
            width={20}
            height={20}
            isStreaming={isStreaming}
            className={isStreaming ? '' : interrupt ? 'opacity-95' : 'opacity-60'}
          />
        </div>
        <span>
          {interrupt
            ? 'Action Required'
            : isStreaming
              ? currentNode || streamingStatus
              : 'Finished'}
        </span>
      </div>

      {groupedBlocks.map((group, gIdx) => (
        <ProgressContainer key={gIdx} inProgressTodos={group.inProgressTodos}>
          <div className="space-y-4">
            {group.blocks.map((block, i) => {
              // Find absolute index in original blocks for animation logic
              const absIdx = blocks?.indexOf(block)
              return block.type === 'text' ? (
                <StreamedMarkdown key={i} content={block.content} />
              ) : block.type === 'reasoning' ? (
                <ReasoningCard
                  key={i}
                  content={block.content}
                  isStreaming={isStreaming && lastReasoningIndex === absIdx}
                />
              ) : (
                (() => {
                  const tool = toolCalls?.find((t) => t.id === block.toolId)
                  return tool ? (
                    <ToolCallCard key={i} tool={tool} onOpenSubagentTask={onOpenSubagentTask} />
                  ) : null
                })()
              )
            })}
          </div>
        </ProgressContainer>
      ))}

      {Boolean(interrupt) && onResume && (
        <div className="p-3 bg-yellow-50 rounded border border-yellow-200">
          <pre className="text-xs overflow-auto max-h-40 mb-3">
            {JSON.stringify(interrupt, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => onResume({ decisions: [{ type: 'approve' }] })}
              className="px-3 py-1 bg-green-600 text-white rounded text-sm"
            >
              Approve
            </button>
            <button
              onClick={() =>
                onResume({ decisions: [{ type: 'reject', message: 'User rejected' }] })
              }
              className="px-3 py-1 bg-red-600 text-white rounded text-sm"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
