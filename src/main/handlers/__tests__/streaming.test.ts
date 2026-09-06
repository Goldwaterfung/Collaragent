import { describe, it, expect } from 'vitest'
import { extractToolMessageContent, parseToolResult } from '../streaming'

describe('streaming - extractToolMessageContent', () => {
  it('handles null and undefined', () => {
    expect(extractToolMessageContent(null)).toBeNull()
    expect(extractToolMessageContent(undefined)).toBeUndefined()
  })

  it('preserves plain string content', () => {
    expect(extractToolMessageContent('hello world')).toBe('hello world')
  })

  it('unpacks content block array like [{ type: "text", text: "..." }]', () => {
    const blocks = [{ type: 'text', text: 'file content here' }]
    expect(extractToolMessageContent(blocks)).toBe('file content here')
  })

  it('joins multiple text blocks with newlines', () => {
    const blocks = [
      { type: 'text', text: 'part 1' },
      { type: 'text', text: 'part 2' }
    ]
    expect(extractToolMessageContent(blocks)).toBe('part 1\npart 2')
  })

  it('unpacks single text block object { type: "text", text: "..." }', () => {
    const block = { type: 'text', text: 'single text' }
    expect(extractToolMessageContent(block)).toBe('single text')
  })

  it('preserves non-content-block objects and arrays', () => {
    const normalObj = { action: 'create', instanceId: '123' }
    expect(extractToolMessageContent(normalObj)).toEqual(normalObj)

    const normalArr = [1, 2, 3]
    expect(extractToolMessageContent(normalArr)).toEqual(normalArr)
  })
})

describe('streaming - parseToolResult', () => {
  it('preserves rawArtifact when provided', () => {
    const artifact = { summary: 'Subagent completed', messages: [] }
    expect(parseToolResult('raw string', artifact)).toBe(artifact)
  })

  it('returns undefined when rawContent is undefined and no artifact', () => {
    expect(parseToolResult(undefined, undefined)).toBeUndefined()
  })

  it('unpacks content block array directly', () => {
    const blocks = [{ type: 'text', text: 'export default 123;' }]
    expect(parseToolResult(blocks, undefined)).toBe('export default 123;')
  })

  it('parses JSON string of content block array and unpacks it', () => {
    const jsonString = JSON.stringify([{ type: 'text', text: 'unpacked from json' }])
    expect(parseToolResult(jsonString, undefined)).toBe('unpacked from json')
  })

  it('parses structured JSON objects (e.g. Workspace tools return objects)', () => {
    const wsResult = JSON.stringify({ action: 'createDocument', instanceId: 'doc-abc' })
    expect(parseToolResult(wsResult, undefined)).toEqual({
      action: 'createDocument',
      instanceId: 'doc-abc'
    })
  })

  it('preserves non-JSON string content', () => {
    const plain = 'regular terminal output\nexit 0'
    expect(parseToolResult(plain, undefined)).toBe(plain)
  })
})
