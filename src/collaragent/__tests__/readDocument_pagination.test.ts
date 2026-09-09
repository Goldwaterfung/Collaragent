import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readDocument } from '../tools/WorkspaceTools.js'
import { createFilesystemMiddleware } from '../middleware/filesystem.js'
import { ToolMessage } from '@langchain/core/messages'
import type { Block, Comment } from '@workspace/persistence/editorContent'

vi.mock('@workspace/wstools/listDocumentInstances', () => ({
  listDocumentInstances: vi.fn()
}))

vi.mock('@workspace/wstools/getDocument', () => ({
  getDocumentPayload: vi.fn()
}))

import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { getDocumentPayload } from '@workspace/wstools/getDocument'

describe('readDocument block-level pagination', () => {
  const totalTestBlocks = 120
  const mockBlocks: Block[] = Array.from({ length: totalTestBlocks }, (_, i) => ({
    id: `blk-${i}`,
    type: 'paragraph' as const,
    children: [
      {
        text: `Paragraph content for block ${i}`,
        ...(i === 5 ? { commentIds: ['c1'] } : {}),
        ...(i === 70 ? { commentIds: ['c2'] } : {})
      }
    ]
  }))

  const mockComments: Record<string, Comment> = {
    c1: { id: 'c1', author: 'Alice', content: 'Comment on block 5' },
    c2: { id: 'c2', author: 'Bob', content: 'Comment on block 70' }
  }

  beforeEach(() => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'inst-uuid-1',
          name: 'Architecture-Doc',
          type: 'document'
        }
      ],
      projects: []
    })

    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: mockBlocks,
        comments: mockComments
      },
      instanceId: 'inst-uuid-1',
      clientId: 'test-client'
    })
  })

  it('reads the first chunk by default (offset 0, limit 50) and indicates hasMore with nextOffset', async () => {
    const result = await readDocument.invoke({ instanceName: 'Architecture-Doc' })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.totalBlocks).toBe(120)
      expect(result.offset).toBe(0)
      expect(result.limit).toBe(50)
      expect(result.hasMore).toBe(true)
      expect(result.nextOffset).toBe(50)
      expect(result.editable_blocks).toHaveLength(50)
      expect(result.editable_blocks[0].id).toBe('blk-0')
      expect(result.editable_blocks[49].id).toBe('blk-49')

      // Verifies comment pruning: c1 (block 5) is visible, c2 (block 70) is pruned
      expect(result.comments).toBeDefined()
      expect(result.comments?.c1).toBeDefined()
      expect(result.comments?.c2).toBeUndefined()
    }
  })

  it('reads subsequent chunk using offset: 50, limit: 50', async () => {
    const result = await readDocument.invoke({
      instanceName: 'Architecture-Doc',
      offset: 50,
      limit: 50
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.totalBlocks).toBe(120)
      expect(result.offset).toBe(50)
      expect(result.limit).toBe(50)
      expect(result.hasMore).toBe(true)
      expect(result.nextOffset).toBe(100)
      expect(result.editable_blocks).toHaveLength(50)
      expect(result.editable_blocks[0].id).toBe('blk-50')
      expect(result.editable_blocks[49].id).toBe('blk-99')

      // Block 70 is in this slice, so c2 is present and c1 is omitted
      expect(result.comments).toBeDefined()
      expect(result.comments?.c1).toBeUndefined()
      expect(result.comments?.c2).toBeDefined()
    }
  })

  it('reads the final partial chunk with hasMore: false and undefined nextOffset', async () => {
    const result = await readDocument.invoke({
      instanceName: 'Architecture-Doc',
      offset: 100,
      limit: 50
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.totalBlocks).toBe(120)
      expect(result.offset).toBe(100)
      expect(result.hasMore).toBe(false)
      expect(result.nextOffset).toBeUndefined()
      expect(result.editable_blocks).toHaveLength(20)
      expect(result.editable_blocks[0].id).toBe('blk-100')
      expect(result.editable_blocks[19].id).toBe('blk-119')
      expect(result.comments).toBeUndefined()
    }
  })

  it('returns all blocks for small documents (<= 50 blocks) with hasMore: false', async () => {
    const smallBlocks: Block[] = mockBlocks.slice(0, 10)
    vi.mocked(getDocumentPayload).mockResolvedValueOnce({
      payload: { blocks: smallBlocks },
      instanceId: 'inst-uuid-1',
      clientId: 'test-client'
    })

    const result = await readDocument.invoke({ instanceName: 'Architecture-Doc' })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.totalBlocks).toBe(10)
      expect(result.offset).toBe(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextOffset).toBeUndefined()
      expect(result.editable_blocks).toHaveLength(10)
    }
  })

  it('handles offset beyond totalBlocks gracefully', async () => {
    const result = await readDocument.invoke({
      instanceName: 'Architecture-Doc',
      offset: 200,
      limit: 50
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.totalBlocks).toBe(120)
      expect(result.offset).toBe(120)
      expect(result.hasMore).toBe(false)
      expect(result.nextOffset).toBeUndefined()
      expect(result.editable_blocks).toHaveLength(0)
    }
  })
})

describe('createFilesystemMiddleware workspace tool eviction bypass', () => {
  it('bypasses eviction for workspace tools (e.g. readDocument) even if payload exceeds 80KB', async () => {
    const middleware = createFilesystemMiddleware()
    expect(middleware.wrapToolCall).toBeDefined()

    // 100KB payload (exceeds default toolTokenLimitBeforeEvict * 4 = 80,000 chars)
    const largePayload = 'X'.repeat(100000)
    const mockToolMessage = new ToolMessage({
      content: largePayload,
      tool_call_id: 'call_readDoc_123'
    })

    const handler = vi.fn().mockResolvedValue(mockToolMessage)
    const request = {
      toolCall: {
        name: 'readDocument',
        args: { instanceName: 'LargeDoc' },
        id: 'call_readDoc_123'
      },
      runtime: {} as unknown as Parameters<
        NonNullable<typeof middleware.wrapToolCall>
      >[0]['runtime'],
      state: {} as unknown as Parameters<NonNullable<typeof middleware.wrapToolCall>>[0]['state']
    }

    const result = await middleware.wrapToolCall!(request, handler)

    // Handler must be called directly without attempting filesystem write or eviction
    expect(handler).toHaveBeenCalledWith(request)
    expect(result).toBe(mockToolMessage)
    if (ToolMessage.isInstance(result)) {
      // Content is preserved without eviction message or replacement
      expect(result.content).toBe(largePayload)
    }
  })
})
