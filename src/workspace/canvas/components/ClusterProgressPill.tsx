import React from 'react'
import type { ClusteringProgress } from '../types'
import { CLUSTER_PILL_Z_INDEX, CLUSTER_PROGRESS_MAX_WIDTH_PX } from '@shared/constants'

interface ClusterProgressPillProps {
  progress: ClusteringProgress
  onCancel: () => void
}

function getProgressStageLabel(progress: ClusteringProgress): string {
  if (progress.message) return progress.message

  switch (progress.stage) {
    case 'clone':
      return 'Preparing graph snapshot...'
    case 'validate':
      return 'Validating network...'
    case 'adapt':
      return 'Building network model...'
    case 'run':
      return typeof progress.level === 'number'
        ? `Detecting communities (Pass ${progress.level + 1})...`
        : 'Running Leiden algorithm...'
    case 'stamp':
      return 'Stamping cluster assignments...'
    case 'layout':
      return 'Computing hierarchical layout...'
    case 'done':
      return 'Clustering complete'
    case 'error':
      return progress.error || 'Clustering failed'
    default:
      return 'Processing graph clusters...'
  }
}

export const ClusterProgressPill: React.FC<ClusterProgressPillProps> = ({ progress, onCancel }) => {
  const isError = progress.stage === 'error'
  const label = getProgressStageLabel(progress)

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ zIndex: CLUSTER_PILL_Z_INDEX }}
      className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-surface-200 bg-white shadow-lg text-xs text-gray-700 font-medium select-none pointer-events-auto"
    >
      {isError ? (
        <div className="w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
          !
        </div>
      ) : (
        <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      <span className="truncate" style={{ maxWidth: `${CLUSTER_PROGRESS_MAX_WIDTH_PX}px` }}>
        {label}
      </span>
      <button
        type="button"
        onClick={onCancel}
        title={isError ? 'Dismiss error notification' : 'Cancel clustering computation'}
        className="ml-1 px-2 py-0.5 text-[11px] font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer focus:outline-none"
      >
        {isError ? 'Dismiss' : 'Cancel'}
      </button>
    </div>
  )
}
