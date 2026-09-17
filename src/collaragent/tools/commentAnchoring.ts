// commentAnchoring.ts
import type { Block, InlineRun } from '@workspace/persistence/editorContent'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

export interface TextRange {
  start: number
  end: number
}

interface CharMapping {
  rawStart: number
  rawEnd: number
}

interface NormalizedMapping {
  normalized: string
  charMap: CharMapping[]
}

// Unicode zero-width and invisible formatting characters
const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\u200E\u200F\u2060\uFEFF\u00AD]/

// Unicode whitespace characters (including non-breaking spaces \u00A0, ideographic full-width spaces \u3000, etc.)
const UNICODE_WHITESPACE_REGEX =
  /[\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\t\n\r\f\v]/

// Common CJK ideographs range
const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/

// Common enclosing quotes/wrappers
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
  ['`', '`']
]

/**
 * Normalizes text while mapping each character code unit in the normalized string
 * back to its exact [rawStart, rawEnd] slice in the original string.
 */
function buildNormalizedMap(
  raw: string,
  options: { collapseWhitespace?: boolean; ignoreCjkSpaces?: boolean } = {}
): NormalizedMapping {
  const { collapseWhitespace = true, ignoreCjkSpaces = false } = options
  let normalized = ''
  const charMap: CharMapping[] = []

  let i = 0
  const len = raw.length

  while (i < len) {
    const char = raw[i]

    // 1. Skip zero-width invisible characters
    if (ZERO_WIDTH_REGEX.test(char)) {
      i++
      continue
    }

    // 2. Handle whitespace
    if (UNICODE_WHITESPACE_REGEX.test(char)) {
      const rawStart = i
      while (i < len && (UNICODE_WHITESPACE_REGEX.test(raw[i]) || ZERO_WIDTH_REGEX.test(raw[i]))) {
        i++
      }
      const rawEnd = i

      // If ignoring spaces adjacent to CJK characters:
      if (ignoreCjkSpaces) {
        const prevChar = normalized.length > 0 ? normalized[normalized.length - 1] : ''
        const nextChar = i < len ? raw[i] : ''
        if (CJK_REGEX.test(prevChar) || CJK_REGEX.test(nextChar)) {
          continue
        }
      }

      if (collapseWhitespace) {
        normalized += ' '
        charMap.push({ rawStart, rawEnd })
      } else {
        for (let k = rawStart; k < rawEnd; k++) {
          normalized += ' '
          charMap.push({ rawStart: k, rawEnd: k + 1 })
        }
      }
      continue
    }

    // 3. Regular characters (handling surrogate pairs)
    const codePoint = raw.codePointAt(i)
    const charLen = codePoint && codePoint > 0xffff ? 2 : 1
    const sub = raw.slice(i, i + charLen)

    normalized += sub
    for (let k = 0; k < charLen; k++) {
      charMap.push({ rawStart: i, rawEnd: i + charLen })
    }
    i += charLen
  }

  return { normalized, charMap }
}

/**
 * Normalizes target search string.
 */
function normalizeTargetText(
  raw: string,
  options: { collapseWhitespace?: boolean; ignoreCjkSpaces?: boolean } = {}
): string {
  const { collapseWhitespace = true, ignoreCjkSpaces = false } = options
  let res = ''
  let i = 0
  const len = raw.length

  while (i < len) {
    const char = raw[i]
    if (ZERO_WIDTH_REGEX.test(char)) {
      i++
      continue
    }
    if (UNICODE_WHITESPACE_REGEX.test(char)) {
      while (i < len && (UNICODE_WHITESPACE_REGEX.test(raw[i]) || ZERO_WIDTH_REGEX.test(raw[i]))) {
        i++
      }
      if (ignoreCjkSpaces) {
        const prevChar = res.length > 0 ? res[res.length - 1] : ''
        const nextChar = i < len ? raw[i] : ''
        if (CJK_REGEX.test(prevChar) || CJK_REGEX.test(nextChar)) {
          continue
        }
      }
      if (collapseWhitespace) {
        res += ' '
      }
      continue
    }
    const codePoint = raw.codePointAt(i)
    const charLen = codePoint && codePoint > 0xffff ? 2 : 1
    res += raw.slice(i, i + charLen)
    i += charLen
  }
  return res
}

