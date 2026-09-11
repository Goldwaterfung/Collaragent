import React, { useRef, useState } from 'react'
import { ChevronLeftIcon } from '../../assets/icons/ChevronLeftIcon'
import { ChevronRightIcon } from '../../assets/icons/ChevronRightIcon'
import { BranchPreviewPopover, type BranchPreviewItem } from './BranchPreviewPopover'

export interface BranchStepperProps {
  branches: BranchPreviewItem[]
  disabled?: boolean
  onSelectBranch: (bundleId: string) => void
}

export const BranchStepper: React.FC<BranchStepperProps> = ({
  branches,
  disabled,
  onSelectBranch
}) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  if (!branches || branches.length <= 1) {
    return null
  }

  const activeIndex = branches.findIndex((b) => b.isActive)
  const currentIndex = activeIndex >= 0 ? activeIndex : 0
  const total = branches.length

  const handlePrev = () => {
    if (currentIndex > 0 && !disabled) {
      const target = branches[currentIndex - 1]
      if (target && !target.isActive) {
        onSelectBranch(target.headBundleId)
      }
    }
  }

  const handleNext = () => {
    if (currentIndex < total - 1 && !disabled) {
      const target = branches[currentIndex + 1]
      if (target && !target.isActive) {
        onSelectBranch(target.headBundleId)
      }
    }
  }

  return (
    <div className="relative inline-flex items-center gap-0.5 text-xs text-[var(--ev-c-text-2)]">
      <button
        type="button"
        onClick={handlePrev}
        disabled={disabled || currentIndex === 0}
        aria-label="Previous branch"
        className="p-1 rounded text-[var(--ev-c-text-3)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-200/60 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeftIcon width={13} height={13} strokeWidth={2} />
      </button>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsPopoverOpen((prev) => !prev)}
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        aria-label="View turn branches"
        disabled={disabled}
        className="px-1.5 py-0.5 font-mono text-[11px] text-[var(--ev-c-text-2)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-200/50 rounded transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 cursor-pointer"
      >
        {currentIndex + 1} / {total}
      </button>

      <button
        type="button"
        onClick={handleNext}
        disabled={disabled || currentIndex === total - 1}
        aria-label="Next branch"
        className="p-1 rounded text-[var(--ev-c-text-3)] hover:text-[var(--ev-c-text-1)] hover:bg-surface-200/60 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRightIcon width={13} height={13} strokeWidth={2} />
      </button>

      {isPopoverOpen && (
        <BranchPreviewPopover
          branches={branches}
          anchorRef={triggerRef}
          onSelectBranch={onSelectBranch}
          onClose={() => setIsPopoverOpen(false)}
        />
      )}
    </div>
  )
}
