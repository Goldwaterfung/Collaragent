import React, { useState } from 'react'
import { ToolCall } from './types'
import { useChatStore } from '../../store/chatStore'

import { parseSubagentTaskFromToolCall } from './subagentUtils'

interface Props {
  tool: ToolCall
  onOpen: (toolCallId: string) => void
}

const STATUS_CONFIG = {
  pending: {
    label: 'Queued',
    dotClass: 'bg-amber-400 animate-pulse',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  running: {
    label: 'Running',
    dotClass: 'bg-accent animate-pulse',
    badgeClass: 'bg-accent/10 text-accent border-accent/30'
  },
  completed: {
    label: 'Done',
    dotClass: 'bg-emerald-400',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  error: {
    label: 'Error',
    dotClass: 'bg-red-400',
    badgeClass: 'bg-red-50 text-red-700 border-red-200'
  }
}

export const SubagentTaskCard: React.FC<Props> = ({ tool, onOpen }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const storeTask = useChatStore((s) => s.subagentTasks[tool.id])
  const parsedTask = React.useMemo(() => parseSubagentTaskFromToolCall(tool), [tool])

  const task = storeTask || parsedTask
  const agentType = task.subagentType
  const description = task.description
  const status = task.status
  const result = task.result
  const session = task.session

  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending

  return (
    <div className="group relative bg-white/50 border border-surface-200 rounded-xl overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2.5 gap-3">
        {/* Left: icon + labels */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Subagent icon */}
          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-accent/15 text-accent">
            <svg
              width="15"
              height="15"
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

          {/* Label stack */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-accent leading-none">
                {tool.name === 'dynamic_task' ? 'Dynamic Task' : 'Subagent Task'}
              </span>
              <span className="text-[10px] text-gray-400">·</span>
              <span className="text-[10px] font-mono text-gray-500 leading-none">{agentType}</span>
              {session?.messages && session.messages.length > 0 ? (
                <>
                  <span className="text-[10px] text-gray-400">·</span>
                  <span className="text-[10px] font-mono font-medium text-accent leading-none">
                    {session.messages.length} turns · {session.toolCalls?.length || 0} tools
                  </span>
                </>
              ) : (task.liveBlocks && task.liveBlocks.length > 0) ||
                (task.liveToolCalls && task.liveToolCalls.length > 0) ? (
                <>
                  <span className="text-[10px] text-gray-400">·</span>
                  <span className="text-[10px] font-mono font-medium text-accent leading-none animate-pulse">
                    {task.liveBlocks?.length || 0} steps · {task.liveToolCalls?.length || 0} tools
                  </span>
                </>
              ) : null}
            </div>
            {description && (
              <p className="text-sm font-medium text-gray-800 leading-snug mt-0.5 truncate max-w-xs sm:max-w-sm md:max-w-md">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Right: status badge + buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Status badge */}
          <span
            className={`hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cfg.badgeClass}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
          </span>

          {/* Expand toggle (show result preview) */}
          {result && (
            <button
              onClick={() => setIsExpanded((v) => !v)}
              className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors px-1 cursor-pointer focus:outline-none"
              title={isExpanded ? 'Collapse result' : 'Preview result'}
            >
              {isExpanded ? '▲' : '▼'}
            </button>
          )}

          {/* View Task CTA */}
          <button
            id={`subagent-view-${tool.id}`}
            onClick={() => onOpen(tool.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-100 hover:bg-surface-200 border border-surface-200 text-gray-800 text-[11px] font-medium transition-all duration-150 active:scale-95 cursor-pointer focus:outline-none"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View Task
          </button>
        </div>
      </div>

      {/* Collapsible result preview */}
      {isExpanded && result && (
        <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-150 border-t border-surface-200 pt-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
            Result Summary
          </p>
          <p className="text-xs text-gray-700 leading-relaxed line-clamp-5">{result}</p>
          {result.length > 300 && (
            <button
              onClick={() => onOpen(tool.id)}
              className="mt-1.5 text-[11px] text-accent hover:underline cursor-pointer focus:outline-none"
            >
              View full result →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default SubagentTaskCard

export function isSubagentTaskTool(name: string): name is 'task' | 'dynamic_task' {
  return name === 'task' || name === 'dynamic_task'
}
