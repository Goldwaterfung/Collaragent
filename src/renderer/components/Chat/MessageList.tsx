import React from 'react'
import { renderMarkdown, parseContentSegments } from '../../utils/markdown'
import { ChatMessage } from '../../types/ui'
import ToolCallCard from './ToolCallCard'
import ReasoningCard from './ReasoningCard'
import { CheckpointMarker, type AlternateBranch } from './CheckpointMarker'
import { CHECKPOINT_START_SENTINEL } from '@shared/checkpoints/types'
import type { CheckpointBundleSummary } from '@shared/ipc/checkpoints/types'
import ProgressContainer from './ProgressContainer'
import { groupBlocksByTodos } from './groupBlocks'
import { ChatErrorBoundary } from './ChatErrorBoundary'
import { MermaidDiagram } from './MermaidDiagram'
import { SkillIcon } from '../../assets/icons/SkillIcon'

const SKILL_TAG_REGEX =
  /^<SKILL>The user requested you read and use the "([^"]+)" skill\. The path to the skill file is:\s*([^<]+)<\/SKILL>\s*([\s\S]*)$/

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
  const renderContent = (content: string) => {
    let skillHeader: React.ReactNode = null
    let displayContent = content

    const skillMatch = content.match(SKILL_TAG_REGEX)
    if (skillMatch) {
      const skillName = skillMatch[1]
      displayContent = skillMatch[3].trim()
      skillHeader = (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/20 text-primary border border-primary/30">
            <SkillIcon width={12} height={12} />/{skillName}
          </span>
        </div>
      )
    }

    const segments = parseContentSegments(displayContent)
    return (
      <ChatErrorBoundary fallbackContent={displayContent}>
        {skillHeader}
        <div className="space-y-3">
          {segments.map((seg, idx) =>
            seg.type === 'mermaid' ? (
              <MermaidDiagram key={idx} code={seg.code} />
            ) : (
              <div
                key={idx}
                className="chat-markdown prose max-w-none text-sm sm:text-base wrap-break-word"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
              />
            )
          )}
        </div>
      </ChatErrorBoundary>
    )
  }

  const messageIds = new Set(messages.map((m) => m.id))

  let startBundle: CheckpointBundleSummary | undefined = undefined
  const bundleByMessageId = new Map<string, CheckpointBundleSummary>()

  const sortedBundles = [...checkpointBundles].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )

  for (const bundle of sortedBundles) {
    if (bundle.reason === 'restore') {
      // Internal auto-restore snapshots are never rendered as chat timeline markers
      continue
    }

    const messageId = bundle.chatMessageId
    if (!messageId || messageId === '__start__' || messageId === CHECKPOINT_START_SENTINEL) {
      startBundle = bundle
    } else if (messageIds.has(messageId)) {
      bundleByMessageId.set(messageId, bundle)
    }
    // Checkpoints referencing messages that are no longer in `messages` belonged
    // to rolled-back branches and must not be anchored to earlier remaining messages.
  }

  // 1. Identify which bundles are active (on the currently rendered active lineage path)
  const activeBundleIds = new Set<string>()
  if (startBundle) activeBundleIds.add(startBundle.id)
  for (const b of bundleByMessageId.values()) {
    activeBundleIds.add(b.id)
  }

  // 2. Index valid bundles by id
  const bundleMap = new Map<string, CheckpointBundleSummary>()
  const validBundles = sortedBundles.filter((b) => b.reason !== 'restore')
  for (const b of validBundles) {
    bundleMap.set(b.id, b)
  }

  // 3. Identify leaves among inactive bundles
  const parentBundleIdSet = new Set<string>()
  for (const b of validBundles) {
    if (b.parentBundleId) {
      parentBundleIdSet.add(b.parentBundleId)
    }
  }

  const inactiveLeaves = validBundles.filter(
    (b) => !activeBundleIds.has(b.id) && !parentBundleIdSet.has(b.id)
  )

  // 4. Map each inactive leaf to its closest active divergence anchor bundle
  const alternateBranchesByAnchor = new Map<string, AlternateBranch[]>()
  for (const leaf of inactiveLeaves) {
    let curr: CheckpointBundleSummary | undefined = leaf
    while (curr && !activeBundleIds.has(curr.id)) {
      if (!curr.parentBundleId) break
      const parent: CheckpointBundleSummary | undefined = bundleMap.get(curr.parentBundleId)
      if (!parent) break
      if (activeBundleIds.has(parent.id)) {
        const list = alternateBranchesByAnchor.get(parent.id) ?? []
        list.push({
          headBundleId: leaf.id,
          label: leaf.label,
          createdAt: leaf.createdAt
        })
        alternateBranchesByAnchor.set(parent.id, list)
        break
      }
      curr = parent
    }
  }

  const findNextUserMessage = (fromIndex: number): ChatMessage | undefined => {
    for (let i = fromIndex; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        return messages[i]
      }
    }
    return undefined
  }

  const items: React.ReactNode[] = []

  if (startBundle) {
    items.push(
      <CheckpointMarker
        key={`checkpoint-${startBundle.id}`}
        bundleId={startBundle.id}
        label={startBundle.label}
        createdAt={startBundle.createdAt}
        restoreContent={findNextUserMessage(0)?.content}
        disabled={checkpointBusy}
        alternateBranches={alternateBranchesByAnchor.get(startBundle.id)}
        onRestore={onRestoreCheckpoint}
      />
    )
  }

  messages.forEach((msg, index) => {
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
                  className="px-3 py-1 text-xs font-semibold rounded bg-surface-100 text-[var(--ev-c-text-1)] border border-surface-200 hover:bg-surface-200 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
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

    const bundle = bundleByMessageId.get(msg.id)
    if (bundle) {
      items.push(
        <CheckpointMarker
          key={`checkpoint-${bundle.id}`}
          bundleId={bundle.id}
          label={bundle.label}
          createdAt={bundle.createdAt}
          restoreContent={findNextUserMessage(index + 1)?.content}
          disabled={checkpointBusy}
          alternateBranches={alternateBranchesByAnchor.get(bundle.id)}
          onRestore={onRestoreCheckpoint}
        />
      )
    }
  })

  return <div className="space-y-6">{items}</div>
}

export const MessageList = React.memo(MessageListComponent)
