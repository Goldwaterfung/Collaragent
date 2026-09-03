import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  SerializerProtocol,
  PendingWrite
} from '@langchain/langgraph-checkpoint'
import { SQLITE_ENGINE_CONFIG } from './config/sqliteConfig'
import { CheckpointStore } from './CheckpointStore'
import { SqliteCheckpointStore } from './SqliteCheckpointStore'
import {
  ICheckpointStore,
  CheckpointRecord,
  CheckpointBlobRecord,
  CheckpointWriteRecord
} from './interfaces/ICheckpointStore'

interface PreCalculatedBlob {
  readonly type: string
  readonly blob: unknown
  readonly serialized?: boolean
}

function isPreCalculatedBlob(value: unknown): value is PreCalculatedBlob {
  if (value === null || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.type === 'string' && 'blob' in obj
}

function hasGetCheckpoint(store: ICheckpointStore | CheckpointStore): store is ICheckpointStore & {
  getCheckpoint(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): Promise<CheckpointRecord | undefined>
} {
  return (
    'getCheckpoint' in store &&
    typeof (store as { getCheckpoint?: unknown }).getCheckpoint === 'function'
  )
}

function hasGetLatestCheckpoint(
  store: ICheckpointStore | CheckpointStore
): store is ICheckpointStore {
  return (
    'getLatestCheckpoint' in store &&
    typeof (store as { getLatestCheckpoint?: unknown }).getLatestCheckpoint === 'function'
  )
}

function hasPruneWrites(store: ICheckpointStore | CheckpointStore): store is ICheckpointStore {
  return (
    'pruneWrites' in store && typeof (store as { pruneWrites?: unknown }).pruneWrites === 'function'
  )
}

function hasDeleteThread(
  store: ICheckpointStore | CheckpointStore
): store is (ICheckpointStore | CheckpointStore) & {
  deleteThread(threadId: string): Promise<void>
} {
  return (
    'deleteThread' in store &&
    typeof (store as { deleteThread?: unknown }).deleteThread === 'function'
  )
}

function toCheckpoint(
  raw: Record<string, unknown>,
  channelValues: Record<string, unknown>
): Checkpoint {
  return {
    v: typeof raw.v === 'number' ? raw.v : 1,
    id: typeof raw.id === 'string' ? raw.id : '',
    ts: typeof raw.ts === 'string' ? raw.ts : new Date().toISOString(),
    channel_versions: (raw.channel_versions as Record<string, string>) ?? {},
    versions_seen: (raw.versions_seen as Record<string, Record<string, string>>) ?? {},
    ...raw,
    channel_values: channelValues
  }
}

function toCheckpointMetadata(raw: Record<string, unknown>): CheckpointMetadata {
  return {
    source: (raw.source as 'fork' | 'input' | 'loop' | 'update') ?? 'loop',
    step: typeof raw.step === 'number' ? raw.step : 0,
    parents: (raw.parents as Record<string, string>) ?? {},
    counters_since_delta_snapshot: raw.counters_since_delta_snapshot as
      Record<string, [number, number]> | undefined,
    ...raw
  }
}

export class FileSystemSaver extends BaseCheckpointSaver {
  private store: ICheckpointStore | CheckpointStore

  constructor(store: ICheckpointStore | CheckpointStore, serde?: SerializerProtocol) {
    super(serde)
    this.store = store
  }

  async setRestoreHead(
    threadId: string,
    checkpointId: string,
    checkpointNs: string = ''
  ): Promise<void> {
    if (!threadId || !checkpointId) return
    if ('setRestoreHead' in this.store && typeof this.store.setRestoreHead === 'function') {
      await this.store.setRestoreHead(threadId, checkpointId, checkpointNs)
    } else if ('putRestoreHead' in this.store && typeof this.store.putRestoreHead === 'function') {
      await this.store.putRestoreHead(threadId, checkpointNs, checkpointId)
    }
  }

  async getRestoreHead(threadId: string, checkpointNs: string = ''): Promise<string | undefined> {
    if (!threadId) return undefined
    return this.store.getRestoreHead(threadId, checkpointNs)
  }

  async clearRestoreHead(threadId: string, checkpointNs: string = ''): Promise<void> {
    if (!threadId) return
    if ('clearRestoreHead' in this.store && typeof this.store.clearRestoreHead === 'function') {
      await this.store.clearRestoreHead(threadId, checkpointNs)
    }
  }

  async getTuple(config: {
    configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
  }): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns || ''
    const checkpoint_id = config.configurable?.checkpoint_id

    if (!thread_id) return undefined

    let record: CheckpointRecord | undefined

    if (checkpoint_id) {
      if (hasGetCheckpoint(this.store)) {
        record = await this.store.getCheckpoint(thread_id, checkpoint_ns, checkpoint_id)
      } else {
        const threadCheckpoints = await this.store.getCheckpoints(thread_id)
        record = threadCheckpoints.find(
          (cp) => cp.checkpoint_id === checkpoint_id && cp.checkpoint_ns === checkpoint_ns
        )
      }
    } else {
      const restoreHeadId = await this.getRestoreHead(thread_id, checkpoint_ns)
      if (restoreHeadId) {
        if (hasGetCheckpoint(this.store)) {
          record = await this.store.getCheckpoint(thread_id, checkpoint_ns, restoreHeadId)
        } else {
          const threadCheckpoints = await this.store.getCheckpoints(thread_id)
          record = threadCheckpoints.find(
            (cp) => cp.checkpoint_id === restoreHeadId && cp.checkpoint_ns === checkpoint_ns
          )
        }
      }

      if (!record) {
        if (hasGetLatestCheckpoint(this.store)) {
          record = await this.store.getLatestCheckpoint(thread_id, checkpoint_ns)
        } else {
          const threadCheckpoints = await this.store.getCheckpoints(thread_id)
          const nsCheckpoints = threadCheckpoints.filter((cp) => cp.checkpoint_ns === checkpoint_ns)
          if (nsCheckpoints.length > 0) {
            record = nsCheckpoints[nsCheckpoints.length - 1]
          }
        }
      }
    }

    if (!record) return undefined

    const channel_values: Record<string, unknown> = {}
    const channelVersions = (
      record.checkpoint as { channel_versions?: Record<string, string | number> }
    ).channel_versions
    if (channelVersions) {
      for (const [channel, version] of Object.entries(channelVersions)) {
        const blobKey = `${thread_id}:${channel}:${version}`
        const blobRecord = await this.store.getBlob(blobKey)
        if (blobRecord && blobRecord.type !== 'empty') {
          if (blobRecord.type && blobRecord.blob !== undefined && blobRecord.blob !== null) {
            try {
              if (blobRecord.serialized) {
                const blobData =
                  typeof blobRecord.blob === 'string'
                    ? new TextEncoder().encode(blobRecord.blob)
                    : (blobRecord.blob as Uint8Array)
                channel_values[channel] = await this.serde.loadsTyped(blobRecord.type, blobData)
              } else {
                channel_values[channel] = blobRecord.blob
              }
            } catch (e) {
              console.error(`[FileSystemSaver] Failed to deserialize blob for ${channel}:`, e)
              throw e
            }
          }
        }
      }
    }

    const pendingWrites: [string, string, unknown][] = []
    const threadWrites = await this.store.getWrites(thread_id, record.checkpoint_id)
    const matchingWrites = threadWrites.filter((w) => w.checkpoint_ns === checkpoint_ns)

    matchingWrites.forEach((w) => {
      pendingWrites.push([w.task_id, w.channel, w.blob])
    })

    const finalCheckpoint = toCheckpoint(record.checkpoint, channel_values)

    const finalConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: record.checkpoint_id
      }
    }

    const parentConfig = record.parent_checkpoint_id
      ? {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: record.parent_checkpoint_id
          }
        }
      : undefined

    return {
      config: finalConfig,
      checkpoint: finalCheckpoint,
      metadata: toCheckpointMetadata(record.metadata),
      parentConfig,
      pendingWrites
    }
  }

  async getRawTuple(config: {
    configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
  }): Promise<CheckpointTuple | undefined> {
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns || ''
    const checkpoint_id = config.configurable?.checkpoint_id

    if (!thread_id) return undefined

    let record: CheckpointRecord | undefined

    if (checkpoint_id) {
      if (hasGetCheckpoint(this.store)) {
        record = await this.store.getCheckpoint(thread_id, checkpoint_ns, checkpoint_id)
      } else {
        const threadCheckpoints = await this.store.getCheckpoints(thread_id)
        record = threadCheckpoints.find(
          (cp) => cp.checkpoint_id === checkpoint_id && cp.checkpoint_ns === checkpoint_ns
        )
      }
    } else {
      const restoreHeadId = await this.getRestoreHead(thread_id, checkpoint_ns)
      if (restoreHeadId) {
        if (hasGetCheckpoint(this.store)) {
          record = await this.store.getCheckpoint(thread_id, checkpoint_ns, restoreHeadId)
        } else {
          const threadCheckpoints = await this.store.getCheckpoints(thread_id)
          record = threadCheckpoints.find(
            (cp) => cp.checkpoint_id === restoreHeadId && cp.checkpoint_ns === checkpoint_ns
          )
        }
      }

      if (!record) {
        if (hasGetLatestCheckpoint(this.store)) {
          record = await this.store.getLatestCheckpoint(thread_id, checkpoint_ns)
        } else {
          const threadCheckpoints = await this.store.getCheckpoints(thread_id)
          const nsCheckpoints = threadCheckpoints.filter((cp) => cp.checkpoint_ns === checkpoint_ns)
          if (nsCheckpoints.length > 0) {
            record = nsCheckpoints[nsCheckpoints.length - 1]
          }
        }
      }
    }

    if (!record) return undefined

    const channel_values: Record<string, unknown> = {}
    const channelVersions = (
      record.checkpoint as { channel_versions?: Record<string, string | number> }
    ).channel_versions
    if (channelVersions) {
      for (const [channel, version] of Object.entries(channelVersions)) {
        const blobKey = `${thread_id}:${channel}:${version}`
        const blobRecord = await this.store.getBlob(blobKey)
        if (blobRecord) {
          channel_values[channel] = {
            type: blobRecord.type,
            blob: blobRecord.blob,
            serialized: blobRecord.serialized
          }
        }
      }
    }

    const pendingWrites: [string, string, unknown][] = []
    const matchingWrites = await this.store.getWrites(thread_id, record.checkpoint_id)

    matchingWrites.forEach((w) => {
      pendingWrites.push([w.task_id, w.channel, w.blob])
    })

    const finalCheckpoint = toCheckpoint(record.checkpoint, channel_values)

    const finalConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: record.checkpoint_id
      }
    }

    const parentConfig = record.parent_checkpoint_id
      ? {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: record.parent_checkpoint_id
          }
        }
      : undefined

    return {
      config: finalConfig,
      checkpoint: finalCheckpoint,
      metadata: toCheckpointMetadata(record.metadata),
      parentConfig,
      pendingWrites
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!threadId) return
    if (hasDeleteThread(this.store)) {
      await this.store.deleteThread(threadId)
    }
  }

  async *list(
    config: {
      configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
    },
    options?: {
      before?: { configurable?: { checkpoint_id?: string } }
      limit?: number
      filter?: Record<string, unknown>
    }
  ): AsyncGenerator<CheckpointTuple> {
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns

    if (!thread_id) return

    let records: CheckpointRecord[]
    if (checkpoint_ns !== undefined) {
      records = await this.store.getCheckpoints(thread_id, checkpoint_ns)
    } else {
      records = await this.store.getCheckpoints(thread_id)
    }

    if (options?.before?.configurable?.checkpoint_id) {
      const beforeId = options.before.configurable.checkpoint_id
      const idx = records.findIndex((r) => r.checkpoint_id === beforeId)
      if (idx !== -1) {
        records = records.slice(0, idx)
      }
    }

    const reversed = [...records].reverse()

    let count = 0
    for (const record of reversed) {
      if (options?.limit && count >= options.limit) break

      if (options?.filter) {
        let match = true
        for (const [k, v] of Object.entries(options.filter)) {
          if (record.metadata[k] !== v) {
            match = false
            break
          }
        }
        if (!match) continue
      }

      const channel_values: Record<string, unknown> = {}
      const channelVersions = (
        record.checkpoint as { channel_versions?: Record<string, string | number> }
      ).channel_versions
      if (channelVersions) {
        for (const [channel, version] of Object.entries(channelVersions)) {
          const blobKey = `${thread_id}:${channel}:${version}`
          const blobRecord = await this.store.getBlob(blobKey)
          if (blobRecord) {
            channel_values[channel] = blobRecord.blob
          }
        }
      }

      const finalCheckpoint = toCheckpoint(record.checkpoint, channel_values)

      yield {
        config: {
          configurable: {
            thread_id,
            checkpoint_ns: record.checkpoint_ns,
            checkpoint_id: record.checkpoint_id
          }
        },
        checkpoint: finalCheckpoint,
        metadata: toCheckpointMetadata(record.metadata),
        parentConfig: record.parent_checkpoint_id
          ? {
              configurable: {
                thread_id,
                checkpoint_ns: record.checkpoint_ns,
                checkpoint_id: record.parent_checkpoint_id
              }
            }
          : undefined,
        pendingWrites: []
      }

      count++
    }
  }

  async put(
    config: {
      configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
    },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: Record<string, string | number>,
    preCalculatedBlobs?: Record<string, unknown>
  ): Promise<{
    configurable: { thread_id: string; checkpoint_ns: string; checkpoint_id: string }
  }> {
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns || ''

    if (!thread_id) throw new Error('Missing thread_id in config')

    const { channel_values, ...lightweightCheckpoint } = checkpoint

    const record: CheckpointRecord = {
      thread_id,
      checkpoint_ns,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: config.configurable?.checkpoint_id,
      checkpoint: lightweightCheckpoint,
      metadata
    }

    if (channel_values && newVersions) {
      for (const [channel, version] of Object.entries(newVersions)) {
        const val = channel_values[channel]
        const blobKey = `${thread_id}:${channel}:${version}`

        const existingBlob = await this.store.getBlob(blobKey)
        if (!existingBlob) {
          let blobRecord: CheckpointBlobRecord

          const pre = preCalculatedBlobs ? preCalculatedBlobs[channel] : undefined
          if (isPreCalculatedBlob(pre)) {
            blobRecord = {
              thread_id,
              checkpoint_ns,
              channel,
              version: String(version),
              type: pre.type,
              blob: pre.blob,
              serialized: pre.serialized
            }
          } else {
            let blobType = 'empty'
            let blobData: unknown = null
            let serialized = false

            if (val !== undefined) {
              try {
                const [type, serializedValue] = await this.serde.dumpsTyped(val)
                blobType = type
                blobData = new TextDecoder().decode(serializedValue)
                serialized = true
              } catch (e) {
                console.error(`[FileSystemSaver] Failed to serialize blob for ${channel}:`, e)
                throw e
              }
            }

            blobRecord = {
              thread_id,
              checkpoint_ns,
              channel,
              version: String(version),
              type: blobType,
              blob: blobData,
              serialized
            }
          }
          if (this.store instanceof SqliteCheckpointStore) {
            await this.store.putBlob(blobKey, blobRecord)
          } else if ('putBlob' in this.store) {
            if (this.store.putBlob.length >= 2) {
              await (this.store as CheckpointStore).putBlob(blobKey, blobRecord)
            } else {
              await (this.store as ICheckpointStore).putBlob(blobRecord)
            }
          }
        }
      }
    }

    await this.store.putCheckpoint(record)

    if (await this.getRestoreHead(thread_id, checkpoint_ns)) {
      await this.setRestoreHead(thread_id, checkpoint.id, checkpoint_ns)
    }

    if (hasPruneWrites(this.store)) {
      await this.store.pruneWrites(thread_id, SQLITE_ENGINE_CONFIG.maxWriteRetentionTurns)
    }

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id
      }
    }
  }

  async putWrites(
    config: {
      configurable?: { thread_id?: string; checkpoint_ns?: string; checkpoint_id?: string }
    },
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const thread_id = config.configurable?.thread_id
    const checkpoint_ns = config.configurable?.checkpoint_ns || ''
    const checkpoint_id = config.configurable?.checkpoint_id

    if (!thread_id || !checkpoint_id) return

    const newWrites: CheckpointWriteRecord[] = writes.map((w, idx) => {
      const [channel, value] = w
      return {
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        task_id: taskId,
        idx,
        channel,
        type: 'json',
        blob: value
      }
    })

    if (this.store instanceof SqliteCheckpointStore) {
      await this.store.putWrites(thread_id, newWrites)
    } else if ('putWrites' in this.store) {
      if (this.store.putWrites.length >= 2) {
        await (this.store as CheckpointStore).putWrites(thread_id, newWrites)
      } else {
        await (this.store as ICheckpointStore).putWrites(newWrites)
      }
    }
  }
}
