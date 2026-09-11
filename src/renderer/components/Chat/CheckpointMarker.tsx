import React from 'react'
import { BranchStepper } from './BranchStepper'
import type { BranchPreviewItem } from './BranchPreviewPopover'

export interface AlternateBranch {
  headBundleId: string
  label?: string
  createdAt: string
  promptSnippet?: string
}

export interface CheckpointMarkerProps {
  bundleId: string
  restoreContent?: string
  disabled?: boolean
  label?: string
  createdAt?: string
  alternateBranches?: AlternateBranch[]
  onRestore: (bundleId: string, restoreContent?: string) => void
  onSelectBranch?: (bundleId: string) => void
}

export const CheckpointMarker: React.FC<CheckpointMarkerProps> = ({
  bundleId,
  restoreContent,
  disabled,
  label,
  createdAt,
  alternateBranches,
  onRestore,
  onSelectBranch
}) => {
  const isTurnCheckpoint = label?.trim().toLowerCase() === 'turn checkpoint'
  const displayLabel = isTurnCheckpoint ? undefined : label

  // Build branch preview items for the stepper if multiple branches exist
  const branchItems: BranchPreviewItem[] = []
  if (alternateBranches && alternateBranches.length > 0) {
    // Branch 1 is the active branch at this checkpoint
    branchItems.push({
      headBundleId: bundleId,
      createdAt: createdAt || new Date().toISOString(),
      label: displayLabel || 'Initial state',
      promptSnippet: restoreContent,
      isActive: true
    })
    // Subsequent branches are the alternates
    alternateBranches.forEach((b) => {
      branchItems.push({
        headBundleId: b.headBundleId,
        createdAt: b.createdAt,
        label: b.label,
        promptSnippet: b.promptSnippet,
        isActive: false
      })
    })

    branchItems.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.headBundleId.localeCompare(b.headBundleId)
    )
  }

  const timeStr = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : undefined

  return (
    <div
      className="flex items-center justify-between py-1 px-3 rounded-lg border border-surface-200/40 bg-surface-100/20 text-xs text-[var(--ev-c-text-3)] my-2"
      role="separator"
      aria-label={displayLabel || 'Checkpoint'}
    >
      <div className="flex items-center gap-2">
        {displayLabel && (
          <span className="text-[10px] font-mono tracking-wider uppercase text-[var(--ev-c-text-2)] opacity-80">
            {displayLabel}
          </span>
        )}
        {timeStr && (
          <span className="text-[10px] font-mono text-[var(--ev-c-text-3)] opacity-60">
            {timeStr}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {branchItems.length > 1 && onSelectBranch && (
          <BranchStepper
            branches={branchItems}
            disabled={disabled}
            onSelectBranch={onSelectBranch}
          />
        )}

        <button
          type="button"
          onClick={() => onRestore(bundleId, restoreContent)}
          disabled={disabled}
          title={
            restoreContent
              ? `Restore to this checkpoint and re-draft "${restoreContent.slice(0, 30)}..."`
              : 'Restore to this checkpoint'
          }
          className="px-2 py-0.5 rounded border border-surface-200/80 bg-surface-50 text-[11px] font-medium text-[var(--ev-c-text-2)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-100 hover:border-surface-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Restore
        </button>
      </div>
    </div>
  )
}
