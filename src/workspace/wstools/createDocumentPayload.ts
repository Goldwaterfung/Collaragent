import process from 'node:process'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  AlignEnum,
  BlockTypeEnum,
  DocumentSchema,
  InlineRunSchema,
  type Align,
  type Block,
  type BlockType,
  type DocumentPayload,
  type InlineRun,
  type TableRow,
  type TableCell
} from '@workspace/persistence/editorContent'
import { convertHtmlToBlocks } from '@workspace/editor/schemas/htmlContentConversion'

export type CreateDocumentPayloadOptions = {
  heading?: string
  paragraphs?: string[]
  blocks?: Block[]
}

/**
 * Creates a document payload from a heading and a list of paragraphs.
 * @param options The options to use to create the document payload.
 * @returns The document payload.
 */
export function createDocumentPayload(options: CreateDocumentPayloadOptions = {}): DocumentPayload {
  const { heading, paragraphs = [], blocks = [] } = options

  const derivedBlocks: Block[] = blocks.slice()

  if (derivedBlocks.length === 0) {
    if (heading && heading.trim().length > 0) {
      derivedBlocks.push({
        type: 'h1',
        align: 'center',
        children: [
          {
            text: heading.trim(),
            bold: true
          }
        ]
      })
    }

    for (const paragraph of paragraphs) {
      const text = paragraph.trim()
      if (!text) continue
      derivedBlocks.push({
        type: 'paragraph',
        children: [
          {
            text
          }
        ]
      })
    }
  }

  if (derivedBlocks.length === 0) {
    derivedBlocks.push({
      type: 'paragraph',
      content: 'Empty document'
    })
  }

  return DocumentSchema.parse({ blocks: derivedBlocks })
}

type BlockDraft = {
  type: BlockType
  align?: Align
  runs?: InlineRun[]
  content?: string
  tableRows?: TableRow[]
  html?: string
}

export type CreateDocumentCliArgs = {
  blocks: BlockDraft[]
  outputPath?: string
  help?: boolean
}

export const CREATE_DOCUMENT_CLI_HELP = `Usage: npx tsx app/wstools/createDocumentPayload.ts [options]

Options:
  --block "type=<h1|h2|h3|h4|paragraph|table>;align=<left|center|right>;text=<content>;html=<markup>"
                        Add a block (repeatable). Alignment/text/html are optional.
  --table-html "<markup>"
                        Add a table block from an HTML table string (e.g. <table>...</table>).
  --table-csv "header=Col1,Col2;row=Val1,Val2;row=Val3,Val4"
                        Add a table block using shorthand CSV syntax.
  --run "text=<content>;bold;italic;underline"
                        Attach an inline run to the most recent block.
  --output <path>        Write JSON payload to file instead of stdout
  -h, --help             Show this help message

Examples:
  npx tsx app/wstools/createDocumentPayload.ts \\
    --block "type=h1;align=center" \\
    --run "text=Doc Title;bold" \\
    --table-html "<table><tr><th>Name</th><th>Role</th></tr><tr><td>Alice</td><td>Admin</td></tr></table>"
`

function parseBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === undefined) return undefined
  if (value === '' || value.toLowerCase() === 'true' || value === '1') return true
  if (value.toLowerCase() === 'false' || value === '0') return false
  return true
}

function parseKeyValueList(input: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {}
  const parts = input
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  for (const part of parts) {
    const [key, rawValue] = part.split('=', 2).map((segment) => segment.trim())
    if (!key) continue
    if (rawValue === undefined || rawValue === '') {
      result[key] = true
    } else {
      result[key] = rawValue
    }
  }
  return result
}

function coerceBlockType(value: string | boolean | undefined): BlockType {
  if (typeof value !== 'string') {
    throw new Error(`Block requires a valid type (${BlockTypeEnum.options.join(', ')})`)
  }
  const trimmed = value.trim()
  if (!BlockTypeEnum.options.includes(trimmed as BlockType)) {
    throw new Error(`Unsupported block type: ${trimmed}`)
  }
  return trimmed as BlockType
}

function coerceAlign(value: string | boolean | undefined): Align | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!AlignEnum.options.includes(trimmed as Align)) {
    throw new Error(`Unsupported alignment: ${trimmed}`)
  }
  return trimmed as Align
}

function parseCsvToTableBlock(input: string): Block {
  const parts = input
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
  const rows: TableRow[] = []
  for (const part of parts) {
    const [key, rawValue] = part.split('=', 2).map((s) => s.trim())
    if (!key || rawValue === undefined) continue
    const isHeader = key.toLowerCase() === 'header' || key.toLowerCase() === 'headers'
    const cells: TableCell[] = rawValue.split(',').map((val) => ({
      children: [{ text: val.trim() }],
      headerState: isHeader ? 1 : 0
    }))
    rows.push({ cells })
  }

  if (rows.length === 0) {
    rows.push({ cells: [{ children: [{ text: '' }], headerState: 0 }] })
  }

  return {
    type: 'table',
    tableRows: rows
  }
}

function parseRun(input: string): InlineRun {
  const kv = parseKeyValueList(input)
  const text = typeof kv.text === 'string' ? kv.text : undefined
  if (!text) {
    throw new Error("Run requires a text value, e.g. --run 'text=Hello;bold'")
  }
  const runCandidate = {
    text,
    bold: parseBoolean(kv.bold),
    italic: parseBoolean(kv.italic),
    underline: parseBoolean(kv.underline)
  } satisfies InlineRun
  return InlineRunSchema.parse(runCandidate)
}

