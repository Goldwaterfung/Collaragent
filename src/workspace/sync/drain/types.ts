import type { DocumentPayload } from '@workspace/persistence/editorContent'
import type { GraphCanvasDTO } from '@shared/schemas/instances'
import type { Command } from '@shared/commands'
import type { WikiClaimBadge } from '@workspace/wiki/types'
import type { SyncError } from './errors'

export type { DocumentPayload, GraphCanvasDTO, Command, WikiClaimBadge }

/**
 * Payload representation for the relational ledger instance.
 */
export interface RelationalLedgerPayload {
  readonly edges: readonly unknown[]
}

/**
 * Unified payload type across all workspace instances (documents, canvas DAGs, and relational ledgers).
 * Satisfies Zero Any Policy (Rule 4.1) without unchecked casting.
 */
export type InstancePayload = DocumentPayload | GraphCanvasDTO | RelationalLedgerPayload

/**
 * Common metadata shared by all drain triggers.
 */
export interface BaseDrainTrigger {
  readonly instanceId: string
  readonly timestamp: number
  readonly triggerId: string
}

/**
 * Triggered when a Lexical rich-text document is updated by the editor or agent.
 */
export interface DocumentEditTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:document_edit'
  readonly projectId?: string
  readonly payload: DocumentPayload
  readonly sequenceNumber?: number
}

/**
 * Triggered when a Canvas command (node move, edge creation, Dagre layout) is dispatched.
 */
export interface CanvasCommandTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:canvas_command'
  readonly projectId?: string
  readonly command: Command
  readonly version: number
  readonly threadId?: string
}

/**
 * Triggered when a full GraphCanvasDTO snapshot is emitted (e.g. initial canvas sync, proposal acceptance).
 */
export interface CanvasSnapshotTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:canvas_snapshot'
  readonly projectId?: string
  readonly payload: GraphCanvasDTO
  readonly version?: number
}

/**
 * Triggered when wiki claims are extracted from a document and must sync to the relational ledger.
 */
export interface ClaimSyncTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:claim_sync'
  readonly documentName: string
  readonly claims: readonly WikiClaimBadge[]
}

/**
 * Triggered when relational ledger edges are modified directly.
 */
export interface LedgerMutationTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:ledger_mutation'
  readonly projectId?: string
  readonly serializedEdges: readonly unknown[]
}

/**
 * Triggered when an instance is closed or deleted, allowing the queue to evict the worker cleanly.
 */
export interface InstanceDeletedTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:instance_deleted'
}

/**
 * Triggered when an agent tool or test harness requires a transactional flush barrier.
 */
export interface FlushBarrierTrigger extends BaseDrainTrigger {
  readonly type: 'trigger:flush_barrier'
  readonly signal?: AbortSignal
  readonly barrierId: string
}

/**
 * Discriminated union of all supported inbound triggers.
 */
export type DrainTrigger =
  | DocumentEditTrigger
  | CanvasCommandTrigger
  | CanvasSnapshotTrigger
  | ClaimSyncTrigger
  | LedgerMutationTrigger
  | InstanceDeletedTrigger
  | FlushBarrierTrigger

/**
 * State machine states for an individual instance drain worker.
 */
export type DrainWorkerState =
  'IDLE' | 'DRAINING' | 'COALESCING' | 'RETRYING' | 'FAULTED' | 'DISPOSED'

/**
 * Emitted when an instance begins executing a single-flight persistence write.
 */
export interface DrainStartedEvent {
  readonly type: 'drain:started'
  readonly instanceId: string
  readonly cycleId: string
  readonly timestamp: number
}

/**
 * Emitted when incoming mutations arrive while a write is in-flight and are coalesced.
 */
export interface DrainCoalescedEvent {
  readonly type: 'drain:coalesced'
  readonly instanceId: string
  readonly cycleId: string
  readonly pendingPayloadSize: number
  readonly timestamp: number
}

/**
 * Emitted when a single-flight write completes successfully and data is committed on disk.
 */
export interface DrainCompletedEvent {
  readonly type: 'drain:completed'
  readonly instanceId: string
  readonly cycleId: string
  readonly durationMs: number
  readonly bytesWritten: number
  readonly remainingDirty: boolean
  readonly timestamp: number
}

/**
 * Emitted when a persistence write encounters an error.
 */
export interface DrainFailedEvent {
  readonly type: 'drain:failed'
  readonly instanceId: string
  readonly cycleId: string
  readonly error: SyncError
  readonly retryCount: number
  readonly willRetry: boolean
  readonly timestamp: number
}

/**
 * Emitted when a persistence write encounters an error and schedules a non-blocking retry.
 */
export interface DrainRetryingEvent {
  readonly type: 'drain:retrying'
  readonly instanceId: string
  readonly cycleId: string
  readonly attempt: number
  readonly delayMs: number
  readonly timestamp: number
}

/**
 * Emitted when an instance worker transitions to IDLE with no dirty state remaining.
 */
export interface DrainIdleEvent {
  readonly type: 'drain:idle'
  readonly instanceId: string
  readonly timestamp: number
}

/**
 * Discriminated union of all drain lifecycle events.
 */
export type DrainLifecycleEvent =
  | DrainStartedEvent
  | DrainCoalescedEvent
  | DrainCompletedEvent
  | DrainFailedEvent
  | DrainRetryingEvent
  | DrainIdleEvent

