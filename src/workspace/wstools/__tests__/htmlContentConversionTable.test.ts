import { describe, it, expect } from 'vitest'
import {
  convertHtmlToBlocks,
  convertBlocksToPatchView,
  convertBlocksToHtml
} from '../../editor/schemas/htmlContentConversion'
import { PatchCommandEngine } from '@collaragent/runtime'
import { BlockSchema } from '@workspace/persistence/editorContent'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import {
  WorkspaceToolError,
  buildEditableBlocks,
  getCodeRecommendFix,
  extractErrorInfo
} from '@collaragent/tools/WorkspaceTools'

describe('HTML Table Conversion & PatchView Pipeline', () => {
  describe('convertHtmlToBlocks with table tags', () => {
    it('parses a standard 2x2 HTML table into a table Block', () => {
      const html = `<table><tr><td>Row 1 Col 1</td><td>Row 1 Col 2</td></tr><tr><td>Row 2 Col 1</td><td>Row 2 Col 2</td></tr></table>`
      const blocks = convertHtmlToBlocks(html)

      expect(blocks).toHaveLength(1)
      const tableBlock = blocks[0]
      expect(tableBlock.type).toBe('table')
      expect(tableBlock.tableRows).toHaveLength(2)

      const row1 = tableBlock.tableRows![0]
      expect(row1.cells).toHaveLength(2)
      expect(row1.cells[0].children?.[0].text).toBe('Row 1 Col 1')
      expect(row1.cells[1].children?.[0].text).toBe('Row 1 Col 2')

      const row2 = tableBlock.tableRows![1]
      expect(row2.cells).toHaveLength(2)
      expect(row2.cells[0].children?.[0].text).toBe('Row 2 Col 1')
      expect(row2.cells[1].children?.[0].text).toBe('Row 2 Col 2')

      // Validate schema compliance
      expect(() => BlockSchema.parse(tableBlock)).not.toThrow()
    })

    it('parses headers, colspan, rowspan, scope, and background color', () => {
      const html = `<table>
        <thead>
          <tr><th colspan="2" scope="col">Header Title</th></tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="2" style="background-color: #f0f0f0;">Merged Cell</td>
            <td>Row 1 Content</td>
          </tr>
          <tr>
            <td>Row 2 Content</td>
          </tr>
        </tbody>
      </table>`

      const blocks = convertHtmlToBlocks(html)
      expect(blocks).toHaveLength(1)
      const table = blocks[0]
      expect(table.type).toBe('table')
      expect(table.tableRows).toHaveLength(3)

      // Header row
      const headerRow = table.tableRows![0]
      expect(headerRow.cells).toHaveLength(1)
      expect(headerRow.cells[0].headerState).toBe(1)
      expect(headerRow.cells[0].colSpan).toBe(2)
      expect(headerRow.cells[0].children?.[0].text).toBe('Header Title')

      // Body row 1
      const bodyRow1 = table.tableRows![1]
      expect(bodyRow1.cells).toHaveLength(2)
      expect(bodyRow1.cells[0].rowSpan).toBe(2)
      expect(bodyRow1.cells[0].backgroundColor).toBe('#f0f0f0')
      expect(bodyRow1.cells[0].children?.[0].text).toBe('Merged Cell')
      expect(bodyRow1.cells[0].children?.[0].text).toBe('Merged Cell')
      expect(bodyRow1.cells[1].children?.[0].text).toBe('Row 1 Content')

      // Body row 2
      const bodyRow2 = table.tableRows![2]
      expect(bodyRow2.cells).toHaveLength(1)
      expect(bodyRow2.cells[0].children?.[0].text).toBe('Row 2 Content')

      expect(() => BlockSchema.parse(table)).not.toThrow()
    })

    it('parses inline formatting and LaTeX equations inside cells', () => {
      const html = `<table><tr><td><b>Bold text</b> and <i>italic</i></td><td>Equation: $E = mc^2$</td></tr></table>`
      const blocks = convertHtmlToBlocks(html)

      expect(blocks).toHaveLength(1)
      const table = blocks[0]
      const cells = table.tableRows![0].cells

      // Cell 1: formatting
      expect(cells[0].children).toEqual([
        { text: 'Bold text', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true }
      ])

      // Cell 2: math equation
      expect(cells[1].children).toEqual([
        { text: 'Equation: ' },
        { text: '', equation: 'E = mc^2', inline: true }
      ])
    })

    it('recovers gracefully from empty or malformed tables', () => {
      const emptyHtml = `<table></table>`
      const blocks1 = convertHtmlToBlocks(emptyHtml)
      expect(blocks1).toHaveLength(1)
      expect(blocks1[0].tableRows).toHaveLength(1)
      expect(blocks1[0].tableRows![0].cells).toHaveLength(1)

      const unclosedHtml = `<table><tr><td>Dangling content`
      const blocks2 = convertHtmlToBlocks(unclosedHtml)
      expect(blocks2).toHaveLength(1)
      expect(blocks2[0].type).toBe('table')
      expect(blocks2[0].tableRows![0].cells[0].children?.[0].text).toBe('Dangling content')
    })
  })

  describe('Round-Trip & Patch View Consistency', () => {
    it('serializes table block to a single-line canonical patch view and parses back identically', () => {
      const initialHtml = `<table data-block-id="tbl-test"><tr><th colspan="2">Heading</th></tr><tr><td style="background-color: #eef">Data 1</td><td>Data 2</td></tr></table>`
      const blocks = convertHtmlToBlocks(initialHtml)
      expect(blocks).toHaveLength(1)
      blocks[0].id = 'tbl-test'

      const patchView = convertBlocksToPatchView(blocks)
      // Invariant: Single line in patch view
      expect(patchView.split('\n')).toHaveLength(1)
      expect(patchView).toContain('data-block-id="tbl-test"')
      expect(patchView).toContain('<th colspan="2">Heading</th>')
      expect(patchView).toContain('style="background-color: #eef"')

      // Parse back
      const roundTripBlocks = convertHtmlToBlocks(patchView)
      expect(roundTripBlocks).toHaveLength(1)
      expect(roundTripBlocks[0].id).toBe('tbl-test')
      expect(roundTripBlocks[0].tableRows).toHaveLength(2)
      expect(roundTripBlocks[0].tableRows![0].cells[0].headerState).toBe(1)
      expect(roundTripBlocks[0].tableRows![0].cells[0].colSpan).toBe(2)
      expect(roundTripBlocks[0].tableRows![1].cells[0].backgroundColor).toBe('#eef')
    })

    it('generates valid HTML in convertBlocksToHtml for DOCX export', () => {
      const html = `<table id="tbl-docx" data-block-id="tbl-docx"><tr><th>Col 1</th><th>Col 2</th></tr><tr><td>A</td><td>B</td></tr></table>`
      const blocks = convertHtmlToBlocks(html)
      blocks[0].id = 'tbl-docx'

      const exportedHtml = convertBlocksToHtml(blocks)
      expect(exportedHtml).toContain('<table id="tbl-docx" data-block-id="tbl-docx">')
      expect(exportedHtml).toContain('<th>Col 1</th><th>Col 2</th>')
      expect(exportedHtml).toContain('<td>A</td><td>B</td>')
    })
  })

  describe('PatchCommandEngine Table Operations', () => {
    it('inserts a new table block after an existing paragraph', () => {
      const currentPatchView = `<p data-block-id="p1">Intro paragraph</p>\n<p data-block-id="p2">Outro paragraph</p>`
      const operations = [
        {
          action: 'insert' as const,
          blockId: 'p1',
          anchor: 'after' as const,
          newHtml: `<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`
        }
      ]

      const result = PatchCommandEngine.compile(currentPatchView, operations)
      expect(result.applied).toBe(true)
      if (!result.applied) return

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].type).toBe('editor:insert_block')
      const insertCmd = result.commands[0]
      if (insertCmd.type === 'editor:insert_block') {
        expect(insertCmd.index).toBe(1)
        expect(insertCmd.block.type).toBe('table')
        expect(insertCmd.block.tableRows).toHaveLength(2)
      }

      // Verify workingLines maintained 1 line per block
      expect(result.updatedLines).toHaveLength(3)
      expect(result.updatedLines[1]).toContain('<table data-block-id=')
    })

    it('updates an existing table block with new cell content', () => {
      const currentPatchView = `<table data-block-id="tbl1"><tr><td>Old Value</td></tr></table>`
      const operations = [
        {
          action: 'update' as const,
          blockId: 'tbl1',
          newHtml: `<table><tr><td>New Updated Value</td></tr></table>`
        }
      ]

      const result = PatchCommandEngine.compile(currentPatchView, operations)
      expect(result.applied).toBe(true)
      if (!result.applied) return

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].type).toBe('editor:update_block')
      const updateCmd = result.commands[0]
      if (updateCmd.type === 'editor:update_block') {
        expect(updateCmd.blockId).toBe('tbl1')
        expect(updateCmd.changes.type).toBe('table')
        expect(updateCmd.changes.tableRows[0].cells[0].children[0].text).toBe('New Updated Value')
      }
    })

    it('deletes an existing table block', () => {
      const currentPatchView = `<p data-block-id="p1">Paragraph</p>\n<table data-block-id="tbl1"><tr><td>To Delete</td></tr></table>`
      const operations = [
        {
          action: 'delete' as const,
          blockId: 'tbl1'
        }
      ]

      const result = PatchCommandEngine.compile(currentPatchView, operations)
      expect(result.applied).toBe(true)
      if (!result.applied) return

      expect(result.commands).toHaveLength(1)
      expect(result.commands[0]).toEqual({
        type: 'editor:remove_block',
        blockId: 'tbl1'
      })
      expect(result.updatedLines).toHaveLength(1)
      expect(result.updatedLines[0]).toBe('<p data-block-id="p1">Paragraph</p>')
    })
  })

  describe('Workspace Error Handling & Diagnostic Recommendations', () => {
    it('provides specific recommendations for HTML and content validation errors', () => {
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_HTML_EMPTY)).toBe(
        'The provided html_content is empty. Provide standard HTML tags like <h1>, <p>, or <table>.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_HTML_NO_VALID_BLOCKS)).toBe(
        'The HTML string did not produce any valid blocks. Ensure content is wrapped in standard HTML tags such as <p>...</p> or <table>...</table>.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_HTML_TABLE_MALFORMED)).toBe(
        'The table markup contains no rows or cells. Ensure <table> contains at least one <tr> with <th> or <td> elements.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_PAYLOAD_INVALID)).toBe(
        'The document payload structure is invalid. Verify the document format.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING)).toBe(
        'Document blocks are missing persistent IDs. The document must be saved or normalized.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_BLOCK_ENCODING_FAILED)).toBe(
        'Failed to encode block identity in patch view. Check block HTML syntax.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND)).toBe(
        'Use listWorkspaceItems to see available documents and verify the exact name.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_PROJECT_NOT_FOUND)).toBe(
        'Use listWorkspaceItems to verify available project names.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_MULTIPLE_INSTANCES)).toBe(
        'Provide a more specific projectName to disambiguate the document.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_SYNC_DISCONNECTED)).toBe(
        'The workspace server may be unreachable. Retry the operation.'
      )
      expect(getCodeRecommendFix('UNKNOWN_CODE')).toBeUndefined()
    })

    it('extractErrorInfo extracts code and actionable fix from WorkspaceToolError', () => {
      const err = new WorkspaceToolError(
        'html_content must not be empty.',
        WorkspaceErrorCode.WORKSPACE_HTML_EMPTY
      )
      const info = extractErrorInfo(err)
      expect(info.code).toBe(WorkspaceErrorCode.WORKSPACE_HTML_EMPTY)
      expect(info.message).toBe('html_content must not be empty.')
      expect(info.recommendFix).toBe(
        'The provided html_content is empty. Provide standard HTML tags like <h1>, <p>, or <table>.'
      )
    })

    it('extractErrorInfo extracts bracketed protocol error codes', () => {
      const err = new Error(
        `[${WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND}] Target document does not exist.`
      )
      const info = extractErrorInfo(err)
      expect(info.code).toBe(WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND)
      expect(info.message).toBe('Target document does not exist.')
      expect(info.recommendFix).toBe(
        'Use listWorkspaceItems to see available documents and verify the exact name.'
      )
    })

    it('extractErrorInfo handles generic unexpected errors gracefully', () => {
      const err = new Error('Network timeout connecting to workspace port')
      const info = extractErrorInfo(err)
      expect(info.code).toBe('CONNECTION_ERROR')
      expect(info.message).toBe('Network timeout connecting to workspace port')
      expect(info.recommendFix).toBe(
        'The workspace server may be unreachable. Retry the operation.'
      )
    })

    it('buildEditableBlocks accurately maps table and paragraph blocks', () => {
      const blocks = convertHtmlToBlocks('<h1>Title</h1><table><tr><td>Cell</td></tr></table>')
      blocks[0].id = 'h1'
      blocks[1].id = 'tbl1'

      const editable = buildEditableBlocks(blocks)
      expect(editable).toHaveLength(2)
      expect(editable[0]).toEqual({
        id: 'h1',
        html: '<h1>Title</h1>'
      })
      expect(editable[1].id).toBe('tbl1')
      expect(editable[1].html).toContain('<table>')
      expect(editable[1].html).toContain('<td>Cell</td>')
    })

    it('buildEditableBlocks throws structured error when blocks array or IDs are invalid', () => {
      // Non-array input
      expect(() => {
        const notAnArray = {} as unknown as Parameters<typeof buildEditableBlocks>[0]
        buildEditableBlocks(notAnArray)
      }).toThrowError(/Document payload blocks must be an array/)

      try {
        const notAnArray = {} as unknown as Parameters<typeof buildEditableBlocks>[0]
        buildEditableBlocks(notAnArray)
      } catch (e) {
        expect(e).toBeInstanceOf(WorkspaceToolError)
        expect((e as WorkspaceToolError).code).toBe(WorkspaceErrorCode.WORKSPACE_PAYLOAD_INVALID)
      }

      // Block missing ID
      expect(() => {
        buildEditableBlocks([{ type: 'paragraph', children: [] }])
      }).toThrowError(/missing a required block ID/)

      try {
        buildEditableBlocks([{ type: 'paragraph', children: [] }])
      } catch (e) {
        expect(e).toBeInstanceOf(WorkspaceToolError)
        expect((e as WorkspaceToolError).code).toBe(
          WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING
        )
      }
    })
  })
})
