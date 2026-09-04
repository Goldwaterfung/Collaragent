import React from 'react'
import { NODE_HEADER_HEIGHT } from './nodeLayout'
import { CLUSTER_ACCENT_BAR_WIDTH_PX } from '@shared/constants'

interface NodeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  clusterColor?: string
  clusterId?: string
  children?: React.ReactNode
}

export const NodeHeader: React.FC<NodeHeaderProps> = ({
  selected = false,
  clusterColor,
  clusterId,
  children,
  style,
  className = '',
  ...props
}) => {
  return (
    <div
      data-cluster-id={clusterId}
      style={{
        minHeight: NODE_HEADER_HEIGHT,
        height: 'auto',
        borderLeft: clusterColor
          ? `${CLUSTER_ACCENT_BAR_WIDTH_PX}px solid ${clusterColor}`
          : undefined,
        ...style
      }}
      className={`w-full flex items-center justify-between py-2 px-3 cursor-grab select-none transition-colors ${
        selected
          ? 'bg-surface-100 text-[var(--ev-c-text-1)]'
          : 'bg-surface-50 text-[var(--ev-c-text-1)]'
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
