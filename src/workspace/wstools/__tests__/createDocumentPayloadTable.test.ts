import { describe, it, expect } from 'vitest'
import {
  parseCreateDocumentCliArgs,
  createDocumentPayloadFromCliArgs
} from '../createDocumentPayload'
import { DocumentSchema } from '@workspace/persistence/editorContent'

describe('createDocumentPayload Table CLI Support', () => {
  it('builds table payload from --table-html argument', () => {
    const argv = [
      '--block=type=h1;text=Report',
      '--table-html=<table><tr><th>Col 1</th><th>Col 2</th></tr><tr><td>A</td><td>B</td></tr></table>'
    ]

    const result = createDocumentPayloadFromCliArgs(argv)
    expect(result.helpRequested).toBe(false)
    if (!result.payload) throw new Error('Expected payload')
    expect(result.payload.blocks).toHaveLength(2)

    const h1 = result.payload.blocks[0]
    expect(h1.type).toBe('h1')

    const table = result.payload.blocks[1]
    expect(table.type).toBe('table')
    expect(table.tableRows).toHaveLength(2)
    expect(table.tableRows![0].cells[0].headerState).toBe(1)
    expect(table.tableRows![0].cells[0].children?.[0].text).toBe('Col 1')
    expect(table.tableRows![1].cells[0].children?.[0].text).toBe('A')

    expect(() => DocumentSchema.parse(result.payload)).not.toThrow()
  })

  it('builds table payload from --block with html', () => {
    const argv = ['--block=type=table;html=<table><tr><td>Direct Cell</td></tr></table>']

    const result = createDocumentPayloadFromCliArgs(argv)
    if (!result.payload) throw new Error('Expected payload')
    expect(result.payload.blocks).toHaveLength(1)
    const table = result.payload.blocks[0]
    expect(table.type).toBe('table')
    expect(table.tableRows![0].cells[0].children?.[0].text).toBe('Direct Cell')
  })

  it('builds table payload from --table-csv shorthand', () => {
    const argv = ['--table-csv=header=Name,Score;row=Alice,100;row=Bob,95']

    const result = createDocumentPayloadFromCliArgs(argv)
    if (!result.payload) throw new Error('Expected payload')
    expect(result.payload.blocks).toHaveLength(1)
    const table = result.payload.blocks[0]
    expect(table.type).toBe('table')
    expect(table.tableRows).toHaveLength(3)

    // Header row
    expect(table.tableRows![0].cells).toHaveLength(2)
    expect(table.tableRows![0].cells[0].headerState).toBe(1)
    expect(table.tableRows![0].cells[0].children?.[0].text).toBe('Name')
    expect(table.tableRows![0].cells[1].children?.[0].text).toBe('Score')

    // Row 1
    expect(table.tableRows![1].cells[0].headerState).toBe(0)
    expect(table.tableRows![1].cells[0].children?.[0].text).toBe('Alice')
    expect(table.tableRows![1].cells[1].children?.[0].text).toBe('100')

    // Row 2
    expect(table.tableRows![2].cells[0].children?.[0].text).toBe('Bob')
    expect(table.tableRows![2].cells[1].children?.[0].text).toBe('95')

    expect(() => DocumentSchema.parse(result.payload)).not.toThrow()
  })

  it('rejects unknown block types with descriptive error message', () => {
    const argv = ['--block=type=invalid_type']
    expect(() => parseCreateDocumentCliArgs(argv)).toThrow('Unsupported block type: invalid_type')
  })
})
