// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown, parseContentSegments } from '../markdown'

describe('renderMarkdown', () => {
  it('wraps GFM tables in an overflow container with proper table markup', () => {
    const markdown = '| Col A | Col B |\n| --- | --- |\n| Cell 1 | Cell 2 |'
    const html = renderMarkdown(markdown)

    expect(html).toContain('chat-table-wrapper')
    expect(html).toContain('<table')
    expect(html).toContain('<th>Col A</th>')
    expect(html).toContain('<td>Cell 1</td>')
  })

  it('highlights code blocks with Prism tokens', () => {
    const markdown = '```ts\nconst greeting: string = "hello";\n```'
    const html = renderMarkdown(markdown)

    expect(html).toContain('class="language-typescript"')
    expect(html).toContain('token')
  })

  it('safely renders inline KaTeX math ($...$)', () => {
    const markdown = 'The equation is $E = mc^2$ in physics.'
    const html = renderMarkdown(markdown)

    expect(html).toContain('class="katex"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('safely renders block KaTeX math ($$...$$)', () => {
    const markdown = '$$\n\\int_0^1 x dx = \\frac{1}{2}\n$$'
    const html = renderMarkdown(markdown)

    expect(html).toContain('katex-display-wrapper')
    expect(html).toContain('class="katex-display"')
  })

  it('never throws on incomplete or malformed math during streaming', () => {
    const partialMath = 'Computing $$\\frac{a}{'
    expect(() => renderMarkdown(partialMath)).not.toThrow()
  })

  it('does not treat currency values like $10 and $20 as KaTeX math', () => {
    const markdown = 'The item costs $10 and shipping is $20.'
    const html = renderMarkdown(markdown)

    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$10 and shipping is $20')
  })

  it('does not treat dollar signs across multiple lines as inline math', () => {
    const markdown =
      'First line with $variable.\nSecond line with – an en-dash and $another variable.'
    const html = renderMarkdown(markdown)

    expect(html).not.toContain('class="katex"')
    expect(html).toContain('– an en-dash')
  })

  it('safely tolerates unicode characters (e.g. en-dash "–") in math without crashing', () => {
    const markdown = 'Formula with unusual symbol: $x – y$'
    expect(() => renderMarkdown(markdown)).not.toThrow()
  })
})

describe('parseContentSegments', () => {
  it('returns single markdown segment when no mermaid diagrams are present', () => {
    const text = 'Just plain text and a table:\n| A | B |\n| - | - |\n| 1 | 2 |'
    const segments = parseContentSegments(text)

    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ type: 'markdown', content: text })
  })

  it('splits alternating markdown and mermaid diagrams cleanly', () => {
    const text = 'Before diagram\n```mermaid\ngraph TD\n  A --> B\n```\nAfter diagram'
    const segments = parseContentSegments(text)

    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: 'markdown', content: 'Before diagram\n' })
    expect(segments[1]).toEqual({ type: 'mermaid', code: 'graph TD\n  A --> B\n' })
    expect(segments[2]).toEqual({ type: 'markdown', content: '\nAfter diagram' })
  })

  it('handles active streaming unclosed mermaid code blocks without crashing', () => {
    const streamingText = 'Live analysis:\n```mermaid\ngraph TD\n  A --> '
    const segments = parseContentSegments(streamingText)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ type: 'markdown', content: 'Live analysis:\n' })
    expect(segments[1]).toEqual({ type: 'mermaid', code: 'graph TD\n  A --> ' })
  })
})
