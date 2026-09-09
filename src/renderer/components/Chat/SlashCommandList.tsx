import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { SkillEntry } from '@shared/ipc/skills/types'
import { SkillIcon } from '../../assets/icons/SkillIcon'

export interface SlashCommandListProps {
  suggestions: SkillEntry[]
  selectedIndex: number
  onSelect: (item: SkillEntry) => void
  position: { top?: number; bottom?: number; left: number }
}

export function SlashCommandList({
  suggestions,
  selectedIndex,
  onSelect,
  position
}: SlashCommandListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (suggestions.length === 0) return null

  return createPortal(
    <div
      className="fixed z-[9999] w-80 max-h-64 overflow-y-auto bg-[var(--color-surface-50)] border border-[var(--color-surface-200)] rounded-lg shadow-xl flex flex-col py-1 font-sans text-base antialiased custom-scrollbar"
      style={{
        top: position.top,
        bottom: position.bottom,
        left: position.left
      }}
      ref={listRef}
    >
      {suggestions.map((item, index) => {
        const isSelected = index === selectedIndex
        const isBuiltin = item.sourcePath === 'builtin'

        return (
          <button
            key={item.name}
            className={`
              w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors text-xs shrink-0 cursor-pointer
              ${
                isSelected
                  ? 'bg-[var(--color-primary)] text-[var(--ev-c-black)]'
                  : 'text-[var(--ev-c-text-1)] hover:bg-[var(--color-surface-100)]'
              }
            `}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSelect(item)
            }}
            onMouseDown={(e) => {
              // Prevent focus loss on click
              e.preventDefault()
            }}
          >
            <span
              className={`shrink-0 mt-0.5 ${isSelected ? 'text-black' : 'text-[var(--ev-c-text-2)]'}`}
            >
              <SkillIcon width={14} height={14} />
            </span>
            <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate font-semibold tracking-tight">/{item.name}</span>
                <span
                  className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    isSelected
                      ? 'bg-black/15 text-black'
                      : isBuiltin
                        ? 'bg-[var(--color-surface-200)] text-[var(--ev-c-text-2)]'
                        : 'bg-primary/20 text-primary'
                  }`}
                >
                  {isBuiltin ? 'Builtin' : 'Custom'}
                </span>
              </div>
              <span
                className={`text-[11px] line-clamp-2 mt-0.5 leading-relaxed ${
                  isSelected ? 'text-black/80' : 'text-[var(--ev-c-text-3)]'
                }`}
              >
                {item.description}
              </span>
            </div>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