function parseBlock(input: string): BlockDraft {
  const kv = parseKeyValueList(input)
  const type = coerceBlockType(kv.type)
  const align = coerceAlign(kv.align)
  const content = typeof kv.text === 'string' ? kv.text : undefined
  const html = typeof kv.html === 'string' ? kv.html : undefined

  const block: BlockDraft = {
    type,
    align,
    content,
    html
  }

  return block
}

export function parseCreateDocumentCliArgs(argv: string[]): CreateDocumentCliArgs {
  const result: CreateDocumentCliArgs = {
    blocks: []
  }

  let currentBlock: BlockDraft | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      result.help = true
      continue
    }

    if (arg.startsWith('--output=')) {
      result.outputPath = arg.slice('--output='.length)
      continue
    }
    if (arg === '--output' && i + 1 < argv.length) {
      result.outputPath = argv[i + 1]
      i += 1
      continue
    }

    if (arg.startsWith('--block=')) {
      currentBlock = parseBlock(arg.slice('--block='.length))
      result.blocks.push(currentBlock)
      continue
    }
    if (arg === '--block' && i + 1 < argv.length) {
      currentBlock = parseBlock(argv[i + 1])
      result.blocks.push(currentBlock)
      i += 1
      continue
    }

    if (arg.startsWith('--table-html=')) {
      const html = arg.slice('--table-html='.length)
      const parsedBlocks = convertHtmlToBlocks(html)
      const tableBlock = parsedBlocks.find((b) => b.type === 'table') || parsedBlocks[0]
      if (tableBlock && tableBlock.tableRows) {
        currentBlock = {
          type: 'table',
          tableRows: tableBlock.tableRows,
          align: tableBlock.align
        }
        result.blocks.push(currentBlock)
      }
      continue
    }
    if (arg === '--table-html' && i + 1 < argv.length) {
      const html = argv[i + 1]
      const parsedBlocks = convertHtmlToBlocks(html)
      const tableBlock = parsedBlocks.find((b) => b.type === 'table') || parsedBlocks[0]
      if (tableBlock && tableBlock.tableRows) {
        currentBlock = {
          type: 'table',
          tableRows: tableBlock.tableRows,
          align: tableBlock.align
        }
        result.blocks.push(currentBlock)
      }
      i += 1
      continue
    }

    if (arg.startsWith('--table-csv=')) {
      const csv = arg.slice('--table-csv='.length)
      const tableBlock = parseCsvToTableBlock(csv)
      currentBlock = {
        type: 'table',
        tableRows: tableBlock.tableRows
      }
      result.blocks.push(currentBlock)
      continue
    }
    if (arg === '--table-csv' && i + 1 < argv.length) {
      const csv = argv[i + 1]
      const tableBlock = parseCsvToTableBlock(csv)
      currentBlock = {
        type: 'table',
        tableRows: tableBlock.tableRows
      }
      result.blocks.push(currentBlock)
      i += 1
      continue
    }

    if (arg.startsWith('--run=')) {
      if (!currentBlock) {
        throw new Error('--run must follow a --block declaration')
      }
      const run = parseRun(arg.slice('--run='.length))
      currentBlock.runs = currentBlock.runs ? [...currentBlock.runs, run] : [run]
      continue
    }
    if (arg === '--run' && i + 1 < argv.length) {
      if (!currentBlock) {
        throw new Error('--run must follow a --block declaration')
      }
      const run = parseRun(argv[i + 1])
      currentBlock.runs = currentBlock.runs ? [...currentBlock.runs, run] : [run]
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return result
}

function draftsToBlocks(blocks: BlockDraft[]): Block[] {
  return blocks.map((block) => {
    if (block.type === 'table') {
      if (block.tableRows && block.tableRows.length > 0) {
        return {
          type: 'table',
          align: block.align,
          tableRows: block.tableRows
        } satisfies Block
      }
      if (block.html) {
        const parsed = convertHtmlToBlocks(block.html)
        const tbl = parsed.find((b) => b.type === 'table')
        if (tbl && tbl.tableRows) {
          return {
            type: 'table',
            align: block.align || tbl.align,
            tableRows: tbl.tableRows
          } satisfies Block
        }
      }
      return {
        type: 'table',
        align: block.align,
        tableRows: [{ cells: [{ children: [{ text: '' }], headerState: 0 }] }]
      } satisfies Block
    }

    if (block.runs && block.runs.length > 0) {
      const children = block.runs.map((r) => InlineRunSchema.parse(r))
      return {
        type: block.type,
        align: block.align,
        children
      } satisfies Block
    }
    return {
      type: block.type,
      align: block.align,
      content: block.content ?? ''
    } satisfies Block
  })
}

export function createDocumentPayloadFromCliArgs(argv: string[]) {
  const parsed = parseCreateDocumentCliArgs(argv)
  if (parsed.help) {
    return {
      helpRequested: true,
      outputPath: parsed.outputPath
    } as const
  }

  const blocks = draftsToBlocks(parsed.blocks)
  const payload = createDocumentPayload({ blocks })

  return {
    helpRequested: false,
    outputPath: parsed.outputPath,
    payload
  } as const
}

async function runCli() {
  const argv = process.argv.slice(2)
  const { payload, outputPath, helpRequested } = createDocumentPayloadFromCliArgs(argv)

  if (helpRequested) {
    process.stdout.write(CREATE_DOCUMENT_CLI_HELP)
    return
  }

  if (!payload) {
    throw new Error('Failed to build document payload from CLI arguments')
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`

  if (outputPath) {
    await fs.writeFile(outputPath, serialized, 'utf8')
    process.stdout.write(`Payload written to ${outputPath}\n`)
  } else {
    process.stdout.write(serialized)
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((err) => {
    console.error('Failed to create document payload:', err)
    process.exitCode = 1
  })
}
