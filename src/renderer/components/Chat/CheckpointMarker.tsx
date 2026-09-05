import React from 'react'

export interface CheckpointMarkerProps {
  bundleId: string
  restoreContent?: string
  disabled?: boolean
  label?: string
  createdAt?: string
  onRestore: (bundleId: string, restoreContent?: string) => void
}

export const CheckpointMarker: React.FC<CheckpointMarkerProps> = ({
  bundleId,
  restoreContent,
  disabled,
  label,
  createdAt,
  onRestore
}) => {
  const formattedTime = createdAt
    ? new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : undefined

  return (
    <div
      className="flex items-center gap-3 my-2 text-xs text-[var(--ev-c-text-3)]"
      role="separator"
      aria-label="Checkpoint"
    >
      <div className="flex-1 border-t border-dashed border-surface-200" />
      <div className="flex items-center gap-2">
        {label && (
          <span className="text-[10px] tracking-wide uppercase text-[var(--ev-c-text-2)] opacity-70">
            {label}
          </span>
        )}
        {formattedTime && (
          <span className="text-[10px] text-[var(--ev-c-text-3)] opacity-70">{formattedTime}</span>
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
      </div>
      <div className="flex-1 border-t border-dashed border-surface-200" />
    </div>
  )
}
