import { describe, it, expect } from 'vitest'
import { anchorCommentToRuns, anchorCommentToBlock, findTextRange } from '../commentAnchoring'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { Block, InlineRun } from '@workspace/persistence/editorContent'

describe('commentAnchoring', () => {
  describe('anchorCommentToRuns', () => {
    it('splits a single run in the middle and attaches commentId', () => {
      const runs: InlineRun[] = [{ text: 'The quick brown fox jumps over the lazy dog.' }]
      const result = anchorCommentToRuns(runs, 'brown fox', 'c-1')

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ text: 'The quick ' })
      expect(result[1]).toEqual({ text: 'brown fox', commentIds: ['c-1'] })
      expect(result[2]).toEqual({ text: ' jumps over the lazy dog.' })
    })

    it('attaches commentId at the start of a run', () => {
      const runs: InlineRun[] = [{ text: 'The quick brown fox' }]
      const result = anchorCommentToRuns(runs, 'The quick', 'c-1')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ text: 'The quick', commentIds: ['c-1'] })
      expect(result[1]).toEqual({ text: ' brown fox' })
    })

    it('attaches commentId at the end of a run', () => {
      const runs: InlineRun[] = [{ text: 'The quick brown fox' }]
      const result = anchorCommentToRuns(runs, 'brown fox', 'c-1')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ text: 'The quick ' })
      expect(result[1]).toEqual({ text: 'brown fox', commentIds: ['c-1'] })
    })

    it('preserves existing formatting attributes across split segments', () => {
      const runs: InlineRun[] = [
        {
          text: 'Formatted paragraph text',
          bold: true,
          italic: true,
          color: '#ff0000',
          fontSize: '16px'
        }
      ]
      const result = anchorCommentToRuns(runs, 'paragraph', 'c-2')

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        text: 'Formatted ',
        bold: true,
        italic: true,
        color: '#ff0000',
        fontSize: '16px'
      })
      expect(result[1]).toEqual({
        text: 'paragraph',
        bold: true,
        italic: true,
        color: '#ff0000',
        fontSize: '16px',
        commentIds: ['c-2']
      })
      expect(result[2]).toEqual({
        text: ' text',
        bold: true,
        italic: true,
        color: '#ff0000',
        fontSize: '16px'
      })
    })

    it('preserves existing commentIds when adding another comment', () => {
      const runs: InlineRun[] = [
        { text: 'First sentence. ', commentIds: ['c-0'] },
        { text: 'Second sentence.' }
      ]
      const result = anchorCommentToRuns(runs, 'sentence', 'c-1')

      expect(result).toHaveLength(4)
      expect(result[0]).toEqual({ text: 'First ', commentIds: ['c-0'] })
      expect(result[1]).toEqual({ text: 'sentence', commentIds: ['c-0', 'c-1'] })
      expect(result[2]).toEqual({ text: '. ', commentIds: ['c-0'] })
      expect(result[3]).toEqual({ text: 'Second sentence.' })
    })

    it('anchors targetText spanning across multiple runs', () => {
      const runs: InlineRun[] = [
        { text: 'Hello ', bold: true },
        { text: 'beautiful ', italic: true },
        { text: 'world!' }
      ]
      const result = anchorCommentToRuns(runs, 'lo beautiful wo', 'c-3')

      expect(result).toHaveLength(5)
      expect(result[0]).toEqual({ text: 'Hel', bold: true })
      expect(result[1]).toEqual({ text: 'lo ', bold: true, commentIds: ['c-3'] })
      expect(result[2]).toEqual({ text: 'beautiful ', italic: true, commentIds: ['c-3'] })
      expect(result[3]).toEqual({ text: 'wo', commentIds: ['c-3'] })
      expect(result[4]).toEqual({ text: 'rld!' })
    })

    it('throws WORKSPACE_COMMENT_TARGET_NOT_FOUND when targetText is absent', () => {
      const runs: InlineRun[] = [{ text: 'Some text here.' }]
      expect(() => anchorCommentToRuns(runs, 'nonexistent', 'c-1')).toThrow(WorkspaceError)
      try {
        anchorCommentToRuns(runs, 'nonexistent', 'c-1')
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceError)
        expect((err as WorkspaceError).code).toBe(
          WorkspaceErrorCode.WORKSPACE_COMMENT_TARGET_NOT_FOUND
        )
      }
    })

    it('throws error when targetText is empty', () => {
      const runs: InlineRun[] = [{ text: 'Some text here.' }]
      expect(() => anchorCommentToRuns(runs, '', 'c-1')).toThrow(WorkspaceError)
    })
  })

  describe('anchorCommentToBlock', () => {
    it('anchors comment to a standard paragraph block', () => {
      const block: Block = {
        id: 'block-1',
        type: 'paragraph',
        children: [{ text: 'A short sentence for testing.' }]
      }

      const updated = anchorCommentToBlock(block, 'short sentence', 'c-99')
      expect(updated.id).toBe('block-1')
      expect(updated.type).toBe('paragraph')
      expect(updated.children).toHaveLength(3)
      expect(updated.children![1]).toEqual({
        text: 'short sentence',
        commentIds: ['c-99']
      })
    })

    it('anchors comment using content fallback if children is empty', () => {
      const block: Block = {
        id: 'block-2',
        type: 'paragraph',
        content: 'Fallback text in content field'
      }

      const updated = anchorCommentToBlock(block, 'text in', 'c-100')
      expect(updated.content).toBeUndefined()
      expect(updated.children).toBeDefined()
      expect(updated.children![1]).toEqual({
        text: 'text in',
        commentIds: ['c-100']
      })
    })

    it('anchors comment inside a table block cell', () => {
      const block: Block = {
        id: 'block-table',
        type: 'table',
        tableRows: [
          {
            cells: [
              { children: [{ text: 'Cell 1' }] },
              { children: [{ text: 'Cell 2 with note' }] }
            ]
          }
        ]
      }

      const updated = anchorCommentToBlock(block, 'with note', 'c-table')
      expect(updated.tableRows![0].cells[0].children![0].text).toBe('Cell 1')
      const secondCellRuns = updated.tableRows![0].cells[1].children!
      expect(secondCellRuns).toHaveLength(2)
      expect(secondCellRuns[0]).toEqual({ text: 'Cell 2 ' })
      expect(secondCellRuns[1]).toEqual({ text: 'with note', commentIds: ['c-table'] })
    })

    it('throws WORKSPACE_COMMENT_TARGET_NOT_FOUND when table has no matching cell', () => {
      const block: Block = {
        id: 'block-table-2',
        type: 'table',
        tableRows: [
          {
            cells: [{ children: [{ text: 'Cell A' }] }]
          }
        ]
      }

      expect(() => anchorCommentToBlock(block, 'Missing', 'c-1')).toThrow(WorkspaceError)
    })
  })

  describe('Unicode & Whitespace Resilient Text Matching (Fix 2)', () => {
    describe('findTextRange', () => {
      it('reproduces and resolves Failure 2: Latin-CJK mixed text with &nbsp; (\\u00A0)', () => {
        // Empirical failure case reported by user:
        // fullText contains \u00A0 after "ticketing", while agent passed regular ASCII space ' '
        const fullText = '要的不是ticketing\u00A0系統，而是一個透明度的統一Trace log系統'
        const targetText = '要的不是ticketing 系統，而是一個透明度的統一Trace log系統'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(range!.start).toBe(0)
        expect(range!.end).toBe(fullText.length)
        expect(fullText.slice(range!.start, range!.end)).toBe(fullText)
      })

      it('matches substring containing non-breaking space (\\u00A0) and narrows coordinates', () => {
        const fullText = '要的不是ticketing\u00A0系統，而是一個透明度的統一Trace log系統'
        const targetText = 'ticketing 系統'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('ticketing\u00A0系統')
      })

      it('matches across ideographic full-width spaces (\\u3000)', () => {
        const fullText = '概念圖譜\u3000核心架構'
        const targetText = '概念圖譜 核心架構'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('概念圖譜\u3000核心架構')
      })

      it('matches text containing zero-width spaces (\\u200B, \\uFEFF, ZWNJ, ZWJ)', () => {
        const fullText = '透明度\u200B的\uFEFF統一\u200CTrace\u200Dlog'
        const targetText = '透明度的統一Tracelog'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe(fullText)
      })

      it('matches when document has multiple consecutive spaces or tabs', () => {
        const fullText = 'Trace   log\t\t系統'
        const targetText = 'Trace log 系統'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('Trace   log\t\t系統')
      })

      it('tolerates Latin-CJK boundary spacing differences (target has space, document does not)', () => {
        const fullText = '要的不是ticketing系統，而是透明度'
        const targetText = 'ticketing 系統'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('ticketing系統')
      })

      it('tolerates Latin-CJK boundary spacing differences (document has space, target does not)', () => {
        const fullText = '要的不是ticketing 系統，而是透明度'
        const targetText = 'ticketing系統'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('ticketing 系統')
      })

      it('strips enclosing quotation marks (「...」, "...", “...”) from agent targetText', () => {
        const fullText = '要的不是ticketing 系統，而是一個透明度系統'
        const targetText = '「要的不是ticketing 系統」'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('要的不是ticketing 系統')
      })

      it('supports case-insensitive normalized matching fallback', () => {
        const fullText = 'Unified TRACE LOG Architecture'
        const targetText = 'unified trace log'

        const range = findTextRange(fullText, targetText)
        expect(range).not.toBeNull()
        expect(fullText.slice(range!.start, range!.end)).toBe('Unified TRACE LOG')
      })

      it('returns null when text genuinely does not exist', () => {
        const fullText = 'Some arbitrary sentence'
        const targetText = 'completely different content'

        const range = findTextRange(fullText, targetText)
        expect(range).toBeNull()
      })
    })

    describe('end-to-end resilient anchoring on runs and table cells', () => {
      it('anchors comment across runs with &nbsp; without modifying document text', () => {
        const runs: InlineRun[] = [
          { text: '要的不是' },
          { text: 'ticketing\u00A0系統', bold: true },
          { text: '，而是一個透明度系統' }
        ]

        const result = anchorCommentToRuns(runs, 'ticketing 系統', 'comment-cjk-1')
        expect(result).toHaveLength(3)
        expect(result[0].text).toBe('要的不是')
        expect(result[1].text).toBe('ticketing\u00A0系統')
        expect(result[1].bold).toBe(true)
        expect(result[1].commentIds).toContain('comment-cjk-1')
        expect(result[2].text).toBe('，而是一個透明度系統')
      })

      it('anchors comment inside a table cell matching bilingual text with &nbsp;', () => {
        const block: Block = {
          id: 'table-1',
          type: 'table',
          tableRows: [
            {
              cells: [
                { children: [{ text: '需求欄位' }] },
                {
                  children: [
                    {
                      text: '要的不是ticketing\u00A0系統，而是一個透明度的統一Trace log系統'
                    }
                  ]
                }
              ]
            }
          ]
        }

        const updated = anchorCommentToBlock(
          block,
          '要的不是ticketing 系統，而是一個透明度的統一Trace log系統',
          'c-table-root-cause'
        )

        const targetCellRuns = updated.tableRows![0].cells[1].children!
        expect(targetCellRuns).toHaveLength(1)
        expect(targetCellRuns[0].commentIds).toContain('c-table-root-cause')
        expect(targetCellRuns[0].text).toBe(
          '要的不是ticketing\u00A0系統，而是一個透明度的統一Trace log系統'
        )
      })
    })
  })
})
