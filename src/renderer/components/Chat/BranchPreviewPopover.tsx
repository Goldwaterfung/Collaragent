import React, { useEffect, useRef } from 'react'

export interface BranchPreviewItem {
  headBundleId: string
  createdAt: string
  label?: string
  promptSnippet?: string
  isActive?: boolean
}

export interface BranchPreviewPopoverProps {
  branches: BranchPreviewItem[]
  onSelectBranch: (bundleId: string) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

export const BranchPreviewPopover: React.FC<BranchPreviewPopoverProps> = ({
  branches,
  onSelectBranch,
  onClose,
  anchorRef
}) => {
  const popoverRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const popoverEl = popoverRef.current

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // If click was inside the popover or on the trigger button, do not dismiss here
      if (popoverEl?.contains(target) || anchorRef?.current?.contains(target)) {
        return
      }
      onClose()
    }

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        anchorRef?.current?.focus()
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      if (popoverEl?.contains(document.activeElement)) {
        anchorRef?.current?.focus()
      }
    }
  }, [onClose, anchorRef])

  // Focus active item on mount
  useEffect(() => {
    const activeIdx = branches.findIndex((b) => b.isActive)
    const targetIdx = activeIdx >= 0 ? activeIdx : 0
    itemRefs.current[targetIdx]?.focus()
  }, [branches])

  const handleItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIdx = (index + 1) % branches.length
      itemRefs.current[nextIdx]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIdx = (index - 1 + branches.length) % branches.length
      itemRefs.current[prevIdx]?.focus()
    }
  }

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Turn branches"
      className="absolute left-0 top-full mt-1.5 z-30 w-72 max-w-[calc(100vw-3rem)] bg-surface-50 border border-surface-200 rounded-lg shadow-md p-1 backdrop-blur-sm"
    >
      <div className="px-2 py-1 text-[10px] font-mono tracking-wider uppercase text-[var(--ev-c-text-3)] flex items-center justify-between border-b border-surface-200/40 mb-1">
        <span>Turn Branches</span>
        <span className="text-[9px] opacity-70">Esc</span>
      </div>

      <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar" role="listbox">
        {branches.map((branch, idx) => {
          const indexStr = String(idx + 1).padStart(2, '0')
          const timeStr = new Date(branch.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })

          return (
            <button
              key={branch.headBundleId}
              ref={(el) => {
                itemRefs.current[idx] = el
              }}
              type="button"
              role="option"
              aria-selected={branch.isActive}
              onClick={() => {
                if (branch.isActive) {
                  onClose()
                  anchorRef?.current?.focus()
                  return
                }
                onSelectBranch(branch.headBundleId)
                onClose()
              }}
              onKeyDown={(e) => handleItemKeyDown(e, idx)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors cursor-pointer flex flex-col gap-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                branch.isActive
                  ? 'bg-surface-100 text-[var(--ev-c-text-1)] border-l-2 border-primary'
                  : 'text-[var(--ev-c-text-2)] hover:bg-surface-100/70 hover:text-[var(--ev-c-text-1)]'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-[var(--ev-c-text-3)]">
                <span>
                  {indexStr} · {timeStr}
                </span>
                {branch.isActive && (
                  <span className="text-[9px] tracking-wider uppercase text-[var(--ev-c-text-2)] font-semibold">
                    Active
                  </span>
                )}
              </div>
              {branch.promptSnippet ? (
                <p className="text-xs text-[var(--ev-c-text-2)] line-clamp-2 leading-tight font-normal">
                  {branch.promptSnippet}
                </p>
              ) : branch.label && branch.label.toLowerCase() !== 'turn checkpoint' ? (
                <p className="text-xs text-[var(--ev-c-text-2)] line-clamp-2 leading-tight font-normal">
                  {branch.label}
                </p>
              ) : (
                <p className="text-xs text-[var(--ev-c-text-3)] italic line-clamp-1 leading-tight font-normal">
                  Branch {idx + 1}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
