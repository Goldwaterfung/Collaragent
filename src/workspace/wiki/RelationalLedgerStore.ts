import {
  type RelationalLedgerEntry,
  RelationalLedgerEntrySchema,
  ClaimRelation
} from '@shared/wiki'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import { assertNoSupersedenceCycle } from './TarjanCycleDetector'

export interface UpsertResult {
  edge: RelationalLedgerEntry
  created: boolean
  previous?: RelationalLedgerEntry
}

/**
 * In-memory and persisted store for the single workspace-level Relational Ledger.
 * Provides O(1) in-memory lookups for backlinks and outlinks via adjacency maps.
 */
export class RelationalLedgerStore {
  private readonly edgesById = new Map<string, RelationalLedgerEntry>()
  private readonly outlinksBySource = new Map<string, Set<string>>()
  private readonly backlinksByTarget = new Map<string, Set<string>>()
  private readonly listeners = new Set<() => void>()

  /**
   * Subscribes a listener to ledger mutations. Returns an unsubscribe function.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /**
   * Loads ledger entries from a raw array of records or unknown JSON snapshot.
   */
  public loadFromSnapshot(entries: unknown): void {
    this.clear()
    if (!Array.isArray(entries)) {
      return
    }

    for (const rawEntry of entries) {
      const parsed = RelationalLedgerEntrySchema.safeParse(rawEntry)
      if (parsed.success) {
        this.indexEntry(parsed.data)
      } else {
        throw new WorkspaceError(
          WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA,
          `Invalid relational ledger entry in snapshot: ${parsed.error.message}`,
          { cause: parsed.error }
        )
      }
    }
    this.notifyListeners()
  }

  /**
   * Exports all active ledger entries as an array of RelationalLedgerEntry records.
   */
  public exportSnapshot(): RelationalLedgerEntry[] {
    return Array.from(this.edgesById.values())
  }

  /**
   * Resets all in-memory edges and adjacency maps.
   */
  public clear(): void {
    this.edgesById.clear()
    this.outlinksBySource.clear()
    this.backlinksByTarget.clear()
    this.notifyListeners()
  }

  /**
   * Retrieves a single ledger edge by UUID.
   */
  public getEdge(edgeId: string): RelationalLedgerEntry | undefined {
    return this.edgesById.get(edgeId)
  }

  /**
   * Retrieves all outlinks from a source entity in O(1) adjacency lookup.
   */
  public getOutlinks(sourceEntityId: string): RelationalLedgerEntry[] {
    const edgeIds = this.outlinksBySource.get(sourceEntityId)
    if (!edgeIds || edgeIds.size === 0) return []

    const outlinks: RelationalLedgerEntry[] = []
    for (const id of edgeIds) {
      const edge = this.edgesById.get(id)
      if (edge) outlinks.push(edge)
    }
    return outlinks
  }

  /**
   * Retrieves all backlinks pointing to a target entity in O(1) adjacency lookup.
   */
  public getBacklinks(targetEntityId: string): RelationalLedgerEntry[] {
    const edgeIds = this.backlinksByTarget.get(targetEntityId)
    if (!edgeIds || edgeIds.size === 0) return []

    const backlinks: RelationalLedgerEntry[] = []
    for (const id of edgeIds) {
      const edge = this.edgesById.get(id)
      if (edge) backlinks.push(edge)
    }
    return backlinks
  }

  /**
   * Returns all edges currently in the ledger.
   */
  public getAllEdges(): RelationalLedgerEntry[] {
    return Array.from(this.edgesById.values())
  }

  /**
   * Finds an existing edge matching source, target, and relation predicate.
   */
  public findEdge(
    sourceEntityId: string,
    targetEntityId: string,
    rel: ClaimRelation
  ): RelationalLedgerEntry | undefined {
    const outlinks = this.getOutlinks(sourceEntityId)
    return outlinks.find((e) => e.targetEntityId === targetEntityId && e.rel === rel)
  }

