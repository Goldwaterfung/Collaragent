import React from 'react'

export interface AlternateBranch {
  headBundleId: string
  label?: string
  createdAt: string
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

  return (
    <div
      className="flex items-center gap-3 my-2 text-xs text-[var(--ev-c-text-3)]"
      role="separator"
      aria-label="Checkpoint"
      title={
        createdAt
          ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : undefined
      }
    >
      <div className="flex-1 border-t border-dashed border-surface-200" />
      <div className="flex items-center gap-2">
        {displayLabel && (
          <span className="text-[10px] tracking-wide uppercase text-[var(--ev-c-text-2)] opacity-70">
            {displayLabel}
          </span>
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
          className="px-2.5 py-0.5 rounded-full border border-surface-200 bg-surface-50 text-[11px] font-medium text-[var(--ev-c-text-2)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-100 hover:border-surface-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Restore
        </button>
        {alternateBranches && alternateBranches.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1">
            {alternateBranches.map((branch, idx) => {
              const bTime = new Date(branch.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })
              return (
                <button
                  key={branch.headBundleId}
                  type="button"
                  onClick={() =>
                    onSelectBranch
                      ? onSelectBranch(branch.headBundleId)
                      : onRestore(branch.headBundleId)
                  }
                  disabled={disabled}
                  title={`Switch to alternate branch created at ${bTime}`}
                  className="px-2 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-[11px] font-medium text-primary hover:bg-primary/10 hover:border-primary/50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
                >
                  <span aria-hidden="true">🔀</span>
                  <span>Branch {idx + 2}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex-1 border-t border-dashed border-surface-200" />
    </div>
  )
}
