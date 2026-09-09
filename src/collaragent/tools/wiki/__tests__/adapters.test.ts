import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveWikiWorkspaceAdapter, MemoryWikiWorkspaceAdapter } from '../adapters'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import * as listDocModule from '@workspace/wstools/listDocumentInstances'
import * as createDocModule from '@workspace/wstools/createDocumentInstance'
import * as getDocModule from '@workspace/wstools/getDocument'
import * as getGraphModule from '@workspace/wstools/getGraphPayload'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import { DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID } from '@shared/constants'

describe('LiveWikiWorkspaceAdapter', () => {
  let ledgerStore: RelationalLedgerStore
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('logs structured warning and returns empty array on listDocuments failure', async () => {
    vi.spyOn(listDocModule, 'listDocumentInstances').mockRejectedValueOnce(
      new Error('Connection refused')
    )

    const adapter = new LiveWikiWorkspaceAdapter({ apiPort: 1234 }, ledgerStore)
    const result = await adapter.listDocuments()

    expect(result).toEqual([])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[LiveWikiWorkspaceAdapter] Failed to list documents:',
      expect.objectContaining({ message: 'Connection refused' })
    )
  })

  it('logs structured warning and returns null on getDocument failure', async () => {
    vi.spyOn(listDocModule, 'listDocumentInstances').mockRejectedValueOnce(
      new Error('API port down')
    )

    const adapter = new LiveWikiWorkspaceAdapter({ apiPort: 1234 }, ledgerStore)
    const result = await adapter.getDocument('MyDoc')

    expect(result).toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[LiveWikiWorkspaceAdapter] Failed to get document "MyDoc":',
      expect.objectContaining({ message: 'API port down' })
    )
  })

  it('logs structured warning and returns empty array on listCanvases failure', async () => {
    vi.spyOn(listDocModule, 'listDocumentInstances').mockRejectedValueOnce(
      new Error('Timeout connecting to instance registry')
    )

    const adapter = new LiveWikiWorkspaceAdapter({ apiPort: 1234 }, ledgerStore)
    const result = await adapter.listCanvases()

    expect(result).toEqual([])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[LiveWikiWorkspaceAdapter] Failed to list canvases:',
      expect.objectContaining({ message: 'Timeout connecting to instance registry' })
    )
  })

  it('logs structured warning and returns null on getCanvas failure', async () => {
    vi.spyOn(listDocModule, 'listDocumentInstances').mockRejectedValueOnce(
      new Error('WebSocket unreachable')
    )

    const adapter = new LiveWikiWorkspaceAdapter({ wsPort: 5678 }, ledgerStore)
    const result = await adapter.getCanvas('ConceptGraph')

    expect(result).toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[LiveWikiWorkspaceAdapter] Failed to get canvas "ConceptGraph":',
      expect.objectContaining({ message: 'WebSocket unreachable' })
    )
  })

  it('propagates caller AbortSignal to fetch when loading ledger', async () => {
    let capturedSignal: AbortSignal | undefined
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(
        new Response(JSON.stringify({ payload: { edges: [] } }), { status: 200 })
      )
    })
    globalThis.fetch = mockFetch

    const callerController = new AbortController()
    const adapter = new LiveWikiWorkspaceAdapter(
      { apiPort: 4321, signal: callerController.signal },
      ledgerStore
    )
    await adapter.loadLedger()

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/api/instances/ledger-default',
      expect.objectContaining({ signal: callerController.signal })
    )
    expect(capturedSignal).toBe(callerController.signal)
  })

  it('generates AbortSignal timeout when caller specifies timeoutMs in context', async () => {
    vi.spyOn(listDocModule, 'listDocumentInstances').mockResolvedValueOnce({
      projects: [{ id: 'p1', name: 'Proj 1', activeGraphId: 'g1', instances: [] }],
      instances: [
        { instanceId: 'inst-canvas-1', name: 'my-canvas', type: 'canvas', projectId: 'p1' }
      ]
    })

    let capturedSignal: AbortSignal | undefined
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    globalThis.fetch = mockFetch

    const adapter = new LiveWikiWorkspaceAdapter({ apiPort: 4321, timeoutMs: 3000 }, ledgerStore)
    const canvasDto: GraphCanvasDTO = {
      schemaVersion: 1,
      type: 'graph-canvas',
      graph: { nodes: {}, relationships: {} },
      layout: { layoutByNodeId: {} },
      meta: {}
    }

    const savedId = await adapter.saveCanvas('my-canvas', canvasDto)
    expect(savedId).toBe('inst-canvas-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/api/instances/inst-canvas-1',
      expect.objectContaining({
        method: 'PATCH',
        signal: expect.any(AbortSignal)
      })
    )
    expect(capturedSignal).toBeDefined()
  })

  it('does not attach arbitrary hardcoded AbortSignal when neither signal nor timeoutMs is configured', async () => {
    let capturedSignal: AbortSignal | undefined
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(
        new Response(JSON.stringify({ payload: { edges: [] } }), { status: 200 })
      )
    })
    globalThis.fetch = mockFetch

    const adapter = new LiveWikiWorkspaceAdapter({ apiPort: 4321 }, ledgerStore)
    await adapter.loadLedger()

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/api/instances/ledger-default',
      expect.objectContaining({ signal: undefined })
    )
    expect(capturedSignal).toBeUndefined()
  })

  it('prioritizes per-call override signal over context signal', async () => {
    let capturedSignal: AbortSignal | undefined
    const mockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined
      return Promise.resolve(
        new Response(JSON.stringify({ payload: { edges: [] } }), { status: 200 })
      )
    })
    globalThis.fetch = mockFetch

    const contextController = new AbortController()
    const callController = new AbortController()
    const adapter = new LiveWikiWorkspaceAdapter(
      { apiPort: 4321, signal: contextController.signal },
      ledgerStore
    )
    await adapter.loadLedger({ signal: callController.signal })

    expect(capturedSignal).toBe(callController.signal)
  })

  describe('Read Barriers & Flush Coordination (Phase 3)', () => {
    it('calls flush with instanceId when flushBeforeRead is true in getDocument', async () => {
      vi.spyOn(listDocModule, 'listDocumentInstances').mockResolvedValueOnce({
        projects: [{ id: 'p1', name: 'Proj 1', activeGraphId: 'g1', instances: [] }],
        instances: [{ instanceId: 'doc-123', name: 'Overview', type: 'document', projectId: 'p1' }]
      })
      vi.spyOn(getDocModule, 'getDocumentPayload').mockResolvedValueOnce({
        payload: { blocks: [] },
        instanceId: 'doc-123',
        clientId: 'client-1'
      })

      const flushSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new LiveWikiWorkspaceAdapter(
        { wsPort: 1234, wsHandle: { flush: flushSpy } },
        ledgerStore
      )

      const doc = await adapter.getDocument('Overview', { flushBeforeRead: true })
      expect(doc).toEqual({ blocks: [] })
      expect(flushSpy).toHaveBeenCalledWith(
        'doc-123',
        expect.objectContaining({ signal: undefined })
      )
    })

    it('does not call flush in getDocument when flushBeforeRead is false', async () => {
      vi.spyOn(listDocModule, 'listDocumentInstances').mockResolvedValueOnce({
        projects: [{ id: 'p1', name: 'Proj 1', activeGraphId: 'g1', instances: [] }],
        instances: [{ instanceId: 'doc-123', name: 'Overview', type: 'document', projectId: 'p1' }]
      })
      vi.spyOn(getDocModule, 'getDocumentPayload').mockResolvedValueOnce({
        payload: { blocks: [] },
        instanceId: 'doc-123',
        clientId: 'client-1'
      })

      const flushSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new LiveWikiWorkspaceAdapter(
        { wsPort: 1234, wsHandle: { flush: flushSpy } },
        ledgerStore
      )

      await adapter.getDocument('Overview', { flushBeforeRead: false })
      expect(flushSpy).not.toHaveBeenCalled()
    })

    it('calls flush with instanceId when flushBeforeRead is true in getCanvas', async () => {
      vi.spyOn(listDocModule, 'listDocumentInstances').mockResolvedValueOnce({
        projects: [{ id: 'p1', name: 'Proj 1', activeGraphId: 'g1', instances: [] }],
        instances: [
          { instanceId: 'canvas-99', name: 'Architecture', type: 'canvas', projectId: 'p1' }
        ]
      })
      const fakeCanvas: GraphCanvasDTO = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: { nodes: {}, relationships: {} },
        layout: { layoutByNodeId: {} },
        meta: {}
      }
      vi.spyOn(getGraphModule, 'getGraphPayload').mockResolvedValueOnce({
        payload: fakeCanvas,
        instanceId: 'canvas-99',
        clientId: 'client-1'
      })

      const flushSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new LiveWikiWorkspaceAdapter(
        { wsPort: 1234, wsHandle: { flush: flushSpy } },
        ledgerStore
      )

      const canvas = await adapter.getCanvas('Architecture', { flushBeforeRead: true })
      expect(canvas).toEqual(fakeCanvas)
      expect(flushSpy).toHaveBeenCalledWith(
        'canvas-99',
        expect.objectContaining({ signal: undefined })
      )
    })

    it('calls flush with DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID when flushBeforeRead is true in loadLedger', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ payload: { edges: [] } }), { status: 200 })
        )
      globalThis.fetch = mockFetch

      const flushSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new LiveWikiWorkspaceAdapter(
        { apiPort: 4321, wsHandle: { flush: flushSpy } },
        ledgerStore
      )

      await adapter.loadLedger({ flushBeforeRead: true })
      expect(flushSpy).toHaveBeenCalledWith(
        DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
        expect.objectContaining({ signal: undefined })
      )
      expect(mockFetch).toHaveBeenCalled()
    })

    it('inherits flushBeforeRead from context if not specified in options', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ payload: { edges: [] } }), { status: 200 })
        )
      globalThis.fetch = mockFetch

      const flushSpy = vi.fn().mockResolvedValue(undefined)
      const adapter = new LiveWikiWorkspaceAdapter(
        { apiPort: 4321, wsHandle: { flush: flushSpy }, flushBeforeRead: true },
        ledgerStore
      )

      await adapter.loadLedger()
      expect(flushSpy).toHaveBeenCalledWith(
        DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
        expect.objectContaining({ signal: undefined })
      )
    })

    it('MemoryWikiWorkspaceAdapter flush and loadLedger resolve cleanly', async () => {
      const memAdapter = new MemoryWikiWorkspaceAdapter()
      await expect(memAdapter.flush('doc-1')).resolves.toBeUndefined()
      const loadedStore = await memAdapter.loadLedger({ flushBeforeRead: true })
      expect(loadedStore).toBe(memAdapter.getLedgerStore())
    })
  })
})
