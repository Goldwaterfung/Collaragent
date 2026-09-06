// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { formatToolResult, isFSTool } from '../FilesystemCard'

describe('FilesystemCard - formatToolResult', () => {
  it('returns empty string for null and undefined', () => {
    expect(formatToolResult(null)).toBe('')
    expect(formatToolResult(undefined)).toBe('')
  })

  it('returns string results as-is', () => {
    const raw = 'line 1\nline 2\nconst x = 10;'
    expect(formatToolResult(raw)).toBe(raw)
  })

  it('formats number and boolean results', () => {
    expect(formatToolResult(42)).toBe('42')
    expect(formatToolResult(true)).toBe('true')
  })

  it('extracts text from content block array like [{ type: "text", text: "..." }]', () => {
    const deepagentsReadFileResult = [
      {
        type: 'text',
        text: 'import { useState } from "react";\nexport function App() {}'
      }
    ]
    expect(formatToolResult(deepagentsReadFileResult)).toBe(
      'import { useState } from "react";\nexport function App() {}'
    )
  })

  it('extracts and joins multiple text content blocks', () => {
    const multiBlockResult = [
      { type: 'text', text: 'Section 1' },
      { type: 'text', text: 'Section 2' }
    ]
    expect(formatToolResult(multiBlockResult)).toBe('Section 1\nSection 2')
  })

  it('handles image blocks gracefully', () => {
    const imageBlock = [{ type: 'image', data: 'abc' }]
    expect(formatToolResult(imageBlock)).toBe('[Image]')
  })

  it('joins string arrays with newlines', () => {
    const paths = ['/src/index.ts', '/src/App.tsx', '/src/utils.ts']
    expect(formatToolResult(paths)).toBe('/src/index.ts\n/src/App.tsx\n/src/utils.ts')
  })

  it('handles single object content block { type: "text", text: "..." }', () => {
    const singleBlock = { type: 'text', text: 'Hello from single block' }
    expect(formatToolResult(singleBlock)).toBe('Hello from single block')
  })

  it('extracts error and message fields from structured object', () => {
    expect(formatToolResult({ error: 'File not found' })).toBe('File not found')
    expect(formatToolResult({ message: 'Operation succeeded' })).toBe('Operation succeeded')
    expect(formatToolResult({ output: 'terminal output' })).toBe('terminal output')
  })

  it('safely pretty-prints generic JSON objects without crashing', () => {
    const obj = { key: 'value', count: 5 }
    const formatted = formatToolResult(obj)
    expect(formatted).toContain('"key": "value"')
    expect(formatted).toContain('"count": 5')
  })

  it('handles objects with circular references safely', () => {
    const circular: Record<string, unknown> = { name: 'circular' }
    circular.self = circular
    expect(() => formatToolResult(circular)).not.toThrow()
  })
})

describe('FilesystemCard - isFSTool', () => {
  it('identifies filesystem tool names accurately', () => {
    expect(isFSTool('read_file')).toBe(true)
    expect(isFSTool('execute')).toBe(true)
    expect(isFSTool('write_file')).toBe(true)
    expect(isFSTool('edit_file')).toBe(true)
    expect(isFSTool('ls')).toBe(true)
    expect(isFSTool('glob')).toBe(true)
    expect(isFSTool('grep')).toBe(true)

    expect(isFSTool('readDocument')).toBe(false)
    expect(isFSTool('writeGraph')).toBe(false)
    expect(isFSTool('task')).toBe(false)
    expect(isFSTool(undefined)).toBe(false)
  })
})

