import React, { useState, KeyboardEvent, useRef, useMemo, useEffect } from 'react'
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext'
import { Trie } from '@shared/algorithms/Trie'
import { useChatStore } from '../../store/chatStore'

import { MentionList, SuggestionItem } from './MentionList'
import { SlashCommandList } from './SlashCommandList'
import { useSkillsContext } from '@workspace/contexts/skills/SkillsContext'
import type { SkillEntry } from '@shared/ipc/skills/types'
import { StatsIcon } from '../../assets/icons/StatsIcon'
import { SendIcon } from '../../assets/icons/SendIcon'
import { StopIcon } from '../../assets/icons/StopIcon'
import { TokenStats } from './TokenStats'

interface MessageInputProps {
  onSendMessage: (message: string) => void
  onCancelMessage?: () => void
  disabled: boolean
}

/**
 * Calculates the coordinates of the caret in a textarea.
 * This is a simplified version of techniques used in libraries like textarea-caret.
 */
const getCaretCoordinates = (element: HTMLTextAreaElement, position: number) => {
  const div = document.createElement('div')
  const style = window.getComputedStyle(element)

  // Copy relevant styles
  const properties = [
    'direction',
    'boxSizing',
    'width',
    'height',
    'overflowX',
    'overflowY',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'borderStyle',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontVariant',
    'fontWeight',
    'fontStretch',
    'fontSize',
    'fontSizeAdjust',
    'lineHeight',
    'fontFamily',
    'textAlign',
    'textTransform',
    'textIndent',
    'textDecoration',
    'letterSpacing',
    'wordSpacing',
    'tabSize',
    'MozTabSize'
  ]

  properties.forEach((prop) => {
    div.style.setProperty(prop, style.getPropertyValue(prop))
  })

  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '0'

  // Create text content up to the caret
  div.textContent = element.value.substring(0, position)

  // Create a span for the caret position
  const span = document.createElement('span')
  span.textContent = element.value.substring(position) || '.'
  div.appendChild(span)

  document.body.appendChild(div)

  const { offsetLeft: left, offsetTop: top } = span
  const rect = element.getBoundingClientRect()

  document.body.removeChild(div)

  // Return fixed coordinates
  return {
    top: rect.top + top - element.scrollTop,
    left: rect.left + left - element.scrollLeft
  }
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  onCancelMessage,
  disabled
}) => {
  const { instanceSummaries, projects } = useInstanceContext()
  const { skills } = useSkillsContext()
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftInput = useChatStore((state) => state.draftInput)
  const setDraftInput = useChatStore((state) => state.setDraftInput)

  // Mention Suggestion State (@)
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mentionPosition, setMentionPosition] = useState<{
    top?: number
    bottom?: number
    left: number
  }>({ top: 0, left: 0 })
  const [triggerIndex, setTriggerIndex] = useState(-1)

  // Slash Command Suggestion State (/)
  const [slashSuggestions, setSlashSuggestions] = useState<SkillEntry[]>([])
  const [showSlashSuggestions, setShowSlashSuggestions] = useState(false)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashPosition, setSlashPosition] = useState<{
    top?: number
    bottom?: number
    left: number
  }>({ top: 0, left: 0 })
  const [slashTriggerIndex, setSlashTriggerIndex] = useState(-1)

  // Token Stats Modal State
  const [showTokenStats, setShowTokenStats] = useState(false)

  // Build Trie
  const trie = useMemo(() => {
    const t = new Trie<SuggestionItem>()
    instanceSummaries.forEach((inst) => {
      const project = projects.find((p) => p.id === inst.projectId)
      const item: SuggestionItem = { ...inst, projectName: project?.name || 'Unknown' }
      t.insert(inst.name || '', item)
    })
    return t
  }, [instanceSummaries, projects])

  useEffect(() => {
    if (draftInput === null || draftInput === undefined) return
    setInput(draftInput)
    setDraftInput(null)
    setShowSuggestions(false)
    setShowSlashSuggestions(false)
    setSelectedIndex(0)
    setSlashSelectedIndex(0)
    setSuggestions([])
    setSlashSuggestions([])

    if (textareaRef.current) {
      const end = draftInput.length
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(end, end)
    }
  }, [draftInput, setDraftInput])

  // Auto-resize textarea height
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [input])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const selectionStart = e.target.selectionStart
    setInput(value)

    // Check for trigger '@'
    const lastAt = value.lastIndexOf('@', selectionStart - 1)
    if (lastAt !== -1) {
      const prevChar = value[lastAt - 1]
      if (lastAt === 0 || prevChar === ' ' || prevChar === '\n') {
        const query = value.slice(lastAt + 1, selectionStart)
        if (!query.includes('\n')) {
          const matches = trie.search(query)
          if (matches.length > 0) {
            setSuggestions(matches.slice(0, 10))
            setTriggerIndex(lastAt)
            setSelectedIndex(0)
            setShowSuggestions(true)
            setShowSlashSuggestions(false)

            if (textareaRef.current) {
              const coords = getCaretCoordinates(textareaRef.current, lastAt + 1)
              const distFromBottom = window.innerHeight - coords.top + 5
              setMentionPosition({ bottom: distFromBottom, left: coords.left })
            }
            return
          }
        }
      }
    }
    setShowSuggestions(false)

    // Check for trigger '/'
    const lastSlash = value.lastIndexOf('/', selectionStart - 1)
    if (lastSlash !== -1) {
      const prevChar = value[lastSlash - 1]
      if (lastSlash === 0 || prevChar === ' ' || prevChar === '\n') {
        const query = value.slice(lastSlash + 1, selectionStart).toLowerCase()
        if (!query.includes('\n') && !query.includes(' ')) {
          const matches = skills.filter((s) => {
            const nameMatch = s.name.toLowerCase().includes(query)
            const descMatch = s.description.toLowerCase().includes(query)
            return nameMatch || descMatch
          })

          if (matches.length > 0) {
            setSlashSuggestions(matches.slice(0, 10))
            setSlashTriggerIndex(lastSlash)
            setSlashSelectedIndex(0)
            setShowSlashSuggestions(true)
            setShowSuggestions(false)

            if (textareaRef.current) {
              const coords = getCaretCoordinates(textareaRef.current, lastSlash + 1)
              const distFromBottom = window.innerHeight - coords.top + 5
              setSlashPosition({ bottom: distFromBottom, left: coords.left })
            }
            return
          }
        }
      }
    }
    setShowSlashSuggestions(false)
  }

  const insertMention = (item: SuggestionItem) => {
    const typeStr =
      (item.type || 'canvas').charAt(0).toUpperCase() + (item.type || 'canvas').slice(1)
    const safeName = (item.name || '').replace(/"/g, '\\"')
    const safeProject = item.projectName.replace(/"/g, '\\"')

    const tag = `${typeStr} "${safeName}" in Project "${safeProject}" `

    const before = input.slice(0, triggerIndex)
    const after = input.slice(textareaRef.current?.selectionStart || input.length)

    const newValue = before + tag + after
    setInput(newValue)
    setShowSuggestions(false)

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newCursorPos = before.length + tag.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const insertSlashCommand = (item: SkillEntry) => {
    const tag = `/${item.name} `
    const before = input.slice(0, slashTriggerIndex)
    const after = input.slice(textareaRef.current?.selectionStart || input.length)

    const newValue = before + tag + after
    setInput(newValue)
    setShowSlashSuggestions(false)

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const newCursorPos = before.length + tag.length
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(suggestions[selectedIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false)
        return
      }
    }

    if (showSlashSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % slashSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIndex(
          (prev) => (prev - 1 + slashSuggestions.length) % slashSuggestions.length
        )
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertSlashCommand(slashSuggestions[slashSelectedIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowSlashSuggestions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSendMessage(input.trim())
      setInput('')
      setShowSuggestions(false)
      setShowSlashSuggestions(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const instanceId = e.dataTransfer.getData('application/x-collar-instance-id')
    if (instanceId) {
      const summary = instanceSummaries.find((s) => s.instanceId === instanceId)
      if (summary) {
        const project = projects.find((p) => p.id === summary.projectId)
        const projectName = project?.name || 'Unknown'

        const typeStr =
          (summary.type || 'canvas').charAt(0).toUpperCase() + (summary.type || 'canvas').slice(1)
        const safeName = (summary.name || '').replace(/"/g, '\\"')
        const safeProject = projectName.replace(/"/g, '\\"')

        const tag = `${typeStr} "${safeName}" in Project "${safeProject}" `

        setInput((prev) => prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + tag)
      }
    }
  }

  return (
    <div className="message-input p-2 bg-surface-50 relative rounded-2xl border border-surface-200 focus-within:border-primary/50 transition-all">
      {showSuggestions && (
        <MentionList
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={insertMention}
          position={mentionPosition}
        />
      )}
      {showSlashSuggestions && (
        <SlashCommandList
          suggestions={slashSuggestions}
          selectedIndex={slashSelectedIndex}
          onSelect={insertSlashCommand}
          position={slashPosition}
        />
      )}
      <div
        className="relative flex items-end gap-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled ? 'Agent is working...' : 'Type a message... (@ to mention, / for skills)'
          }
          disabled={disabled}
          className="flex-1 p-3 border border-surface-200 rounded-lg resize-none focus:outline-none bg-surface-100 text-(--ev-c-text-1) placeholder-(--ev-c-text-3) max-h-[300px] min-h-[50px] custom-scrollbar text-sm"
          rows={1}
        />
        <button
          onClick={() => setShowTokenStats(true)}
          className="p-3 rounded-lg border border-surface-200 bg-surface-100 hover:bg-surface-200 text-(--ev-c-text-3) hover:text-(--ev-c-text-1) transition-colors shrink-0"
          title="Token Usage Statistics"
        >
          <StatsIcon />
        </button>
        <button
          onClick={disabled ? onCancelMessage : handleSend}
          disabled={!disabled && !input.trim()}
          className={`p-3 rounded-lg font-medium transition-opacity text-sm shadow-sm shrink-0 flex items-center justify-center ${
            disabled
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-(--color-primary) text-(--ev-c-black) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
          title={disabled ? 'Stop Generation' : 'Send Message'}
        >
          {disabled ? <StopIcon /> : <SendIcon />}
        </button>
      </div>
      {showTokenStats && <TokenStats onClose={() => setShowTokenStats(false)} />}
    </div>
  )
}
