import React, { useState } from 'react'
import { BrainIcon } from '../../assets/icons/BrainIcon'
import { ChevronDownIcon } from '../../assets/icons/ChevronDownIcon'
import { ChevronRightIcon } from '../../assets/icons/ChevronRightIcon'
import { renderMarkdown } from '../../utils/markdown'

interface ReasoningCardProps {
  content: string
  isStreaming?: boolean
}

export const ReasoningCard: React.FC<ReasoningCardProps> = ({ content, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="bg-surface-50 rounded-lg border border-surface-200 overflow-hidden my-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-surface-100 transition-colors cursor-pointer focus:outline-none"
      >
        {isExpanded ? (
          <ChevronDownIcon className="w-4 h-4" />
        ) : (
          <ChevronRightIcon className="w-4 h-4" />
        )}
        <BrainIcon className={`w-4 h-4 ${isStreaming ? 'animate-pulse text-accent' : ''}`} />
        <span>{isStreaming ? 'Thinking...' : 'Thought Process'}</span>
      </button>
      {isExpanded && (
        <div className="px-4 py-3 text-sm text-gray-700 border-t border-surface-200 max-h-96 overflow-y-auto">
          <div
            className="chat-markdown prose prose-sm max-w-none wrap-break-word"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      )}
    </div>
  )
}

export default ReasoningCard