describe('FilesystemCard - React component rendering', () => {
  it('renders read_file with file path only and no raw payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-read-1',
      name: 'read_file',
      args: { file_path: '/path/to/component.tsx' },
      result: [
        {
          type: 'text',
          text: 'export const MyComponent = () => <div>Hello</div>'
        }
      ],
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('component.tsx')
    expect(html).toContain('Read:')
    expect(html).not.toContain('export const MyComponent')
  })

  it('renders grep with search pattern and path only and no raw match payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-grep-1',
      name: 'grep',
      args: { pattern: 'useState', path: '/src' },
      result: 'src/App.tsx:10: const [state, setState] = useState()',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('useState')
    expect(html).toContain('Search:')
    expect(html).toContain('/src')
    expect(html).not.toContain('const [state, setState]')
  })

  it('renders ls with directory path only and no raw items payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-ls-1',
      name: 'ls',
      args: { path: '/src/components' },
      result: 'file1.tsx\nfile2.tsx\nfile3.tsx',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('/src/components')
    expect(html).toContain('List:')
    expect(html).not.toContain('file1.tsx')
  })

  it('renders glob with pattern only and no raw matches payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-glob-1',
      name: 'glob',
      args: { pattern: '**/*.test.ts', path: '/src' },
      result: '/src/a.test.ts\n/src/b.test.ts',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('**/*.test.ts')
    expect(html).toContain('Glob:')
    expect(html).not.toContain('/src/a.test.ts')
  })

  it('renders execute with command only and no raw terminal output payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-exec-1',
      name: 'execute',
      args: { command: 'yarn test' },
      result: 'All 15 tests passed with exit code 0',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('yarn test')
    expect(html).not.toContain('All 15 tests passed with exit code 0')
  })

  it('renders edit_file and write_file with file path only', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const editCall = {
      id: 'tc-edit-1',
      name: 'edit_file',
      args: { file_path: '/src/main.ts', old_string: 'a', new_string: 'b' },
      result: { occurrences: 1 },
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: editCall }))
    expect(html).toContain('/src/main.ts')
    expect(html).toContain('Edited:')
  })

  it('renders error state safely when result contains error', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-read-err',
      name: 'read_file',
      args: { file_path: '/missing.txt' },
      result: [{ type: 'text', text: 'Error: File not found' }],
      status: 'error' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('Error: File not found')
  })

  it('renders read_file of SKILL.md as a clean Skill card without raw payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard, isSkillFilePath, extractSkillName } = await import('../FilesystemCard')

    const skillPath =
      '/Users/goldenfung/Documents/apply-jobs/.agents/skills/executive-candidate-dossier-analyzer/SKILL.md'
    expect(isSkillFilePath(skillPath)).toBe(true)
    expect(extractSkillName(skillPath)).toBe('executive-candidate-dossier-analyzer')

    const toolCall = {
      id: 'call_f1ef1f3c73c7465cbb5572af',
      name: 'read_file',
      args: {
        file_path: skillPath,
        limit: 1000
      },
      result: [
        {
          type: 'text',
          text: '--- \n name: executive-candidate-dossier-analyzer \n description: Detailed instructions... \n --- \n 500 lines of raw text'
        }
      ],
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('Skill:')
    expect(html).toContain('executive-candidate-dossier-analyzer')
    expect(html).not.toContain('500 lines of raw text')
    expect(html).not.toContain('Detailed instructions')
  })

  it('renders read_file with path fallback property instead of file_path', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-path-fallback',
      name: 'read_file',
      args: {
        path: '/Users/goldenfung/.agents/skills/neuro-economics-product-design/SKILL.md'
      },
      result: 'raw skill content',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('Skill:')
    expect(html).toContain('neuro-economics-product-design')
    expect(html).not.toContain('raw skill content')
  })

  it('renders direct skill tool calls cleanly without raw payload', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-skill-direct',
      name: 'read_skill',
      args: {
        name: 'apa-research-execution-specialist'
      },
      result: 'Skill markdown content here',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('Skill:')
    expect(html).toContain('apa-research-execution-specialist')
    expect(html).not.toContain('Skill markdown content here')
  })

  it('renders delete tool calls cleanly with file path', async () => {
    const React = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { FilesystemCard } = await import('../FilesystemCard')

    const toolCall = {
      id: 'tc-delete-1',
      name: 'delete',
      args: {
        file_path: '/src/temp.txt'
      },
      result: 'Deleted',
      status: 'completed' as const
    }

    const html = renderToString(React.createElement(FilesystemCard, { tool: toolCall }))
    expect(html).toContain('Deleted:')
    expect(html).toContain('/src/temp.txt')
  })
})
