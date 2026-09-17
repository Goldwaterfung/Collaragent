import { describe, it, expect, vi, beforeEach } from 'vitest'
import { leaveComment } from '../WorkspaceTools'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { EditorCommand } from '@shared/commands'

vi.mock('@workspace/wstools/listDocumentInstances', () => ({
  listDocumentInstances: vi.fn()
}))

vi.mock('@workspace/wstools/getDocument', () => ({
  getDocumentPayload: vi.fn()
}))

vi.mock('@workspace/wstools/manageDocument', () => ({
  executeDocumentCommands: vi.fn(),
  executeWriteDocument: vi.fn()
}))

import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeDocumentCommands } from '@workspace/wstools/manageDocument'

describe('leaveComment tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-uuid-1',
          name: 'ResearchDraft',
          type: 'document',
          projectId: 'p1'
        }
      ],
      projects: [
        { id: 'p1', name: 'Alpha', metadata: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
      ],
      clientId: 'c1'
    })
  })

  it('successfully leaves a comment and emits atomic editor commands', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'The sample size of 12 patients was sufficient.' }]
          }
        ],
        comments: {}
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      instanceId: 'doc-uuid-1',
      status: 'success',
      commandsEmitted: 2
    })

    const result = await leaveComment.invoke({
      instanceName: 'ResearchDraft',
      blockId: 'b-1',
      targetText: 'sample size of 12 patients',
      comment: 'This cohort size may limit generalizability.',
      author: 'Methodology Reviewer'
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.action).toBe('Comment Added')
      expect(result.instanceId).toBe('doc-uuid-1')
      expect(result.blockId).toBe('b-1')
      expect(result.targetText).toBe('sample size of 12 patients')
      expect(result.author).toBe('Methodology Reviewer')
      expect(result.comment).toBe('This cohort size may limit generalizability.')
      expect(result.commentId).toBeDefined()
    }

    expect(executeDocumentCommands).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(executeDocumentCommands).mock.calls[0][0]
    expect(callArgs.instanceId).toBe('doc-uuid-1')
    expect(callArgs.commands).toHaveLength(2)

    const updateBlockCmd = callArgs.commands[0] as EditorCommand & {
      type: 'editor:update_block'
      blockId: string
      changes: { children: Array<{ text: string; commentIds?: string[] }> }
    }
    expect(updateBlockCmd.type).toBe('editor:update_block')
    expect(updateBlockCmd.blockId).toBe('b-1')
    expect(updateBlockCmd.changes.children).toHaveLength(3)
    expect(updateBlockCmd.changes.children[0].text).toBe('The ')
    expect(updateBlockCmd.changes.children[1].text).toBe('sample size of 12 patients')
    expect(updateBlockCmd.changes.children[1].commentIds).toBeDefined()
    expect(updateBlockCmd.changes.children[2].text).toBe(' was sufficient.')

    const updateCommentsCmd = callArgs.commands[1] as EditorCommand & {
      type: 'editor:update_comments'
      comments: Record<string, { id: string; author: string; content: string }>
    }
    expect(updateCommentsCmd.type).toBe('editor:update_comments')
    const addedComment = Object.values(updateCommentsCmd.comments)[0]
    expect(addedComment.author).toBe('Methodology Reviewer')
    expect(addedComment.content).toBe('This cohort size may limit generalizability.')
  })

  it('uses default author "AI Reviewer" when author is omitted', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'Some text to annotate.' }]
          }
        ]
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      instanceId: 'doc-uuid-1',
      status: 'success',
      commandsEmitted: 2
    })

    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'b-1',
      targetText: 'text to annotate',
      comment: 'Review feedback.'
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.author).toBe('AI Reviewer')
    }
  })

  it('preserves existing comments when adding a new comment', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'Annotated sentence.', commentIds: ['existing-c1'] }]
          }
        ],
        comments: {
          'existing-c1': { id: 'existing-c1', author: 'Human Author', content: 'Existing note' }
        }
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      instanceId: 'doc-uuid-1',
      status: 'success',
      commandsEmitted: 2
    })

    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'b-1',
      targetText: 'sentence',
      comment: 'Second note on sentence.'
    })

    expect(result.status).toBe('success')
    const callArgs = vi.mocked(executeDocumentCommands).mock.calls[0][0]
    const updateCommentsCmd = callArgs.commands[1] as {
      type: 'editor:update_comments'
      comments: Record<string, unknown>
    }
    expect(Object.keys(updateCommentsCmd.comments)).toHaveLength(2)
    expect(updateCommentsCmd.comments['existing-c1']).toBeDefined()
  })

  it('returns error when target blockId does not exist', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'Paragraph one.' }]
          }
        ]
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'non-existent-block',
      targetText: 'Paragraph',
      comment: 'Feedback.'
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe(WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING)
    }
  })

  it('returns error when targetText is not in the block', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'Paragraph one.' }]
          }
        ]
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'b-1',
      targetText: 'This text is not there',
      comment: 'Feedback.'
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe(WorkspaceErrorCode.WORKSPACE_COMMENT_TARGET_NOT_FOUND)
      expect(result.recommendFix).toBeDefined()
    }
  })

  it('returns error when comment content is whitespace only', async () => {
    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'b-1',
      targetText: 'Paragraph',
      comment: '   '
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe(WorkspaceErrorCode.WORKSPACE_COMMENT_EMPTY)
      expect(result.recommendFix).toBeDefined()
    }
  })

  it('supports batched comment submission in a single tool call', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'The sample size of 12 patients was sufficient.' }]
          },
          {
            id: 'b-2',
            type: 'paragraph',
            children: [{ text: 'The p-value was 0.04.' }]
          }
        ],
        comments: {}
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      instanceId: 'doc-uuid-1',
      status: 'success',
      commandsEmitted: 3
    })

    const result = await leaveComment.invoke({
      instanceName: 'ResearchDraft',
      comments: [
        {
          blockId: 'b-1',
          targetText: 'sample size of 12 patients',
          comment: 'Sample size limits generalizability.',
          author: 'Reviewer A'
        },
        {
          blockId: 'b-2',
          targetText: 'p-value was 0.04',
          comment: 'Report exact confidence intervals.',
          author: 'Reviewer B'
        }
      ]
    })

    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.commentsAdded).toBe(2)
      expect(result.comments).toHaveLength(2)
      expect(result.comments?.[0].author).toBe('Reviewer A')
      expect(result.comments?.[1].author).toBe('Reviewer B')
    }

    expect(executeDocumentCommands).toHaveBeenCalledTimes(1)
    const callArgs = vi.mocked(executeDocumentCommands).mock.calls[0][0]
    expect(callArgs.commands).toHaveLength(3) // 2 update_block + 1 update_comments
    expect(callArgs.commands[0].type).toBe('editor:update_block')
    expect(callArgs.commands[1].type).toBe('editor:update_block')
    expect(callArgs.commands[2].type).toBe('editor:update_comments')

    const updateCommentsCmd = callArgs.commands[2] as {
      type: 'editor:update_comments'
      comments: Record<string, { id: string; author: string; content: string }>
    }
    expect(Object.keys(updateCommentsCmd.comments)).toHaveLength(2)
  })

  it('serializes concurrent parallel tool calls on the same document via withDocumentInstanceLock', async () => {
    let activeInFlight = 0
    let maxConcurrent = 0

    vi.mocked(getDocumentPayload).mockImplementation(async () => {
      activeInFlight++
      maxConcurrent = Math.max(maxConcurrent, activeInFlight)
      // Small simulated latency
      await new Promise((resolve) => setTimeout(resolve, 20))
      activeInFlight--
      return {
        payload: {
          blocks: [
            {
              id: 'b-1',
              type: 'paragraph',
              children: [{ text: 'First paragraph text.' }]
            },
            {
              id: 'b-2',
              type: 'paragraph',
              children: [{ text: 'Second paragraph text.' }]
            }
          ],
          comments: {}
        },
        instanceId: 'doc-uuid-1',
        clientId: 'c1'
      }
    })

    vi.mocked(executeDocumentCommands).mockImplementation(async () => {
      activeInFlight++
      maxConcurrent = Math.max(maxConcurrent, activeInFlight)
      await new Promise((resolve) => setTimeout(resolve, 20))
      activeInFlight--
      return {
        instanceId: 'doc-uuid-1',
        status: 'success',
        commandsEmitted: 2
      }
    })

    // Fire 2 calls concurrently as LangGraph would with Promise.all
    const [res1, res2] = await Promise.all([
      leaveComment.invoke({
        instanceId: 'doc-uuid-1',
        blockId: 'b-1',
        targetText: 'First paragraph',
        comment: 'Comment 1'
      }),
      leaveComment.invoke({
        instanceId: 'doc-uuid-1',
        blockId: 'b-2',
        targetText: 'Second paragraph',
        comment: 'Comment 2'
      })
    ])

    expect(res1.status).toBe('success')
    expect(res2.status).toBe('success')
    // Crucial check: withDocumentInstanceLock guarantees maxConcurrent never exceeded 1
    expect(maxConcurrent).toBe(1)
  })

  it('automatically retries and recovers when encountering WORKSPACE_STALE_BASE_VERSION', async () => {
    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [
          {
            id: 'b-1',
            type: 'paragraph',
            children: [{ text: 'Concurrency test paragraph.' }]
          }
        ],
        comments: {}
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    let callCount = 0
    vi.mocked(executeDocumentCommands).mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        throw new Error(
          '[WORKSPACE_STALE_BASE_VERSION] Command based on stale version 1; server is at 2'
        )
      }
      return {
        instanceId: 'doc-uuid-1',
        status: 'success',
        commandsEmitted: 2
      }
    })

    const result = await leaveComment.invoke({
      instanceId: 'doc-uuid-1',
      blockId: 'b-1',
      targetText: 'Concurrency test',
      comment: 'Comment recovered after OCC retry'
    })

    expect(result.status).toBe('success')
    expect(callCount).toBe(2)
    expect(executeDocumentCommands).toHaveBeenCalledTimes(2)
  })
})
