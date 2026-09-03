import { DEFAULT_NODE_WIDTH } from '@shared/constants'

export const NODE_HEADER_MIN_HEIGHT = 56
export const NODE_HEADER_MAX_HEIGHT = 120
export const NODE_HEADER_HEIGHT = 64

export const NODE_TITLE_FONT_SIZE = 16
export const NODE_TITLE_LINE_HEIGHT = 20
export const NODE_HEADER_CONTROLS_WIDTH = 90
export const NODE_TITLE_AVG_CHAR_WIDTH = 9

const NODE_HEADER_FONT_SIZE = 26
const NODE_HEADER_HORIZONTAL_PADDING = 100
const NODE_HEADER_MIN_WIDTH = 80
const NODE_HEADER_CHAR_WIDTH = Math.round(NODE_HEADER_FONT_SIZE * 0.5)

export const getHeaderWidthForName = (name: string): number => {
  const text = name?.trim() ?? ''
  const estimatedTextWidth = Math.max(1, text.length) * NODE_HEADER_CHAR_WIDTH
  const paddedWidth = estimatedTextWidth + NODE_HEADER_HORIZONTAL_PADDING
  const minWidth = Math.max(
    NODE_HEADER_MIN_WIDTH,
    NODE_HEADER_HORIZONTAL_PADDING + NODE_HEADER_CHAR_WIDTH * 3
  )

  return Math.max(minWidth, paddedWidth)
}

/**
 * Deterministically estimates header height from node title text and available width.
 * Accounts for line wrapping, explicit newlines, and clamps between NODE_HEADER_MIN_HEIGHT and NODE_HEADER_MAX_HEIGHT.
 */
export const calculateHeaderHeight = (name: string, width: number): number => {
  const text = name?.trim() ?? ''
  if (!text) {
    return NODE_HEADER_MIN_HEIGHT
  }

  const safeWidth = Number.isFinite(width) && width > 0 ? width : DEFAULT_NODE_WIDTH
  const availableWidth = Math.max(20, safeWidth - NODE_HEADER_CONTROLS_WIDTH)
  const charsPerLine = Math.max(1, Math.floor(availableWidth / NODE_TITLE_AVG_CHAR_WIDTH))

  const lines = text.split('\n')
  let totalLines = 0
  for (const line of lines) {
    const wrappedLines = Math.max(1, Math.ceil((line.length || 1) / charsPerLine))
    totalLines += wrappedLines
  }

  const estimatedHeight = NODE_HEADER_MIN_HEIGHT + (totalLines - 1) * NODE_TITLE_LINE_HEIGHT
  return Math.min(
    NODE_HEADER_MAX_HEIGHT,
    Math.max(NODE_HEADER_MIN_HEIGHT, Math.round(estimatedHeight))
  )
}
