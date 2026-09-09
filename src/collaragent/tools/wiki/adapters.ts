import crypto from 'node:crypto'
import WebSocket from 'ws'
import type { DocumentPayload } from '@workspace/persistence/editorContent'
import { type GraphCanvasDTO, GraphCanvasDTOSchema } from '@workspace/persistence/graphCanvasDto'
import { CanvasDiffEngine } from '@collaragent/runtime'
import { connectToCanvas } from '@workspace/sync/ClientConnection'
import { getGraphPayload } from '@workspace/wstools/getGraphPayload'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import {
  DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
  DEFAULT_RELATIONAL_LEDGER_NAME,
  DEFAULT_RELATIONAL_LEDGER_TYPE
} from '@shared/constants'
import {
  type WikiWorkspaceAdapter,
  type WikiAdapterReadOptions,
  MemoryWikiWorkspaceAdapter
} from '@workspace/wiki/adapter'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeWriteDocument } from '@workspace/wstools/manageDocument'
import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { createInstance } from '@workspace/wstools/createDocumentInstance'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { ToolConnectionContext } from '../WorkspaceTools'

export type { WikiWorkspaceAdapter, WikiAdapterReadOptions }
export { MemoryWikiWorkspaceAdapter }

/**
 * Live workspace adapter communicating with the Electron file server / WebSocket.
 */
export class LiveWikiWorkspaceAdapter implements WikiWorkspaceAdapter {
  private readonly ledgerStore: RelationalLedgerStore

  constructor(
    private readonly context?: ToolConnectionContext,
    ledgerStore?: RelationalLedgerStore
  ) {
    this.ledgerStore = ledgerStore ?? context?.ledgerStore ?? new RelationalLedgerStore()
  }

