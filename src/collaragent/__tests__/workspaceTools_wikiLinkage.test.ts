import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDocument, editDocument, readDocument } from '../tools/WorkspaceTools.js'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'

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

vi.mock('@workspace/wstools/createDocumentInstance', () => ({
  createInstance: vi.fn()
}))

import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeWriteDocument, executeDocumentCommands } from '@workspace/wstools/manageDocument'
import { createInstance } from '@workspace/wstools/createDocumentInstance'

describe('WorkspaceTools Wiki Linkage Integration', () => {
  let ledgerStore: RelationalLedgerStore

  beforeEach(() => {
    vi.clearAllMocks()
    ledgerStore = new RelationalLedgerStore()
  })

  it('creates document with wikilinks and automatically registers active edges in RelationalLedgerStore', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-spec',
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

    vi.mocked(createInstance).mockResolvedValue('doc-new-1')

    vi.mocked(executeWriteDocument).mockResolvedValue({
      status: 'success'
    })

    const result = await createDocument.invoke(
      {
        instanceName: 'Agent-Evaluation',
        projectName: 'Alpha',
        html_content:
          '<h2>Agent Evaluation</h2><p id="claim-p1">The architecture [[supports:System-Spec|Verified with multi-agent coordination]] guarantees isolation.</p>'
      },
      {
        configurable: {
          ledgerStore
        }
      }
    )

    expect(result.status).toBe('success')
    expect(executeWriteDocument).toHaveBeenCalledTimes(1)

    // Check payload passed to write document
    const callArgs = vi.mocked(executeWriteDocument).mock.calls[0][0]
    expect(callArgs.instanceId).toBe('doc-new-1')
    expect(callArgs.payload.blocks).toHaveLength(2)
    const pBlock = callArgs.payload.blocks[1]
    expect(pBlock.children).toBeDefined()
    const badgeRun = pBlock.children?.find((r) => r.claimBadge)
    expect(badgeRun?.claimBadge?.rel).toBe('supports')
    expect(badgeRun?.claimBadge?.targetEntityId).toBe('System-Spec')
    expect(badgeRun?.claimBadge?.justification).toBe('Verified with multi-agent coordination')

    // Verify ledger store synchronized
    const edges = ledgerStore.getAllEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceEntityId).toBe('Agent-Evaluation')
    expect(edges[0].targetEntityId).toBe('System-Spec')
    expect(edges[0].rel).toBe('supports')
    expect(edges[0].provenance).toBe('document_claim')
    expect(edges[0].status).toBe('active')
    expect(edges[0].anchor?.justification).toBe('Verified with multi-agent coordination')
  })

  it('reads document and surfaces wikilink syntax in editable_blocks for LLM discovery', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-1',
          name: 'Architecture-Doc',
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
        blocks: [
          {
            id: 'b1',
            type: 'paragraph',
            children: [
              { text: 'Initial findings ' },
              {
                text: '',
                claimBadge: {
                  badgeId: 'badge-1',
                  targetEntityId: 'TargetDoc',
                  rel: 'details',
                  justification: 'Deep dive into storage subsystem'
                }
              },
              { text: ' conclude our analysis.' }
            ]
          }
        ]
      }
    })

    const result = await readDocument.invoke(
      {
        instanceId: 'doc-1'
      },
      {}
    )

    expect(result.status).toBe('success')
    const editable = (result as { editable_blocks?: Array<{ id: string; html: string }> })
      .editable_blocks
    expect(editable).toBeDefined()
    expect(editable?.[0].html).toContain('[[details:TargetDoc|Deep dive into storage subsystem]]')
  })

  it('updates document and extracts claim badge, promoting edge to active in ledger', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'doc-1',
          name: 'Architecture-Doc',
          type: 'document',
          projectId: 'p1'
        },
        {
          instanceId: 'doc-legacy',
          name: 'Legacy-Architecture',
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
        blocks: [
          {
            id: 'b1',
            type: 'paragraph',
            children: [{ text: 'Old baseline paragraph.' }]
          }
        ]
      }
    })

    vi.mocked(executeDocumentCommands).mockResolvedValue({
      status: 'success'
    })

    const result = await editDocument.invoke(
      {
        instanceId: 'doc-1',
        operations: [
          {
            action: 'update',
            blockId: 'b1',
            newHtml:
              '<p>Updated sentence [[contradicts:Legacy-Architecture|Direct conflict with single-thread model]].</p>'
          }
        ],
        explanation: 'Add contradiction claim badge'
      },
      {
        configurable: {
          ledgerStore
        }
      }
    )

    expect(result.status).toBe('success')
    expect(executeDocumentCommands).toHaveBeenCalledTimes(1)

    // Verify ledger store synchronized with the new contradiction edge
    const edges = ledgerStore.getAllEdges()
    expect(edges).toHaveLength(1)
    expect(edges[0].sourceEntityId).toBe('Architecture-Doc')
    expect(edges[0].targetEntityId).toBe('Legacy-Architecture')
    expect(edges[0].rel).toBe('contradicts')
    expect(edges[0].provenance).toBe('document_claim')
    expect(edges[0].status).toBe('active')
  })

  it('rejects createDocument when wikilink target does not exist in workspace (Flaw #2)', async () => {
    vi.mocked(listDocumentInstances).mockResolvedValue({
      instances: [
        {
          instanceId: 'canvas-1',
          name: 'test-graph',
          type: 'canvas',
          projectId: 'p1'
        }
      ],
      projects: [
        { id: 'p1', name: 'Alpha', metadata: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
      ],
      clientId: 'c1'
    })

    const result = await createDocument.invoke(
      {
        instanceName: 'Doc-With-Bad-Link',
        projectName: 'Alpha',
        html_content: '<p>Linking to a canvas [[relates_to:test-graph|Invalid target]]</p>'
      },
      {
        configurable: {
          ledgerStore
        }
      }
    )

    expect(result.status).toBe('error')
    expect((result as { code?: string }).code).toBe('WORKSPACE_WIKI_UNRESOLVED_SYMBOL')
    // Ensure document was NOT written and ledger was NOT updated
    expect(executeWriteDocument).not.toHaveBeenCalled()
    expect(ledgerStore.getAllEdges()).toHaveLength(0)
  })
})