/**
 * Strips outer matching quote pairs (e.g. 「...」, "...", “...”).
 */
function unwrapQuotes(text: string): string {
  const trimmed = text.trim()
  for (const [open, close] of QUOTE_PAIRS) {
    if (
      trimmed.startsWith(open) &&
      trimmed.endsWith(close) &&
      trimmed.length >= open.length + close.length
    ) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim()
    }
  }
  return trimmed
}

/**
 * Multi-tier resilient text range finder.
 * Finds the exact [start, end] slice in `fullText` corresponding to `targetText`,
 * handling unicode variations, non-breaking spaces (&nbsp;), zero-width markers,
 * collapsed whitespace, and CJK-Latin boundary spaces.
 */
export function findTextRange(fullText: string, targetText: string): TextRange | null {
  if (!fullText || !targetText) return null

  // Helper to execute matching tiers on a target candidate
  const matchCandidate = (target: string): TextRange | null => {
    // Tier 1: Exact binary match
    const exactIndex = fullText.indexOf(target)
    if (exactIndex !== -1) {
      return { start: exactIndex, end: exactIndex + target.length }
    }

    // Tier 2: Exact match with trimmed target
    const trimmed = target.trim()
    if (trimmed.length > 0 && trimmed !== target) {
      const trimmedIndex = fullText.indexOf(trimmed)
      if (trimmedIndex !== -1) {
        return { start: trimmedIndex, end: trimmedIndex + trimmed.length }
      }
    }

    const effectiveTarget = trimmed.length > 0 ? trimmed : target

    // Tier 3: Whitespace & Unicode normalized match (NBSP -> ' ', strip zero-width, collapse spaces)
    const normFull = buildNormalizedMap(fullText, { collapseWhitespace: true })
    const normTarget = normalizeTargetText(effectiveTarget, { collapseWhitespace: true }).trim()

    if (normTarget.length > 0) {
      // 3a. Case-sensitive
      let matchIdx = normFull.normalized.indexOf(normTarget)
      if (matchIdx !== -1) {
        const start = normFull.charMap[matchIdx].rawStart
        const end = normFull.charMap[matchIdx + normTarget.length - 1].rawEnd
        return { start, end }
      }

      // 3b. Case-insensitive
      const lowerNormFull = normFull.normalized.toLowerCase()
      const lowerNormTarget = normTarget.toLowerCase()
      matchIdx = lowerNormFull.indexOf(lowerNormTarget)
      if (matchIdx !== -1) {
        const start = normFull.charMap[matchIdx].rawStart
        const end = normFull.charMap[matchIdx + normTarget.length - 1].rawEnd
        return { start, end }
      }
    }

    // Tier 4: CJK-adjacent whitespace resilient match (handles space vs no-space at Latin-CJK boundaries)
    const cjkNormFull = buildNormalizedMap(fullText, {
      collapseWhitespace: true,
      ignoreCjkSpaces: true
    })
    const cjkNormTarget = normalizeTargetText(effectiveTarget, {
      collapseWhitespace: true,
      ignoreCjkSpaces: true
    }).trim()

    if (cjkNormTarget.length > 0) {
      // 4a. Case-sensitive
      let matchIdx = cjkNormFull.normalized.indexOf(cjkNormTarget)
      if (matchIdx !== -1) {
        const start = cjkNormFull.charMap[matchIdx].rawStart
        const end = cjkNormFull.charMap[matchIdx + cjkNormTarget.length - 1].rawEnd
        return { start, end }
      }

      // 4b. Case-insensitive
      const lowerCjkFull = cjkNormFull.normalized.toLowerCase()
      const lowerCjkTarget = cjkNormTarget.toLowerCase()
      matchIdx = lowerCjkFull.indexOf(lowerCjkTarget)
      if (matchIdx !== -1) {
        const start = cjkNormFull.charMap[matchIdx].rawStart
        const end = cjkNormFull.charMap[matchIdx + cjkNormTarget.length - 1].rawEnd
        return { start, end }
      }
    }

    return null
  }

  // Run matching on original target
  const directMatch = matchCandidate(targetText)
  if (directMatch) return directMatch

  // Tier 5: Outer quote / bracket stripping fallback
  const unwrapped = unwrapQuotes(targetText)
  if (unwrapped !== targetText && unwrapped.length > 0) {
    const unwrappedMatch = matchCandidate(unwrapped)
    if (unwrappedMatch) return unwrappedMatch
  }

  return null
}

