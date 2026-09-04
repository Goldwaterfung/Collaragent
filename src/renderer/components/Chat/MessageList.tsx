import React from 'react'
import { renderMarkdown } from '../../utils/markdown'
import { ChatMessage } from '../../types/ui'
import ToolCallCard from './ToolCallCard'
import ReasoningCard from './ReasoningCard'
import { CheckpointMarker } from './CheckpointMarker'
import type { CheckpointBundleSummary } from '@shared/ipc/checkpoints/types'
import ProgressContainer from './ProgressContainer'
import { groupBlocksByTodos } from './groupBlocks'

type MessageListProps = {
  messages: ChatMessage[]
  checkpointBundles: CheckpointBundleSummary[]
  checkpointBusy?: boolean
  onRestoreCheckpoint: (bundleId: string, restoreContent?: string) => void
  onSystemAction?: (input: string) => void
  onOpenSubagentTask?: (toolCallId: string) => void
}

const MessageListComponent: React.FC<MessageListProps> = ({
  messages,
  checkpointBundles,
  checkpointBusy,
  onRestoreCheckpoint,
  onSystemAction,
  onOpenSubagentTask
}) => {
  const renderContent = (content: string) => (
    <div
      className="chat-markdown prose max-w-none text-sm sm:text-base wrap-break-word"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  )

  const bundleByBoundary = new Map<string, CheckpointBundleSummary>()
  const sortedBundles = [...checkpointBundles].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
  for (const bundle of sortedBundles) {
    const boundaryKey = bundle.chatMessageId || '__start__'
    if (!bundleByBoundary.has(boundaryKey)) {
      bundleByBoundary.set(boundaryKey, bundle)
    }
  }

  const items: React.ReactNode[] = []

  const findBoundaryMessageId = (startIndex: number) => {
    for (let i = startIndex; i >= 0; i -= 1) {
      if (messages[i].role !== 'system') {
        return messages[i].id
      }
    }
    return undefined
  }

  messages.forEach((msg, index) => {
    if (msg.role === 'user') {
      const boundaryMessageId = index === 0 ? undefined : findBoundaryMessageId(index - 1)
      const boundaryKey = boundaryMessageId || '__start__'
      const bundle = bundleByBoundary.get(boundaryKey)

      if (bundle) {
        items.push(
          <CheckpointMarker
            key={`checkpoint-${bundle.id}`}
            bundleId={bundle.id}
            restoreContent={msg.content}
            disabled={checkpointBusy}
            onRestore={onRestoreCheckpoint}
          />
        )
      }
    }

    const groupedBlocks =
      msg.role === 'assistant' ? groupBlocksByTodos(msg.blocks, msg.toolCalls) : []

    items.push(
      <div
        key={msg.id}
        className={`${msg.role === 'user' ? 'bg-surface-100/50 border border-surface-200/50 rounded-xl px-4 py-3' : 'py-2 border-b border-surface-100/50'}`}
      >
        <div className="space-y-4">
          {msg.role === 'user' && renderContent(msg.content)}
          {msg.role === 'system' && renderContent(msg.content)}
          {msg.role === 'assistant' &&
            groupedBlocks.map((group, gIdx) => (
              <ProgressContainer key={gIdx} inProgressTodos={group.inProgressTodos}>
                <div className="space-y-4">
                  {group.blocks.map((block, i) =>
                    block.type === 'text' ? (
                      <div key={i}>{renderContent(block.content)}</div>
                    ) : block.type === 'reasoning' ? (
                      <ReasoningCard key={i} content={block.content} />
                    ) : (
                      (() => {
                        const tool = msg.toolCalls?.find((t) => t.id === block.toolId)
                        return tool ? (
                          <ToolCallCard
                            key={i}
                            tool={tool}
                            onOpenSubagentTask={onOpenSubagentTask}
                          />
                        ) : null
                      })()
                    )
                  )}
                </div>
              </ProgressContainer>
            ))}
          {msg.role === 'system' && msg.actions && msg.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {msg.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="px-3 py-1 text-xs font-semibold rounded bg-white text-black hover:bg-surface-100"
                  onClick={() => onSystemAction?.(action.input)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="text-[10px] text-gray-400 mt-3 text-right opacity-70">
          {new Date(msg.timestamp).toLocaleTimeString()}
        </div>
      </div>
    )
  })

  return <div className="space-y-6">{items}</div>
}

export const MessageList = React.memo(MessageListComponent)
