import React, { useState, useRef, useEffect } from 'react'

interface AttributeProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  edgeSelected?: boolean
  edgeHovered?: boolean
}

export const Attribute: React.FC<AttributeProps> = ({
  value,
  onChange,
  placeholder = '+ label',
  edgeSelected = false,
  edgeHovered = false
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [localVal, setLocalVal] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalVal(value)
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const commit = () => {
    setIsEditing(false)
    if (localVal !== value) {
      onChange(localVal)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commit()
    } else if (e.key === 'Escape') {
      setLocalVal(value)
      setIsEditing(false)
    }
    e.stopPropagation()
  }

  // If no value and not hovered/selected/editing, keep it hidden to avoid clutter
  const hasValue = !!value?.trim()
  const isVisible = hasValue || edgeSelected || edgeHovered || isEditing

  if (!isVisible) return null

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        pointerEvents: 'auto'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="px-2 py-0.5 text-xs font-medium text-center bg-white text-black border border-primary rounded-full shadow-md outline-none min-w-[60px] max-w-[140px]"
          placeholder="Label..."
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={`px-2 py-0.5 text-xs font-medium rounded-full transition-all select-none shadow-xs border cursor-pointer focus:outline-none ${
            hasValue
              ? edgeSelected
                ? 'bg-surface-100 text-black border-primary'
                : 'bg-white text-gray-700 border-surface-200 hover:border-primary'
              : 'bg-white/80 text-gray-400 border-dashed border-surface-200 hover:text-black hover:border-primary'
          }`}
        >
          {hasValue ? value : placeholder}
        </button>
      )}
    </div>
  )
}
