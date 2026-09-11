import React from 'react'
import { BranchStepper } from './BranchStepper'
import type { BranchPreviewItem } from './BranchPreviewPopover'

export interface UserMessageCardProps {
  content: string
  timestamp: Date | number
  renderContent: (content: string) => React.ReactNode
  branches?: BranchPreviewItem[]
  disabled?: boolean
  anchorBundleId?: string
  restoreContent?: string
  onRestore?: (bundleId: string, restoreContent?: string) => void
  onSelectBranch?: (bundleId: string) => void
}

export const UserMessageCard: React.FC<UserMessageCardProps> = ({
  content,
  timestamp,
  renderContent,
  branches,
  disabled,
  anchorBundleId,
  restoreContent,
  onRestore,
  onSelectBranch
}) => {
  const timeStr = new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="bg-surface-100/50 border border-surface-200/50 rounded-xl px-4 py-3 group relative transition-colors">
      <div className="space-y-4">{renderContent(content)}</div>

      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-surface-200/30 text-[11px]">
        <div className="flex items-center gap-2 min-h-[20px]">
          {branches && branches.length > 1 && onSelectBranch && (
            <BranchStepper
              branches={branches}
              disabled={disabled}
              onSelectBranch={onSelectBranch}
            />
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono text-[var(--ev-c-text-3)] opacity-70">
            {timeStr}
          </span>

          {anchorBundleId && onRestore && (
            <button
              type="button"
              onClick={() => onRestore(anchorBundleId, restoreContent || content)}
              title={
                restoreContent || content
                  ? `Restore to this checkpoint and re-draft "${(restoreContent || content).slice(0, 30)}..."`
                  : 'Restore to this checkpoint and re-draft'
              }
            >
              Restore
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
