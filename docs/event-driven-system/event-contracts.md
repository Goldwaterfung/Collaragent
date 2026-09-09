# Event-Driven Serialized Drain System: Event Contracts & Interfaces

## 1. Specification Overview

This document specifies the formal TypeScript interfaces, discriminated union types, error codes, and configuration contracts for the **Event-Driven Serialized Drain System**.

In compliance with project coding standards:

- **Zero `any` Policy (Rule 4.1)**: All dynamic data uses discriminated unions, explicit generic constraints, or `unknown` narrowed with type guards.
- **No Hardcoded Constants (Rule 2.1)**: All default parameters, states, and limits are centrally declared.
- **Standardized Error Taxonomy (Rule 6.1 & 6.2)**: All error codes belong to the typed `SyncErrorCode` enum scoped with `SYNC_` prefix; domain errors encapsulate cause and diagnostic details.
- **Cancellation Token Support (Pattern A)**: All asynchronous operations accept an optional `AbortSignal`.

---

## 2. Centralized Error Code Taxonomy

```typescript
/**
 * Centralized error codes for the Synchronization and Drain Subsystem.
 * Must follow the SYNC_ prefix taxonomy per Coding Rule 6.1.
 */
export const enum SyncErrorCode {
  /** The operation was aborted via AbortSignal */
  SYNC_DRAIN_ABORTED = 'SYNC_DRAIN_ABORTED',

  /** Persistence write to Express API or disk failed after retries */
  SYNC_DRAIN_PERSIST_FAILED = 'SYNC_DRAIN_PERSIST_FAILED',

  /** Transactional flush barrier timed out awaiting consistency */
  SYNC_DRAIN_BARRIER_TIMEOUT = 'SYNC_DRAIN_BARRIER_TIMEOUT',

  /** The drain queue or instance worker was already disposed */
  SYNC_DRAIN_QUEUE_DISPOSED = 'SYNC_DRAIN_QUEUE_DISPOSED',

  /** The payload schema failed validation prior to dispatch */
  SYNC_DRAIN_PAYLOAD_INVALID = 'SYNC_DRAIN_PAYLOAD_INVALID',

  /** Instance worker reached unrecoverable faulted state */
  SYNC_DRAIN_WORKER_FAULTED = 'SYNC_DRAIN_WORKER_FAULTED'
}

/**
 * Structured diagnostic error for Synchronization and Drain failures.
 * Preserves upstream causes per Coding Rule 6.2.
 */
export class SyncError extends Error {
  public readonly code: SyncErrorCode
  public readonly subsystem = 'SYNC' as const
  public readonly recoverable: boolean
  public readonly details?: Readonly<Record<string, unknown>>

  constructor(params: {
    code: SyncErrorCode
    message: string
    recoverable?: boolean
    details?: Record<string, unknown>
    cause?: unknown
  }) {
    super(params.message, { cause: params.cause })
    this.name = 'SyncError'
    this.code = params.code
    this.recoverable = params.recoverable ?? false
    this.details = params.details ? Object.freeze({ ...params.details }) : undefined
  }
}
```

---

## 3. Inbound Triggers: `DrainTrigger`

An inbound trigger represents any domain event or command that requires the drain queue to evaluate or mutate an instance's persistent state.

```typescript
import type { DocumentPayload } from '@workspace/persistence/editorContent'
import type { GraphCanvasDTO } from '@shared/schemas/instances'
import type { Command } from '@shared/commands'
import type { WikiClaimBadge } from '@workspace/wiki/types'

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
```

---

## 4. Outbound Telemetry: `DrainLifecycleEvent`

Outbound lifecycle events are emitted by the `DrainLifecycleEventEmitter` to enable real-time UI status indicators, Langfuse/OpenTelemetry observability, and deterministic assertions in test suites.

```typescript
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
```

---

## 5. Public Gateway Interface: `ISerializedDrainQueue`

```typescript
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

  /** Persistence adapter responsible for executing the HTTP/API write */
  readonly persistenceAdapter: InstancePersistenceAdapter
}

/**
 * Standardized result returned by the persistence adapter.
 */
export interface InstancePersistenceResult {
  readonly status: 'saved' | 'ok'
  readonly bytesWritten?: number
}

/**
 * Execution options for transactional flush barriers.
 */
export interface FlushOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
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
   * Subscribes to lifecycle events for testing or telemetry.
   */
  on(listener: (event: DrainLifecycleEvent) => void): () => void

  /**
   * Disposes the queue, canceling active retries and rejecting pending barriers.
   */
  dispose(): Promise<void>
}
```

---

## 6. Internal Sub-Component Interfaces

These interfaces govern the internal building blocks of the `SerializedDrainQueue` subsystem in compliance with C3 component design.

```typescript
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
```

---

## 7. Type Guard Narrowing Functions

To satisfy the **Zero `any` Policy (Rule 4.1)** without unchecked casting, the following narrowing type guards are defined:

```typescript
/**
 * Type guard to check if a payload contains document blocks.
 */
export function isDocumentBlocksPayload(
  payload: unknown
): payload is Extract<DocumentPayload, { blocks: readonly unknown[] }> {
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

/**
 * Type guard to check if an unknown error is a structured SyncError.
 */
export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError && error.subsystem === 'SYNC'
}
```