/**
 * Splits an array of InlineRuns and attaches a commentId to the segment matching targetText.
 * Preserves all formatting attributes (bold, italic, font, color, etc.) and existing comment IDs.
 */
export function anchorCommentToRuns(
  runs: InlineRun[],
  targetText: string,
  commentId: string
): InlineRun[] {
  if (!targetText || targetText.length === 0) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_COMMENT_TARGET_NOT_FOUND,
      'Target text must not be empty.'
    )
  }

  // Concatenate all run texts and map run boundaries
  let fullText = ''
  const runBoundaries: Array<{ run: InlineRun; start: number; end: number }> = []

  for (const run of runs) {
    const text = run.text ?? ''
    const start = fullText.length
    fullText += text
    const end = fullText.length
    runBoundaries.push({ run, start, end })
  }

  const range = findTextRange(fullText, targetText)
  if (!range) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_COMMENT_TARGET_NOT_FOUND,
      `Target text "${targetText}" not found in block text content.`
    )
  }
  const matchStart = range.start
  const matchEnd = range.end

  const nextRuns: InlineRun[] = []

  for (const { run, start, end } of runBoundaries) {
    // 1. Outside match range (before or after)
    if (end <= matchStart || start >= matchEnd) {
      nextRuns.push({ ...run })
      continue
    }

    const runText = run.text ?? ''
    const overlapStart = Math.max(start, matchStart)
    const overlapEnd = Math.min(end, matchEnd)

    const localPreEnd = overlapStart - start
    const localMidEnd = overlapEnd - start

    // Pre-match segment
    if (localPreEnd > 0) {
      nextRuns.push({
        ...run,
        text: runText.slice(0, localPreEnd)
      })
    }

    // Mid (matched) segment: append commentId
    if (localMidEnd > localPreEnd) {
      const existingCommentIds = run.commentIds ? [...run.commentIds] : []
      const commentIds = existingCommentIds.includes(commentId)
        ? existingCommentIds
        : [...existingCommentIds, commentId]

      nextRuns.push({
        ...run,
        text: runText.slice(localPreEnd, localMidEnd),
        commentIds
      })
    }

    // Post-match segment
    if (localMidEnd < runText.length) {
      nextRuns.push({
        ...run,
        text: runText.slice(localMidEnd)
      })
    }
  }

  return nextRuns
}

/**
 * Anchors a comment ID to targetText in a block (paragraph, heading, list-item, quote, code, or table cell).
 * Returns a new Block instance with updated runs.
 */
export function anchorCommentToBlock(block: Block, targetText: string, commentId: string): Block {
  // Table block handling
  if (block.type === 'table' && Array.isArray(block.tableRows)) {
    let matched = false
    const updatedRows = block.tableRows.map((row) => {
      const updatedCells = row.cells.map((cell) => {
        if (matched) return cell
        const runs = cell.children && cell.children.length > 0 ? cell.children : [{ text: '' }]
        try {
          const newRuns = anchorCommentToRuns(runs, targetText, commentId)
          matched = true
          return { ...cell, children: newRuns }
        } catch {
          // Not in this cell, continue searching other cells
          return cell
        }
      })
      return { ...row, cells: updatedCells }
    })

    if (!matched) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_COMMENT_TARGET_NOT_FOUND,
        `Target text "${targetText}" not found in any cell of table block "${block.id ?? 'unknown'}".`
      )
    }

    return {
      ...block,
      tableRows: updatedRows
    }
  }

  // Standard block handling (paragraph, heading, list-item, etc.)
  const rawRuns =
    block.children && block.children.length > 0 ? block.children : [{ text: block.content ?? '' }]

  const updatedRuns = anchorCommentToRuns(rawRuns, targetText, commentId)

  return {
    ...block,
    children: updatedRuns,
    content: undefined
  }
}