/**
 * Standardized result returned by the persistence adapter.
 */
export interface InstancePersistenceResult {
  readonly status: 'saved' | 'ok'
  readonly bytesWritten?: number
}

/**
 * Storage adapter contract used by the drain queue to execute atomic writes.
 */
export interface InstancePersistenceAdapter {
  saveInstance(params: {
    instanceId: string
    projectId?: string
    payload: InstancePayload
    signal?: AbortSignal
  }): Promise<InstancePersistenceResult>
}

/**
 * Execution options for transactional flush barriers.
 */
export interface FlushOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/**
 * Configuration options for the SerializedDrainQueue.
 */
export interface SerializedDrainQueueOptions {
  /** Maximum retry attempts for transient I/O failures (default: 3) */
  readonly maxRetries?: number

  /** Initial base backoff interval in milliseconds (default: 50) */
  readonly baseBackoffMs?: number

  /** Maximum backoff ceiling in milliseconds (default: 1000) */
  readonly maxBackoffMs?: number

  /** Persistence adapter responsible for executing the persistence write */
  readonly persistenceAdapter: InstancePersistenceAdapter

  /** Optional random generator injection for deterministic testing */
  readonly randomGenerator?: () => number
}

/**
 * Core interface for the Event-Driven Serialized Drain Queue.
 */
export interface ISerializedDrainQueue {
  /**
   * Enqueues an inbound trigger.
   * If the instance is IDLE, persistence starts immediately.
   * If the instance is DRAINING, the mutation is coalesced into the in-memory buffer.
   */
  enqueue(trigger: DrainTrigger): void

  /**
   * Transactional barrier: returns a promise that resolves ONLY when all in-flight
   * and pending coalesced writes for the specified instance have settled to disk.
   * If instanceId is omitted, awaits all active instances across the workspace.
   */
  flush(instanceId?: string, options?: FlushOptions): Promise<void>

  /**
   * Evicts an instance worker from the queue after closure or deletion.
   */
  evict(instanceId: string): void

  /**
   * Returns the current lifecycle state of an instance worker.
   */
  getState(instanceId: string): DrainWorkerState

  /**
   * Returns true if an active worker is currently allocated for the instance.
   */
  hasWorker(instanceId: string): boolean

  /**
   * Subscribes to lifecycle events for testing or telemetry.
   */
  on(listener: (event: DrainLifecycleEvent) => void): () => void

  /**
   * Disposes the queue, canceling active retries and rejecting pending barriers.
   */
  dispose(): Promise<void>
}

/**
 * Deferred promise barrier entry managed by the barrier registry.
 */
export interface DeferredBarrier {
  readonly barrierId: string
  readonly resolve: () => void
  readonly reject: (error: SyncError) => void
  readonly signal?: AbortSignal
}

/**
 * Contract for the Transactional Barrier Registry.
 */
export interface ITransactionalBarrierRegistry {
  /** Registers a deferred barrier promise */
  register(options?: FlushOptions): Promise<void>

  /** Resolves all registered barrier promises when the worker reaches clean IDLE state */
  resolveAll(): void

  /** Rejects all registered barrier promises with a structured SyncError */
  rejectAll(error: SyncError): void

  /** Returns the count of pending barrier promises */
  readonly size: number

  /** Cleans up all pending barriers on disposal */
  dispose(): void
}

/**
 * Configuration options for the BackoffPolicyEngine.
 */
export interface BackoffPolicyConfig {
  readonly maxRetries: number
  readonly baseBackoffMs: number
  readonly maxBackoffMs: number
}

/**
 * Pure mathematical calculator for non-blocking exponential backoff and jitter.
 * Zero side-effects and zero thread sleep per Coding Rule 2.1.
 */
export interface IBackoffPolicyEngine {
  /** Calculates the next delay in milliseconds with jitter */
  calculateDelay(attempt: number): number

  /** Determines if another retry should be attempted */
  shouldRetry(attempt: number): boolean

  /** Configuration snapshot */
  readonly config: Readonly<BackoffPolicyConfig>
}

/**
 * Contract for an individual instance worker state machine.
 */
export interface IInstanceDrainWorker {
  readonly instanceId: string
  readonly state: DrainWorkerState
  readonly isDirty: boolean

  /** Dispatches an inbound trigger to the state machine */
  handleTrigger(trigger: DrainTrigger): void

  /** Awaits completion of in-flight and pending coalesced writes */
  flush(options?: FlushOptions): Promise<void>

  /** Disposes the worker and cancels pending retries */
  dispose(): Promise<void>
}

/**
 * Type guard to check if a payload contains document blocks.
 */
export function isDocumentBlocksPayload(payload: unknown): payload is DocumentPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'blocks' in payload &&
    Array.isArray((payload as { blocks: unknown }).blocks)
  )
}

/**
 * Type guard to check if a payload is a graph canvas DTO.
 */
export function isGraphCanvasPayload(payload: unknown): payload is GraphCanvasDTO {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'type' in payload &&
    (payload as { type: unknown }).type === 'graph-canvas'
  )
}

/**
 * Type guard to check if a payload is a relational ledger payload.
 */
export function isRelationalLedgerPayload(payload: unknown): payload is RelationalLedgerPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'edges' in payload &&
    Array.isArray((payload as { edges: unknown }).edges)
  )
}
