// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RelationalLedgerProvider, useRelationalLedger } from '../RelationalLedgerContext'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import type { RelationalLedgerEntry } from '@shared/wiki'

function TestConsumer({
  onReady
}: {
  onReady: (val: ReturnType<typeof useRelationalLedger>) => void
}) {
  const ledger = useRelationalLedger()
  onReady(ledger)
  return <div>Edges count: {ledger.ledgerStore.getAllEdges().length}</div>
}

describe('RelationalLedgerContext', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

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

  it('hydrates edges from API when session is active', async () => {
    const edge: RelationalLedgerEntry = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      sourceEntityId: 'doc-source',
      targetEntityId: 'doc-target',
      rel: 'derived_from',
      provenance: 'document_claim',
      anchor: { blockId: 'b1', justification: 'test' },
      status: 'active',
      meta: {
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        author: 'user'
      }
    }

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/instances/ledger-default')) {
        return Promise.resolve(
          new Response(JSON.stringify({ payload: { edges: [edge] } }), { status: 200 })
        )
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }))
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock

    const contextHolder: { value: ReturnType<typeof useRelationalLedger> | null } = {
      value: null
    }

    try {
      await act(async () => {
        root?.render(
          <RelationalLedgerProvider apiPort={5000} hasSession={true}>
            <TestConsumer
              onReady={(val) => {
                contextHolder.value = val
              }}
            />
          </RelationalLedgerProvider>
        )
      })

      expect(contextHolder.value).toBeDefined()
      if (!contextHolder.value) throw new Error('contextHolder.value must be defined')
      expect(contextHolder.value.ledgerStore.getAllEdges()).toHaveLength(1)
      expect(contextHolder.value.ledgerStore.getEdge(edge.id)).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears store when session becomes inactive', async () => {
    const store = new RelationalLedgerStore()
    store.upsertEdge({
      id: '550e8400-e29b-41d4-a716-446655440098',
      sourceEntityId: 'doc-1',
      targetEntityId: 'doc-2',
      rel: 'details',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        author: 'user'
      }
    })

    expect(store.getAllEdges()).toHaveLength(1)

    await act(async () => {
      root?.render(
        <RelationalLedgerProvider ledgerStore={store} apiPort={null} hasSession={false}>
          <div>Inactive Session</div>
        </RelationalLedgerProvider>
      )
    })

    // Store should be cleared when session is inactive
    expect(store.getAllEdges()).toHaveLength(0)
  })

  it('dismissEdge removes edge from store and sends PATCH', async () => {
    const store = new RelationalLedgerStore()
    const edge: RelationalLedgerEntry = {
      id: '550e8400-e29b-41d4-a716-446655440097',
      sourceEntityId: 'doc-x',
      targetEntityId: 'doc-y',
      rel: 'contradicts',
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        author: 'user'
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

    const contextHolder: { value: ReturnType<typeof useRelationalLedger> | null } = {
      value: null
    }

    try {
      await act(async () => {
        root?.render(
          <RelationalLedgerProvider ledgerStore={store} apiPort={5000} hasSession={true}>
            <TestConsumer
              onReady={(val) => {
                contextHolder.value = val
              }}
            />
          </RelationalLedgerProvider>
        )
      })

      expect(store.getAllEdges()).toHaveLength(1)
      expect(contextHolder.value).toBeDefined()
      if (!contextHolder.value) throw new Error('contextHolder.value must be defined')
      const ctx = contextHolder.value

      await act(async () => {
        await ctx.dismissEdge(edge.id)
      })

      expect(store.getAllEdges()).toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/instances/ledger-default'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ payload: { edges: [] } })
        })
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
