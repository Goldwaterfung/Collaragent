import MarkdownIt from 'markdown-it'
import Prism from 'prismjs'
import katex from 'katex'

// Import Prism core components in dependency order
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-diff'

export type MarkdownSegment =
  { type: 'markdown'; content: string } | { type: 'mermaid'; code: string }

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  bash: 'bash',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  'c++': 'cpp'
}

function renderKatex(math: string, displayMode: boolean): string {
  try {
    return katex.renderToString(math.trim(), {
      displayMode,
      throwOnError: false,
      errorColor: '#ef4444',
      strict: 'ignore'
    })
  } catch {
    return `<span class="katex-error text-red-500 font-mono text-xs">${md.utils.escapeHtml(math)}</span>`
  }
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    const rawLang = (lang || '').trim().toLowerCase()
    const normalizedLang = LANGUAGE_ALIASES[rawLang] || rawLang

    // Mermaid blocks are separated and handled natively by React
    if (normalizedLang === 'mermaid') {
      return `<pre class="language-mermaid font-mono text-xs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }

    if (normalizedLang && Prism.languages[normalizedLang]) {
      try {
        const highlighted = Prism.highlight(str, Prism.languages[normalizedLang], normalizedLang)
        return `<pre class="language-${normalizedLang}"><code class="language-${normalizedLang}">${highlighted}</code></pre>`
      } catch {
        // Fall back gracefully to escaped text without throwing
      }
    }

    const fallbackLang = normalizedLang || 'text'
    return `<pre class="language-${fallbackLang}"><code class="language-${fallbackLang}">${md.utils.escapeHtml(str)}</code></pre>`
  }
})

// Wrap GFM tables in a horizontal overflow container
md.renderer.rules.table_open = () => {
  return '<div class="chat-table-wrapper overflow-x-auto my-3 rounded-lg border border-surface-200"><table>'
}
md.renderer.rules.table_close = () => {
  return '</table></div>'
}

// Inline Math rule: $...$ and $$...$$
md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) {
    return false
  }

  const isDouble = state.src.charCodeAt(state.pos + 1) === 0x24
  const markerLength = isDouble ? 2 : 1
  const start = state.pos + markerLength

  if (start >= state.posMax) return false

  // Don't match if opening marker is followed by whitespace
  const nextChar = state.src.charCodeAt(start)
  if (nextChar === 0x20 || nextChar === 0x09 || nextChar === 0x0a) {
    return false
  }

  // Single $ should not be followed by a digit (prevents currency like $10, $50 from opening math)
  if (!isDouble && nextChar >= 0x30 && nextChar <= 0x39) {
    return false
  }

  let match = start
  const marker = isDouble ? '$$' : '$'
  while ((match = state.src.indexOf(marker, match)) !== -1) {
    // Math cannot extend beyond current inline block boundary
    if (match >= state.posMax) {
      return false
    }

    // Single $ inline math cannot span across newlines
    if (!isDouble && state.src.slice(start, match).includes('\n')) {
      return false
    }

    let backslashes = 0
    let pos = match - 1
    while (pos >= start && state.src.charCodeAt(pos) === 0x5c /* \ */) {
      backslashes++
      pos--
    }
    if (backslashes % 2 === 0) {
      break
    }
    match += markerLength
  }

  if (match === -1 || match >= state.posMax) {
    return false
  }

  // Single $ inline math cannot span across newlines
  if (!isDouble && state.src.slice(start, match).includes('\n')) {
    return false
  }

  // Don't match if closing marker is preceded by whitespace
  const prevChar = state.src.charCodeAt(match - 1)
  if (prevChar === 0x20 || prevChar === 0x09 || prevChar === 0x0a) {
    return false
  }

  // For single $, closing marker should not be immediately followed by a digit (e.g. $10 - $20)
  if (!isDouble && match + 1 < state.posMax) {
    const afterClosing = state.src.charCodeAt(match + 1)
    if (afterClosing >= 0x30 && afterClosing <= 0x39) {
      return false
    }
  }

  if (!silent) {
    const token = state.push(isDouble ? 'math_block' : 'math_inline', 'math', 0)
    token.markup = marker
    token.content = state.src.slice(start, match)
  }

  state.pos = match + markerLength
  return true
})

// Block Math rule: $$...$$
md.block.ruler.after(
  'blockquote',
  'math_block',
  (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]

    if (pos + 2 > max) return false
    if (state.src.charCodeAt(pos) !== 0x24 || state.src.charCodeAt(pos + 1) !== 0x24) {
      return false
    }

    pos += 2
    let firstLine = state.src.slice(pos, max)

    if (silent) return true

    let haveEndMarker = false
    if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
      firstLine = firstLine.trim().slice(0, -2)
      haveEndMarker = true
    }

    let nextLine = startLine
    const lines: string[] = [firstLine]

    if (!haveEndMarker) {
      for (;;) {
        nextLine++
        if (nextLine >= endLine) break

        pos = state.bMarks[nextLine] + state.tShift[nextLine]
        const lineMax = state.eMarks[nextLine]

        if (pos < lineMax && state.tShift[nextLine] < state.blkIndent) break

        const lineText = state.src.slice(pos, lineMax)
        if (lineText.trim().endsWith('$$')) {
          haveEndMarker = true
          const trimmed = lineText.trim().slice(0, -2)
          if (trimmed) lines.push(trimmed)
          break
        }
        lines.push(lineText)
      }
    }

    state.line = nextLine + 1

    const token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = lines.join('\n')
    token.markup = '$$'

    return true
  },
  { alt: ['paragraph', 'reference', 'blockquote', 'list'] }
)

// KaTeX renderers
md.renderer.rules.math_inline = (tokens, idx) => {
  return renderKatex(tokens[idx].content, false)
}

md.renderer.rules.math_block = (tokens, idx) => {
  return `<div class="katex-display-wrapper overflow-x-auto my-2">${renderKatex(tokens[idx].content, true)}</div>`
}

/**
 * Splits message text into alternating markdown and mermaid segments
 * so Mermaid can be rendered asynchronously in isolated React components.
 */
export function parseContentSegments(content: string): MarkdownSegment[] {
  if (!content) return []
  if (!content.includes('```mermaid')) {
    return [{ type: 'markdown', content }]
  }

  const segments: MarkdownSegment[] = []
  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)(?:```|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = mermaidRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text) {
        segments.push({ type: 'markdown', content: text })
      }
    }
    const code = match[1] ?? ''
    segments.push({ type: 'mermaid', code })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex)
    if (remaining) {
      segments.push({ type: 'markdown', content: remaining })
    }
  }

  return segments
}

export const renderMarkdown = (content: string): string => {
  return md.render(content)
}
