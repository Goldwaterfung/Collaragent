import React, { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, type NodeKey } from 'lexical'
import type { ClaimRelation } from '@shared/wiki/types'

export interface ClaimBadgeComponentProps {
  badgeId: string
  targetEntityId: string
  rel: ClaimRelation
  justification?: string
  nodeKey?: NodeKey
}

const RELATION_STYLES: Record<
  ClaimRelation,
  {
    chip: string
    badge: string
    icon: string
  }
> = {
  supports: {
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
    icon: '⚡'
  },
  contradicts: {
    chip: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
    icon: '⚡'
  },
  supersedes: {
    chip: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    icon: '⚡'
  },
  details: {
    chip: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
    icon: '⚡'
  },
  derived_from: {
    chip: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
    icon: '⚡'
  },
  cites: {
    chip: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
    icon: '⚡'
  },
  relates_to: {
    chip: 'bg-surface-100 text-surface-700 border-surface-200 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:border-surface-700',
    badge: 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-200',
    icon: '⚡'
  }
}

export default function ClaimBadgeComponent({
  badgeId,
  targetEntityId,
  rel,
  justification = '',
  nodeKey
}: ClaimBadgeComponentProps): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)

  const styleConfig = RELATION_STYLES[rel] || RELATION_STYLES.relates_to

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsOpen((prev) => !prev)
  }, [])

  const handleJumpToCanvas = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      window.dispatchEvent(
        new CustomEvent('cagent:jump-to-canvas-node', {
          detail: { targetEntityId }
        })
      )
      setIsOpen(false)
    },
    [targetEntityId]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      if (nodeKey && editor) {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey)
          if (node) {
            node.remove()
          }
        })
      }
    },
    [editor, nodeKey]
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as globalThis.Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <span
      ref={containerRef}
      className="relative inline-block mx-0.5 align-baseline select-none"
      contentEditable={false}
      data-lexical-claim-badge="true"
      data-badge-id={badgeId}
      data-target-entity={targetEntityId}
      data-rel={rel}
      data-justification={justification}
    >
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border transition-colors cursor-pointer focus:outline-none ${styleConfig.chip}`}
        title={`${rel}: ${targetEntityId}${justification ? ` - ${justification}` : ''}`}
      >
        <span aria-hidden="true">{styleConfig.icon}</span>
        <span className="font-semibold">{rel}:</span>
        <span className="truncate max-w-40">{targetEntityId}</span>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 mt-1 left-0 w-72 rounded-lg border border-surface-200 bg-surface-50 p-3 shadow-xl dark:border-surface-700 dark:bg-surface-900 text-surface-900 dark:text-surface-100"
          role="dialog"
          aria-label={`Claim details for ${targetEntityId}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 border-b border-surface-200 dark:border-surface-750">
            <div className="flex items-center gap-1.5 truncate">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${styleConfig.badge}`}
              >
                {rel}
              </span>
              <span className="font-semibold text-xs truncate" title={targetEntityId}>
                {targetEntityId}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 p-0.5 rounded focus:outline-none"
              aria-label="Close popover"
            >
              ✕
            </button>
          </div>

          {justification ? (
            <div className="py-2 text-xs text-surface-600 dark:text-surface-300 leading-relaxed italic border-b border-surface-200/60 dark:border-surface-800">
              &ldquo;{justification}&rdquo;
            </div>
          ) : (
            <div className="py-2 text-xs text-surface-400 dark:text-surface-500 italic border-b border-surface-200/60 dark:border-surface-800">
              No justification provided
            </div>
          )}

          <div className="flex items-center justify-between pt-2 gap-2">
            <button
              type="button"
              onClick={handleJumpToCanvas}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-primary-600 text-white hover:bg-primary-700 transition-colors focus:outline-none cursor-pointer"
            >
              <span>↗</span>
              <span>Jump to Canvas</span>
            </button>

            {nodeKey && (
              <button
                type="button"
                onClick={handleDelete}
                className="text-xs text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 px-1.5 py-1 rounded transition-colors focus:outline-none cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  )
}
