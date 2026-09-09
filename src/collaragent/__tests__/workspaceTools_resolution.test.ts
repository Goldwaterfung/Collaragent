import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readDocument, readGraph, listWorkspaceItems } from '../tools/WorkspaceTools.js'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

vi.mock('@workspace/wstools/listDocumentInstances', () => ({
  listDocumentInstances: vi.fn()
}))

vi.mock('@workspace/wstools/getDocument', () => ({
  getDocumentPayload: vi.fn()
}))

vi.mock('@workspace/wstools/manageGraph', () => ({
  executeReadGraph: vi.fn()
}))

import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeReadGraph } from '@workspace/wstools/manageGraph'

describe('WorkspaceTools resolution & dual identifier tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads document directly using instanceId without needing instanceName', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-uuid-1',
          name: 'System-Spec',
          type: 'document',
          projectId: 'p1'
        }
      ],
      projects: [
        { id: 'p1', name: 'Alpha', metadata: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
      ],
      clientId: 'c1'
    })

    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [{ id: 'b1', type: 'paragraph', children: [{ text: 'Direct ID content' }] }]
      },
      instanceId: 'doc-uuid-1',
      clientId: 'c1'
    })

    const result = await readDocument.invoke({ instanceId: 'doc-uuid-1' })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.instanceId).toBe('doc-uuid-1')
      expect(result.instanceName).toBe('System-Spec')
      expect(result.editable_blocks).toHaveLength(1)
      expect(result.editable_blocks[0].html).toBe('<p>Direct ID content</p>')
    }
  })

  it('resolves by instanceName scoped to type: canvas and document sharing same name do not collide', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'canvas-uuid-1',
          name: 'Architecture',
          type: 'canvas',
          projectId: 'p1'
        },
        {
          instanceId: 'doc-uuid-2',
          name: 'Architecture',
          type: 'document',
          projectId: 'p1'
        }
      ],
      projects: [
        { id: 'p1', name: 'Alpha', metadata: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
      ],
      clientId: 'c1'
    })

    vi.mocked(getDocumentPayload).mockResolvedValue({
      payload: {
        blocks: [{ id: 'b1', type: 'paragraph', children: [{ text: 'Doc content' }] }]
      },
      instanceId: 'doc-uuid-2',
      clientId: 'c1'
    })

    vi.mocked(executeReadGraph).mockResolvedValue({
      instanceId: 'canvas-uuid-1',
      groups: [],
      nodes: [{ id: 'n1', entity: 'Node 1' }],
      edges: []
    })

    // readDocument should pick the document instance
    const docResult = await readDocument.invoke({
      instanceName: 'Architecture',
      projectName: 'Alpha'
    })
    expect(docResult.status).toBe('success')
    if (docResult.status === 'success') {
      expect(docResult.instanceId).toBe('doc-uuid-2')
    }

    // readGraph should pick the canvas instance
    const graphResult = await readGraph.invoke({
      instanceName: 'Architecture',
      projectName: 'Alpha'
    })
    expect(graphResult.status).toBe('success')
    if (graphResult.status === 'success') {
      expect(graphResult.instanceId).toBe('canvas-uuid-1')
    }
  })

  it('returns candidate IDs when multiple instances of the same type share the same name', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-111',
          name: 'Notes',
          type: 'document',
          projectId: 'p1'
        },
        {
          instanceId: 'doc-222',
          name: 'Notes',
          type: 'document',
          projectId: 'p1'
        }
      ],
      projects: [
        {
          id: 'p1',
          name: 'MainProject',
          metadata: {},
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      clientId: 'c1'
    })

    const result = await readDocument.invoke({ instanceName: 'Notes', projectName: 'MainProject' })
    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe(WorkspaceErrorCode.WORKSPACE_MULTIPLE_INSTANCES)
      expect(result.message).toContain('doc-111')
      expect(result.message).toContain('doc-222')
      expect(result.message).toContain('instanceId')
    }
  })

  it('listWorkspaceItems returns instanceId for every item', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-uuid-abc',
          name: 'Literature',
          type: 'document',
          projectId: 'p1'
        },
        {
          instanceId: 'canvas-uuid-def',
          name: 'ConceptMap',
          type: 'canvas',
          projectId: 'p1'
        }
      ],
      projects: [
        {
          id: 'p1',
          name: 'Research',
          metadata: {},
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        }
      ],
      clientId: 'c1'
    })

    const result = await listWorkspaceItems.invoke({})
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.items).toEqual([
        {
          instanceId: 'doc-uuid-abc',
          name: 'Literature',
          project: 'Research',
          type: 'document'
        },
        {
          instanceId: 'canvas-uuid-def',
          name: 'ConceptMap',
          project: 'Research',
          type: 'canvas'
        }
      ])
    }
  })

  it('rejects calls when neither instanceId nor instanceName is provided', async () => {
    await expect(readDocument.invoke({})).rejects.toThrow(
      'Either instanceId or instanceName must be provided'
    )
  })
})
