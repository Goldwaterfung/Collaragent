import React from 'react'

type ResizePosition = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  position: ResizePosition
  thickness?: number
  length?: number | string
}

const DEFAULT_HANDLE_THICKNESS = 8
const CORNER_HANDLE_SIZE = 10
const DEFAULT_HANDLE_LENGTH = '100%'

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  position,
  thickness = DEFAULT_HANDLE_THICKNESS,
  length = DEFAULT_HANDLE_LENGTH,
  style,
  className,
  children,
  ...props
}) => {
  const isCorner = ['se', 'sw', 'ne', 'nw'].includes(position)
  const cornerSize = CORNER_HANDLE_SIZE

  const getStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: isCorner ? 20 : 15
    }

    switch (position) {
      case 'e':
        return {
          ...base,
          top: 0,
          right: -thickness / 2,
          width: thickness,
          height: length,
          cursor: 'ew-resize'
        }
      case 'w':
        return {
          ...base,
          top: 0,
          left: -thickness / 2,
          width: thickness,
          height: length,
          cursor: 'ew-resize'
        }
      case 's':
        return {
          ...base,
          bottom: -thickness / 2,
          left: 0,
          width: length,
          height: thickness,
          cursor: 'ns-resize'
        }
      case 'n':
        return {
          ...base,
          top: -thickness / 2,
          left: 0,
          width: length,
          height: thickness,
          cursor: 'ns-resize'
        }
      case 'se':
        return {
          ...base,
          bottom: -cornerSize / 2,
          right: -cornerSize / 2,
          width: cornerSize,
          height: cornerSize,
          cursor: 'nwse-resize'
        }
      case 'sw':
        return {
          ...base,
          bottom: -cornerSize / 2,
          left: -cornerSize / 2,
          width: cornerSize,
          height: cornerSize,
          cursor: 'nesw-resize'
        }
      case 'ne':
        return {
          ...base,
          top: -cornerSize / 2,
          right: -cornerSize / 2,
          width: cornerSize,
          height: cornerSize,
          cursor: 'nesw-resize'
        }
      case 'nw':
        return {
          ...base,
          top: -cornerSize / 2,
          left: -cornerSize / 2,
          width: cornerSize,
          height: cornerSize,
          cursor: 'nwse-resize'
        }
      default:
        return base
    }
  }

  const isSouthHandle = position === 's'
  const baseClassName = isCorner
    ? 'bg-primary border-2 border-white rounded-sm shadow-xs hover:scale-125 transition-transform'
    : isSouthHandle
      ? 'group flex items-center justify-center hover:bg-primary/10 transition-colors'
      : 'hover:bg-primary/15 transition-colors'

  return (
    <div
      style={{ ...getStyle(), ...style }}
      className={className ? `${baseClassName} ${className}` : baseClassName}
      {...props}
    >
      {isSouthHandle && (
        <div
          className="w-8 h-1 rounded-full bg-surface-300/60 group-hover:bg-primary group-hover:w-12 transition-all pointer-events-none"
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  )
}
