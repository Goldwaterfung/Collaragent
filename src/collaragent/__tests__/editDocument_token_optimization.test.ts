import { describe, it, expect, vi, beforeEach } from 'vitest'
import { editDocument } from '../tools/WorkspaceTools.js'
import type { Block } from '@workspace/persistence/editorContent'

vi.mock('@workspace/wstools/listDocumentInstances', () => ({
  listDocumentInstances: vi.fn()
}))

vi.mock('@workspace/wstools/getDocument', () => ({
  getDocumentPayload: vi.fn()
}))

vi.mock('@workspace/wstools/manageDocument', () => ({
  executeWriteDocument: vi.fn(),
  executeDocumentCommands: vi.fn()
}))

import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeDocumentCommands } from '@workspace/wstools/manageDocument'

describe('editDocument token optimization & precision', () => {
  const mockBlocks: Block[] = [
    {
      id: 'hdr-1',
      type: 'h1',
      children: [{ text: 'Document Title' }]
    },
    {
      id: 'para-1',
      type: 'paragraph',
      children: [{ text: 'The initial accuracy was 75% on benchmark.' }]
    },
    {
      id: 'hdr-2',
      type: 'h2',
      children: [{ text: 'Results Section' }]
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-uuid-1',
          name: 'Metrics-Doc',
          type: 'document'
        }
      ],
      projects: []
    })

    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: mockBlocks
      },
      instanceId: 'doc-uuid-1',
      clientId: 'test-client'
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      status: 'success'
    })
  })

  it('successfully applies replace_text and emits editor:update_block', async () => {
    const result = await editDocument.invoke({
      instanceName: 'Metrics-Doc',
      operations: [
        {
          action: 'replace_text',
          blockId: 'para-1',
          target: '75%',
          replacement: '92%'
        }
      ]
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.action).toBe('Applied Patch')
      expect(result.blocksUpdated).toBe(1)
      expect(result.diff_view).toContain(
        '-<p data-block-id="para-1">The initial accuracy was 75% on benchmark.</p>'
      )
      expect(result.diff_view).toContain(
        '+<p data-block-id="para-1">The initial accuracy was 92% on benchmark.</p>'
      )
    }

    expect(executeDocumentCommands).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(executeDocumentCommands).mock.calls[0][0]
    expect(callArgs.commands[0].type).toBe('editor:update_block')
    expect(callArgs.commands[0].blockId).toBe('para-1')
  })

  it('returns valid_outline and avoids full document dump when target text is not found in block', async () => {
    const result = await editDocument.invoke({
      instanceName: 'Metrics-Doc',
      operations: [
        {
          action: 'replace_text',
          blockId: 'para-1',
          target: 'Non-existent number 999%',
          replacement: '100%'
        }
      ]
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe('PATCH_CONTEXT_MISMATCH')
      expect(result.failedBlockId).toBe('para-1')
      expect(result.message).toContain('Target text "Non-existent number 999%" was not found')
      // Must NOT dump raw HTML blocks
      expect(result.current_editable_blocks).toBeUndefined()
      // Must provide compact valid_outline
      expect(result.valid_outline).toBeDefined()
      expect(result.valid_outline).toHaveLength(3)
      expect(result.valid_outline?.[0]).toEqual({
        id: 'hdr-1',
        type: 'h1',
        headingText: 'Document Title',
        preview: 'Document Title'
      })
    }
  })

  it('rejects input at schema boundary when required fields for update are missing', async () => {
    await expect(
      editDocument.invoke({
        instanceName: 'Metrics-Doc',
        operations: [
          {
            action: 'update',
            blockId: 'para-1'
            // missing newHtml
          }
        ]
      })
    ).rejects.toThrow('Missing required fields')
  })

  it('returns INVALID_PATCH error without valid_outline or current_editable_blocks when content produces no valid blocks', async () => {
    const result = await editDocument.invoke({
      instanceName: 'Metrics-Doc',
      operations: [
        {
          action: 'update',
          blockId: 'para-1',
          newHtml: '    '
        }
      ]
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe('INVALID_PATCH')
      expect(result.current_editable_blocks).toBeUndefined()
      expect(result.valid_outline).toBeUndefined()
    }
  })
})