  /**
   * Resolves the cancellation / timeout AbortSignal:
   * - If an explicit overrideSignal or caller context.signal is provided, it is propagated.
   * - If context.timeoutMs is specified, a timeout deadline is applied or linked with the caller signal.
   * - Eliminates hardcoded magic constants from transport calls.
   */
  private resolveSignal(
    overrideSignal?: AbortSignal,
    overrideTimeoutMs?: number
  ): AbortSignal | undefined {
    const parentSignal = overrideSignal ?? this.context?.signal
    const timeoutMs = overrideTimeoutMs ?? this.context?.timeoutMs

    if (parentSignal && timeoutMs !== undefined) {
      return AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)])
    }
    if (parentSignal) return parentSignal
    if (timeoutMs !== undefined) return AbortSignal.timeout(timeoutMs)

    return undefined
  }

  /**
   * Transactional read barrier: flushes in-flight writes to disk before read.
   * If context.wsHandle is available, delegates directly to in-memory wsHandle.flush().
   * If wsPort is available, connects over WebSocket and issues transactional flush.
   */
  async flush(instanceId?: string, options?: WikiAdapterReadOptions): Promise<void> {
    if (this.context?.wsHandle?.flush) {
      await this.context.wsHandle.flush(instanceId, {
        signal: this.resolveSignal(options?.signal, options?.timeoutMs),
        timeoutMs: options?.timeoutMs ?? this.context?.timeoutMs
      })
      return
    }

    if (this.context?.wsPort) {
      const port = this.context.wsPort
      const url = `ws://127.0.0.1:${port}`
      const signal = this.resolveSignal(options?.signal, options?.timeoutMs)
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Operation aborted')
      }

      const flushId = crypto.randomUUID()

      await new Promise<void>((resolve, reject) => {
        let isSettled = false
        const ws = new WebSocket(url)

        const cleanup = () => {
          if (signal) {
            signal.removeEventListener('abort', onAbort)
          }
          ws.removeAllListeners()
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
        }

        const settleResolve = () => {
          if (!isSettled) {
            isSettled = true
            cleanup()
            resolve()
          }
        }

        const settleReject = (err: unknown) => {
          if (!isSettled) {
            isSettled = true
            cleanup()
            reject(err)
          }
        }

        const onAbort = () => {
          settleReject(signal?.reason ?? new Error('Operation aborted'))
        }

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true })
        }

        ws.on('open', () => {
          const msg = JSON.stringify({
            type: 'flush',
            ...(instanceId ? { instanceId } : {}),
            flushId
          })
          ws.send(msg)
        })

        ws.on('message', (data: WebSocket.RawData) => {
          try {
            const raw = typeof data === 'string' ? data : data.toString()
            const parsed = JSON.parse(raw) as { type?: string; flushId?: string; message?: string }
            if (parsed.type === 'flush-ack' && parsed.flushId === flushId) {
              settleResolve()
            } else if (parsed.type === 'error' && (parsed.flushId === flushId || !parsed.flushId)) {
              settleReject(new Error(parsed.message ?? 'WebSocket error during flush'))
            }
          } catch {
            // Ignore non-JSON or other message types
          }
        })

        ws.on('error', (err) => {
          settleReject(err)
        })

        ws.on('close', (code, reason) => {
          if (!isSettled) {
            settleReject(
              new Error(
                `WebSocket closed before flush-ack (code: ${code}, reason: ${reason.toString()})`
              )
            )
          }
        })
      })
      return
    }
  }

  async listDocuments(
    options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>> {
    try {
      const list = await listDocumentInstances({
        apiPort: this.context?.apiPort,
        timeoutMs: options?.timeoutMs ?? this.context?.timeoutMs
      })
      return list.instances
        .filter((i) => i.type === 'document')
        .map((i) => ({ name: i.name || i.instanceId, instanceId: i.instanceId }))
    } catch (err: unknown) {
      console.warn('[LiveWikiWorkspaceAdapter] Failed to list documents:', err)
      return []
    }
  }

  async getDocument(
    name: string,
    options?: WikiAdapterReadOptions
  ): Promise<DocumentPayload | null> {
    try {
      const list = await listDocumentInstances({
        apiPort: this.context?.apiPort,
        timeoutMs: options?.timeoutMs ?? this.context?.timeoutMs
      })
      const match = list.instances.find(
        (i) => (i.name === name || i.instanceId === name) && i.type === 'document'
      )
      if (!match) return null

      if (options?.flushBeforeRead ?? this.context?.flushBeforeRead) {
        await this.flush(match.instanceId, options)
      }

      const res = await getDocumentPayload({
        instanceId: match.instanceId,
        port: this.context?.wsPort
      })
      return res.payload
    } catch (err: unknown) {
      console.warn(`[LiveWikiWorkspaceAdapter] Failed to get document "${name}":`, err)
      return null
    }
  }

  async saveDocument(
    name: string,
    payload: DocumentPayload,
    _options?: { signal?: AbortSignal }
  ): Promise<void> {
    const list = await listDocumentInstances({
      apiPort: this.context?.apiPort,
      timeoutMs: this.context?.timeoutMs
    })
    let match = list.instances.find(
      (i) => (i.name === name || i.instanceId === name) && i.type === 'document'
    )

    let targetInstanceId: string
    if (!match) {
      const defaultProject = list.projects[0]
      targetInstanceId = await createInstance({
        name,
        projectId: defaultProject?.id ?? 'default',
        type: 'document',
        apiPort: this.context?.apiPort
      })
    } else {
      targetInstanceId = match.instanceId
    }

    await executeWriteDocument({
      instanceId: targetInstanceId,
      payload,
      wsPort: this.context?.wsPort,
      threadId: this.context?.thread_id || this.context?.threadId,
      staged: false
    })
  }

  async listCanvases(
    options?: WikiAdapterReadOptions
  ): Promise<Array<{ name: string; instanceId: string }>> {
    try {
      const list = await listDocumentInstances({
        apiPort: this.context?.apiPort,
        timeoutMs: options?.timeoutMs ?? this.context?.timeoutMs
      })
      return list.instances
        .filter((i) => i.type === 'canvas')
        .map((i) => ({ name: i.name || i.instanceId, instanceId: i.instanceId }))
    } catch (err: unknown) {
      console.warn('[LiveWikiWorkspaceAdapter] Failed to list canvases:', err)
      return []
    }
  }

  async getCanvas(name?: string, options?: WikiAdapterReadOptions): Promise<GraphCanvasDTO | null> {
    try {
      const list = await listDocumentInstances({
        apiPort: this.context?.apiPort,
        timeoutMs: options?.timeoutMs ?? this.context?.timeoutMs
      })
      const match = list.instances.find(
        (i) => (name ? i.name === name || i.instanceId === name : true) && i.type === 'canvas'
      )
      if (!match) return null

      if (options?.flushBeforeRead ?? this.context?.flushBeforeRead) {
        await this.flush(match.instanceId, options)
      }

      if (this.context?.wsPort) {
        const res = await getGraphPayload({
          instanceId: match.instanceId,
          port: this.context.wsPort
        })
        return res.payload
      }

      const apiPort =
        this.context?.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined)
      if (apiPort) {
        const res = await fetch(`http://127.0.0.1:${apiPort}/api/instances/${match.instanceId}`, {
          signal: this.resolveSignal(options?.signal, options?.timeoutMs)
        })
        if (res.ok) {
          const data = (await res.json()) as { payload?: unknown; content?: unknown }
          const parsed = GraphCanvasDTOSchema.safeParse(data.payload ?? data.content)
          if (parsed.success) return parsed.data
        }
      }
      return null
    } catch (err: unknown) {
      console.warn(`[LiveWikiWorkspaceAdapter] Failed to get canvas "${name ?? 'default'}":`, err)
      return null
    }
  }

  async saveCanvas(
    name: string,
    payload: GraphCanvasDTO,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const list = await listDocumentInstances({
      apiPort: this.context?.apiPort,
      timeoutMs: this.context?.timeoutMs
    })
    const match = list.instances.find(
      (i) => (i.name === name || i.instanceId === name) && i.type === 'canvas'
    )

    let targetInstanceId: string
    if (!match) {
      const defaultProject = list.projects[0]
      targetInstanceId = await createInstance({
        name,
        projectId: defaultProject?.id ?? 'default',
        type: 'canvas',
        apiPort: this.context?.apiPort
      })
    } else {
      targetInstanceId = match.instanceId
    }

    if (this.context?.wsPort) {
      const client = await connectToCanvas(targetInstanceId, { port: this.context.wsPort })
      try {
        const currentSnapshot = client.getSnapshot()
        const commands = CanvasDiffEngine.computeDiffFromDto(currentSnapshot, payload)
        if (commands.length > 0) {
          await client.sendBatch(
            commands.map((cmd) => ({ ...cmd, staged: false })),
            { threadId: this.context?.thread_id || this.context?.threadId }
          )
        }
      } finally {
        client.disconnect()
      }
    } else if (this.context?.apiPort) {
      const res = await fetch(
        `http://127.0.0.1:${this.context.apiPort}/api/instances/${targetInstanceId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload }),
          signal: this.resolveSignal(options?.signal)
        }
      )
      if (!res.ok) {
        throw new WorkspaceError(
          WorkspaceErrorCode.WORKSPACE_GRAPH_SNAPSHOT_FAILED,
          `Failed to save canvas instance ${targetInstanceId}: ${res.statusText}`,
          { details: { instanceId: targetInstanceId, status: res.status } }
        )
      }
    }

    return targetInstanceId
  }

  async loadLedger(options?: WikiAdapterReadOptions): Promise<RelationalLedgerStore> {
    if (options?.flushBeforeRead ?? this.context?.flushBeforeRead) {
      await this.flush(DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID, options)
    }

    const apiPort =
      this.context?.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined)
    if (apiPort) {
      try {
        const res = await fetch(
          `http://127.0.0.1:${apiPort}/api/instances/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`,
          {
            signal: this.resolveSignal(options?.signal, options?.timeoutMs)
          }
        )
        if (res.ok) {
          const data = (await res.json()) as {
            payload?: { edges?: unknown }
            content?: { edges?: unknown }
          }
          const edges = data.payload?.edges ?? data.content?.edges
          if (Array.isArray(edges)) {
            this.ledgerStore.loadFromSnapshot(edges)
          }
        }
      } catch (err: unknown) {
        console.warn('[LiveWikiWorkspaceAdapter] Failed to load ledger from API:', err)
      }
    }
    return this.ledgerStore
  }

  async saveLedger(store?: RelationalLedgerStore): Promise<void> {
    const activeStore = store ?? this.ledgerStore
    const edges = activeStore.getAllEdges()
    const apiPort =
      this.context?.apiPort || (process.env.API_PORT ? Number(process.env.API_PORT) : undefined)
    if (apiPort) {
      try {
        const res = await fetch(
          `http://127.0.0.1:${apiPort}/api/instances/${DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { edges } }),
            signal: this.resolveSignal()
          }
        )
        if (!res.ok) {
          await fetch(`http://127.0.0.1:${apiPort}/api/instances`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID,
              name: DEFAULT_RELATIONAL_LEDGER_NAME,
              projectId: 'default',
              type: DEFAULT_RELATIONAL_LEDGER_TYPE,
              payload: { edges },
              metadata: { isHidden: true, isSystem: true }
            }),
            signal: this.resolveSignal()
          })
        }
      } catch (err: unknown) {
        console.warn('[LiveWikiWorkspaceAdapter] Failed to save ledger to API:', err)
      }
    }
  }

  getLedgerStore(): RelationalLedgerStore {
    return this.ledgerStore
  }
}