  /**
   * Inserts or updates an edge in the ledger with in-place deduplication and promotion.
   */
  public upsertEdge(entryInput: unknown): UpsertResult {
    const parsed = RelationalLedgerEntrySchema.safeParse(entryInput)
    if (!parsed.success) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA,
        `Cannot upsert invalid ledger entry: ${parsed.error.message}`,
        { cause: parsed.error }
      )
    }
    const entry = parsed.data

    // Spec §7.7: Gated against cyclic supersedence via Tarjan SCC
    if (entry.rel === 'supersedes') {
      assertNoSupersedenceCycle(this.getAllEdges(), entry)
    }

    // Check if an edge already exists for (source, target, rel)
    const existing = this.findEdge(entry.sourceEntityId, entry.targetEntityId, entry.rel)

    if (existing) {
      // In-place update / promotion
      let updatedEntry: RelationalLedgerEntry

      if (entry.provenance === 'document_claim') {
        // Promote or re-anchor to document_claim
        updatedEntry = {
          ...existing,
          provenance: 'document_claim',
          anchor: entry.anchor ?? existing.anchor,
          canvasContext: entry.canvasContext ?? existing.canvasContext,
          status: 'active',
          meta: {
            ...existing.meta,
            updatedAt: entry.meta.updatedAt,
            author: entry.meta.author
          }
        }
      } else {
        // canvas_relational: preserve document_claim anchor if existing is already claimed
        updatedEntry = {
          ...existing,
          canvasContext: entry.canvasContext ?? existing.canvasContext,
          status: existing.status === 'archived' ? 'active' : existing.status,
          meta: {
            ...existing.meta,
            updatedAt: entry.meta.updatedAt,
            author: entry.meta.author
          }
        }
      }

      this.edgesById.set(existing.id, updatedEntry)
      this.notifyListeners()
      return { edge: updatedEntry, created: false, previous: existing }
    }

    // New Edge
    this.indexEntry(entry)
    this.notifyListeners()
    return { edge: entry, created: true }
  }

  /**
   * Removes an edge by UUID, cleaning up adjacency index maps.
   */
  public removeEdge(edgeId: string): RelationalLedgerEntry | undefined {
    const existing = this.edgesById.get(edgeId)
    if (!existing) return undefined

    this.edgesById.delete(edgeId)
    this.outlinksBySource.get(existing.sourceEntityId)?.delete(edgeId)
    this.backlinksByTarget.get(existing.targetEntityId)?.delete(edgeId)
    this.notifyListeners()

    return existing
  }

  /**
   * Removes edges matching a query filter (sourceEntityId, targetEntityId, rel).
   */
  public removeEdgesByQuery(query: {
    sourceEntityId?: string
    targetEntityId?: string
    rel?: ClaimRelation
  }): RelationalLedgerEntry[] {
    const matched: RelationalLedgerEntry[] = []
    for (const edge of this.getAllEdges()) {
      if (query.sourceEntityId && edge.sourceEntityId !== query.sourceEntityId) continue
      if (query.targetEntityId && edge.targetEntityId !== query.targetEntityId) continue
      if (query.rel && edge.rel !== query.rel) continue
      matched.push(edge)
    }

    for (const edge of matched) {
      this.removeEdge(edge.id)
    }
    return matched
  }

  /**
   * Purges all edges with status: 'anchor_lost'.
   */
  public pruneDegradedEdges(): RelationalLedgerEntry[] {
    const degraded = this.getAllEdges().filter((e) => e.status === 'anchor_lost')
    for (const edge of degraded) {
      this.removeEdge(edge.id)
    }
    return degraded
  }

  /**
   * Purges all edges whose source or target entity is missing from the provided known entities set.
   */
  public pruneUnresolvedEdges(knownEntities: Set<string>): RelationalLedgerEntry[] {
    const unresolved = this.getAllEdges().filter(
      (e) => !knownEntities.has(e.sourceEntityId) || !knownEntities.has(e.targetEntityId)
    )
    for (const edge of unresolved) {
      this.removeEdge(edge.id)
    }
    return unresolved
  }

  /**
   * Transitions an anchored edge to status: 'anchor_lost' without removing it from the graph.
   */
  public degradeEdge(edgeId: string, reason: 'anchor_lost'): RelationalLedgerEntry | undefined {
    const existing = this.edgesById.get(edgeId)
    if (!existing) return undefined

    const degraded: RelationalLedgerEntry = {
      ...existing,
      status: reason,
      meta: {
        ...existing.meta,
        updatedAt: new Date().toISOString()
      }
    }

    this.edgesById.set(edgeId, degraded)
    this.notifyListeners()
    return degraded
  }

  /**
   * Restores an anchor_lost edge back to active document_claim with a new anchor block.
   */
  public restoreEdge(
    edgeId: string,
    anchor: { blockId: string; justification: string; selectedTextSnippet?: string }
  ): RelationalLedgerEntry | undefined {
    const existing = this.edgesById.get(edgeId)
    if (!existing) return undefined

    const restored: RelationalLedgerEntry = {
      ...existing,
      provenance: 'document_claim',
      anchor,
      status: 'active',
      meta: {
        ...existing.meta,
        updatedAt: new Date().toISOString()
      }
    }

    this.edgesById.set(edgeId, restored)
    this.notifyListeners()
    return restored
  }

  /**
   * Optional file persistence delegates injected in Node.js environments.
   */
  public static fileLoader?: (store: RelationalLedgerStore, filePath: string) => Promise<void>
  public static fileSaver?: (store: RelationalLedgerStore, filePath: string) => Promise<void>

  /**
   * Loads the ledger from .collar/instances/ledger-default.json.
   * If the file does not exist, initializes an empty ledger without error.
   */
  public async loadFromFile(filePath: string): Promise<void> {
    if (!RelationalLedgerStore.fileLoader) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED,
        'File persistence is only supported in Node.js environments'
      )
    }
    return RelationalLedgerStore.fileLoader(this, filePath)
  }

  /**
   * Persists the ledger snapshot to disk at .collar/instances/ledger-default.json atomically.
   */
  public async saveToFile(filePath: string): Promise<void> {
    if (!RelationalLedgerStore.fileSaver) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED,
        'File persistence is only supported in Node.js environments'
      )
    }
    return RelationalLedgerStore.fileSaver(this, filePath)
  }

  private indexEntry(entry: RelationalLedgerEntry): void {
    this.edgesById.set(entry.id, entry)

    let outSet = this.outlinksBySource.get(entry.sourceEntityId)
    if (!outSet) {
      outSet = new Set<string>()
      this.outlinksBySource.set(entry.sourceEntityId, outSet)
    }
    outSet.add(entry.id)

    let backSet = this.backlinksByTarget.get(entry.targetEntityId)
    if (!backSet) {
      backSet = new Set<string>()
      this.backlinksByTarget.set(entry.targetEntityId, backSet)
    }
    backSet.add(entry.id)
  }
}
