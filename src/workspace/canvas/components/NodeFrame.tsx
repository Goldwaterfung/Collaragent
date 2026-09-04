import React from 'react'

/**
 * Props for the NodeFrame component.
 * Note: x, y, width, height are no longer used for positioning.
 * PortContainer handles absolute positioning on the canvas.
 */
interface NodeFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the node is currently selected */
  selected?: boolean
  /** Children to render inside the frame */
  children?: React.ReactNode
}

/**
 * NodeFrame provides the visual styling for a canvas node.
 *
 * It renders as a white card with rounded corners and shadow.
 * The frame fills its parent container (PortContainer handles positioning).
 *
 * @example
 * ```tsx
 * <PortContainer x={100} y={100} width={200} height={150}>
 *   <NodeFrame selected={isSelected}>
 *     <NodeHeader>...</NodeHeader>
 *     <div>{content}</div>
 *   </NodeFrame>
 * </PortContainer>
 * ```
 */
export const NodeFrame: React.FC<NodeFrameProps> = ({
  selected = false,
  children,
  style,
  className = '',
  ...props
}) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        ...style
      }}
      className={`rounded-xl overflow-hidden flex flex-col transition-all duration-150 border bg-white/95 ${
        selected
          ? 'ring-2 ring-primary/80 shadow-xl border-primary'
          : 'shadow-md hover:shadow-lg hover:border-primary/60 border-surface-200'
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
