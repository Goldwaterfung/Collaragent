/**
 * evals/telemetry/DatasetScoreManager.ts
 * Programmatic client for Langfuse dataset synchronization, dataset run linking, and evaluation scoring.
 */

import { Langfuse } from 'langfuse'
import { createLangfuseClient } from './langfuse'
import {
  formatScoresFromSummary,
  type CreateScoreParams,
  type CreateBatchScoresParams
} from './scores'
import type { ScenarioInvariantSummary } from '../assertions/types'

/**
 * Configuration options for initializing DatasetScoreManager.
 */
export interface DatasetScoreManagerOptions {
  /** Optional pre-instantiated Langfuse client */
  readonly client?: Langfuse
}

/**
 * Parameters for synchronizing a Langfuse dataset item.
 */
export interface SyncDatasetItemParams {
  readonly datasetName: string
  readonly itemId?: string
  readonly input: unknown
  readonly expectedOutput?: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly status?: 'ACTIVE' | 'ARCHIVED'
}

/**
 * Parameters for linking an execution trace to a dataset run item.
 */
export interface CreateDatasetRunItemParams {
  readonly runName: string
  readonly datasetItemId: string
  readonly traceId?: string
  readonly observationId?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly runDescription?: string
}

/**
 * Parameters for recording all invariant scores from a scenario summary.
 */
export interface RecordScenarioSummaryParams {
  readonly traceId: string
  readonly summary: ScenarioInvariantSummary
  readonly observationId?: string
  readonly datasetRunId?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Programmatic manager for dataset lifecycle, run item linking, and quantitative evaluation scoring in Langfuse.
 * Operates in fail-safe mode (graceful no-op) when Langfuse credentials are not provided.
 */
export class DatasetScoreManager {
  private readonly client: Langfuse | undefined

  public constructor(options?: DatasetScoreManagerOptions) {
    this.client = options?.client ?? createLangfuseClient()
  }

  /**
   * Indicates whether the manager has an active Langfuse client instance.
   */
  public get isEnabled(): boolean {
    return this.client !== undefined
  }

  /**
   * Synchronizes or creates a Dataset in Langfuse.
   *
   * @param datasetName Unique name of the dataset
   * @param description Optional description for the dataset
   * @param metadata Optional metadata object
   * @returns Created dataset metadata or undefined if disabled
   */
  public async syncDataset(
    datasetName: string,
    description?: string,
    metadata?: Readonly<Record<string, unknown>>
  ): Promise<{ id: string; name: string } | undefined> {
    if (!this.client) {
      return undefined
    }

    const response = await this.client.createDataset({
      name: datasetName,
      description,
      metadata: metadata ? { ...metadata } : undefined
    })

    return {
      id: response.id,
      name: response.name
    }
  }

  /**
   * Synchronizes or creates a DatasetItem in Langfuse.
   *
   * @param params Item configuration (datasetName, input, expectedOutput, metadata)
   * @returns Created item metadata or undefined if disabled
   */
  public async syncDatasetItem(params: SyncDatasetItemParams): Promise<{ id: string } | undefined> {
    if (!this.client) {
      return undefined
    }

    const response = await this.client.createDatasetItem({
      datasetName: params.datasetName,
      id: params.itemId,
      input: params.input,
      expectedOutput: params.expectedOutput,
      metadata: params.metadata ? { ...params.metadata } : undefined,
      status: params.status
    })

    return {
      id: response.id
    }
  }

  /**
   * Links an execution trace to a dataset item as part of an evaluation run.
   *
   * @param params Run item configuration (runName, datasetItemId, traceId, observationId, metadata)
   * @returns Created run item metadata or undefined if disabled
   */
  public async createDatasetRunItem(
    params: CreateDatasetRunItemParams
  ): Promise<{ id: string } | undefined> {
    if (!this.client) {
      return undefined
    }

    const response = await this.client.createDatasetRunItem({
      runName: params.runName,
      datasetItemId: params.datasetItemId,
      traceId: params.traceId,
      observationId: params.observationId,
      metadata: params.metadata ? { ...params.metadata } : undefined,
      runDescription: params.runDescription
    })

    return {
      id: response.id
    }
  }

  /**
   * Records a single evaluation score on a trace or observation.
   *
   * @param params Score parameters (traceId, score, observationId, datasetRunId)
   * @returns True if score was queued, false if disabled
   */
  public recordScore(params: CreateScoreParams): boolean {
    if (!this.client) {
      return false
    }

    this.client.score({
      traceId: params.traceId,
      observationId: params.observationId,
      datasetRunId: params.datasetRunId,
      name: params.score.name,
      value: params.score.value,
      comment: params.score.comment,
      metadata: params.score.metadata ? { ...params.score.metadata } : undefined,
      dataType: params.score.dataType
    })

    return true
  }

  /**
   * Records a batch of evaluation scores on a trace.
   *
   * @param params Batch score parameters
   * @returns True if scores were queued, false if disabled
   */
  public recordScores(params: CreateBatchScoresParams): boolean {
    if (!this.client) {
      return false
    }

    for (const score of params.scores) {
      this.recordScore({
        traceId: params.traceId,
        score,
        observationId: params.observationId,
        datasetRunId: params.datasetRunId
      })
    }

    return true
  }

  /**
   * Converts a scenario invariant summary into standardized scores and records them on the trace.
   *
   * @param params Summary parameters (traceId, summary, observationId, datasetRunId, metadata)
   * @returns True if scores were queued, false if disabled
   */
  public recordScenarioSummary(params: RecordScenarioSummaryParams): boolean {
    if (!this.client) {
      return false
    }

    const scores = formatScoresFromSummary(params.summary, params.metadata)

    return this.recordScores({
      traceId: params.traceId,
      scores,
      observationId: params.observationId,
      datasetRunId: params.datasetRunId
    })
  }

  /**
   * Flushes all pending score and telemetry queues to ensure zero dropped events before process exit.
   */
  public async flush(): Promise<void> {
    if (!this.client) {
      return
    }

    await this.client.flushAsync()
  }
}
