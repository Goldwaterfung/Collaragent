import React from 'react'

interface EdgePathProps extends React.SVGProps<SVGPathElement> {
  path: string
  dashed?: boolean
  selected?: boolean
  hovered?: boolean
  onEdgeClick?: (e: React.MouseEvent) => void
  onEdgeMouseEnter?: () => void
  onEdgeMouseLeave?: () => void
}

export const EdgePath: React.FC<EdgePathProps> = ({
  path,
  stroke,
  strokeWidth = 2,
  dashed = false,
  selected = false,
  hovered = false,
  onEdgeClick,
  onEdgeMouseEnter,
  onEdgeMouseLeave,
  style,
  ...props
}) => {
  const resolvedStroke = selected ? '#f5afaf' : hovered ? '#f87171' : stroke || '#cbd5e1'
  const resolvedWidth = selected ? 3 : hovered ? 2.5 : strokeWidth

  return (
    <g className="edge-path-group">
      {/* Invisible wider hit area for easy clicking & hovering */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth={18}
        fill="none"
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={onEdgeClick}
        onMouseEnter={onEdgeMouseEnter}
        onMouseLeave={onEdgeMouseLeave}
      />
      {/* Visual Path */}
      <path
        d={path}
        stroke={resolvedStroke}
        strokeWidth={resolvedWidth}
        strokeDasharray={dashed ? '5,5' : undefined}
        fill="none"
        style={{
          pointerEvents: 'none',
          transition: 'stroke 0.15s ease, stroke-width 0.15s ease',
          ...style
        }}
        {...props}
      />
    </g>
  )
}
