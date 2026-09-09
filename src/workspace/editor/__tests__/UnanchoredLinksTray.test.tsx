// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ParagraphNode, TextNode } from 'lexical'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { RelationalLedgerProvider } from '@workspace/contexts/ledger/RelationalLedgerContext'
import { InlineClaimBadgeNode } from '../nodes/InlineClaimBadgeNode'
import UnanchoredLinksTray from '../components/UnanchoredLinksTray'

describe('UnanchoredLinksTray', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  const initialConfig = {
    namespace: 'test-tray',
    onError: (e: Error) => {
      throw e
    },
    nodes: [ParagraphNode, TextNode, InlineClaimBadgeNode]
  }

  beforeEach(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      writable: true
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    if (container) {
      container.remove()
      container = null
    }
  })

  it('renders nothing when there are no unanchored edges', async () => {
    const store = new RelationalLedgerStore()

    await act(async () => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <UnanchoredLinksTray instanceId="doc-1" ledgerStore={store} />
        </LexicalComposer>
      )
    })

    expect(container?.textContent).toBe('')
  })

  it('renders unanchored edges and supports click-to-anchor and dismiss', async () => {
    const store = new RelationalLedgerStore()
    store.upsertEdge({
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      sourceEntityId: 'doc-1',
      targetEntityId: 'transformer-concept',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user'
      }
    })
    store.upsertEdge({
      id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      sourceEntityId: 'doc-1',
      targetEntityId: 'legacy-rnn',
      rel: 'supersedes',
      provenance: 'canvas_relational',
      status: 'anchor_lost',
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user'
      }
    })

    await act(async () => {
      root?.render(
        <LexicalComposer initialConfig={initialConfig}>
          <UnanchoredLinksTray instanceId="doc-1" ledgerStore={store} />
        </LexicalComposer>
      )
    })

    // Verify unanchored links tray is rendered
    expect(container?.textContent).toContain('Unanchored Links (2):')
    expect(container?.textContent).toContain('transformer-concept')
    expect(container?.textContent).toContain('legacy-rnn')
    expect(container?.textContent).toContain('⚠️')

    // Find and click dismiss button for legacy-rnn
    const dismissButtons = container?.querySelectorAll<HTMLButtonElement>(
      'button[title="Dismiss relationship"]'
    )
    expect(dismissButtons).toBeDefined()
    expect(dismissButtons?.length).toBe(2)

    await act(async () => {
      dismissButtons?.[1]?.click()
    })

    expect(store.getAllEdges()).toHaveLength(1)
    expect(container?.textContent).not.toContain('legacy-rnn')
    expect(container?.textContent).toContain('Unanchored Links (1):')

    // Test click-to-anchor ➕
    const anchorButton = container?.querySelector<HTMLButtonElement>(
      'button[title="Anchor into current document position"]'
    )
    expect(anchorButton).toBeDefined()
    await act(async () => {
      anchorButton?.click()
    })
  })

  it('persists edge dismissal to REST API when mounted within RelationalLedgerProvider', async () => {
    const store = new RelationalLedgerStore()
    const edge = {
      id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      sourceEntityId: 'doc-1',
      targetEntityId: 'transformer-concept',
      rel: 'details' as const,
      provenance: 'canvas_relational' as const,
      status: 'active' as const,
      meta: {
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
        author: 'user' as const
      }
    }
    store.upsertEdge(edge)

    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ payload: { edges: [edge] } }), { status: 200 })
      )
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock

    try {
      await act(async () => {
        root?.render(
          <RelationalLedgerProvider ledgerStore={store} apiPort={4567} hasSession={true}>
            <LexicalComposer initialConfig={initialConfig}>
              <UnanchoredLinksTray instanceId="doc-1" />
            </LexicalComposer>
          </RelationalLedgerProvider>
        )
      })

      expect(container?.textContent).toContain('transformer-concept')

      const dismissButton = container?.querySelector<HTMLButtonElement>(
        'button[title="Dismiss relationship"]'
      )
      expect(dismissButton).toBeDefined()

      await act(async () => {
        dismissButton?.click()
      })

      expect(store.getAllEdges()).toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/instances/ledger-default'),
        expect.objectContaining({ method: 'PATCH' })
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
