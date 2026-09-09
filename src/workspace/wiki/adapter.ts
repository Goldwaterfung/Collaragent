import type { DocumentPayload } from '@workspace/persistence/editorContent'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import { RelationalLedgerStore } from './RelationalLedgerStore'

export interface WikiAdapterReadOptions {
  signal?: AbortSignal
  timeoutMs?: number
  flushBeforeRead?: boolean
}

export interface WikiWorkspaceAdapter {
  getDocument(name: string, options?: WikiAdapterReadOptions): Promise<DocumentPayload | null>
  saveDocument(
    name: string,
    payload: DocumentPayload,
    options?: { signal?: AbortSignal }
  ): Promise<void>
  deleteDocument?(name: string, options?: { signal?: AbortSignal }): Promise<void>
  listDocuments?(
    options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>>
  getCanvas?(name?: string, options?: WikiAdapterReadOptions): Promise<GraphCanvasDTO | null>
  saveCanvas?(
    name: string,
    payload: GraphCanvasDTO,
    options?: { signal?: AbortSignal }
  ): Promise<string>
  listCanvases?(
    options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>>
  loadLedger?(options?: WikiAdapterReadOptions): Promise<RelationalLedgerStore>
  saveLedger?(store?: RelationalLedgerStore): Promise<void>
  getLedgerStore(): RelationalLedgerStore
  flush?(instanceId?: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>
}

/**
 * In-memory workspace adapter for isolated execution, unit tests, and rollback verification.
 */
export class MemoryWikiWorkspaceAdapter implements WikiWorkspaceAdapter {
  private readonly documents = new Map<string, DocumentPayload>()
  private readonly canvases = new Map<string, GraphCanvasDTO>()
  private readonly ledgerStore: RelationalLedgerStore

  constructor(ledgerStore?: RelationalLedgerStore) {
    this.ledgerStore = ledgerStore ?? new RelationalLedgerStore()
  }

  async getDocument(
    name: string,
    _options?: WikiAdapterReadOptions
  ): Promise<DocumentPayload | null> {
    const doc = this.documents.get(name)
    if (!doc) return null
    return JSON.parse(JSON.stringify(doc)) as DocumentPayload
  }

  async saveDocument(
    name: string,
    payload: DocumentPayload,
    _options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.documents.set(name, JSON.parse(JSON.stringify(payload)) as DocumentPayload)
  }

  async deleteDocument(name: string, _options?: { signal?: AbortSignal }): Promise<void> {
    this.documents.delete(name)
  }

  async listDocuments(
    _options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>> {
    return Array.from(this.documents.keys()).map((name) => ({ name, instanceId: name }))
  }

  async getCanvas(
    name?: string,
    _options?: WikiAdapterReadOptions
  ): Promise<GraphCanvasDTO | null> {
    const target = name ?? 'default'
    const canvas = this.canvases.get(target)
    if (!canvas) return null
    return JSON.parse(JSON.stringify(canvas)) as GraphCanvasDTO
  }

  async saveCanvas(
    name: string,
    payload: GraphCanvasDTO,
    _options?: { signal?: AbortSignal }
  ): Promise<string> {
    this.canvases.set(name, JSON.parse(JSON.stringify(payload)) as GraphCanvasDTO)
    return name
  }

  async listCanvases(
    _options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>> {
    return Array.from(this.canvases.keys()).map((name) => ({ name, instanceId: name }))
  }

  async loadLedger(_options?: WikiAdapterReadOptions): Promise<RelationalLedgerStore> {
    return this.ledgerStore
  }

  async saveLedger(store?: RelationalLedgerStore): Promise<void> {
    if (store && store !== this.ledgerStore) {
      this.ledgerStore.loadFromSnapshot(store.getAllEdges())
    }
  }

  async flush(
    _instanceId?: string,
    _options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<void> {
    return Promise.resolve()
  }

  getLedgerStore(): RelationalLedgerStore {
    return this.ledgerStore
  }

  /**
   * Helper to inspect current documents in memory.
   */
  getAllDocumentNames(): string[] {
    return Array.from(this.documents.keys())
  }

  /**
   * Helper to inspect current canvases in memory.
   */
  getAllCanvasNames(): string[] {
    return Array.from(this.canvases.keys())
  }
}
