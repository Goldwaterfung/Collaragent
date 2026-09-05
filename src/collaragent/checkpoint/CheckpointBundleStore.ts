import type { CheckpointBundle } from '@shared/checkpoints/types'

async function getFetch(): Promise<typeof fetch> {
  const globalScope = globalThis as unknown as { fetch?: typeof fetch }
  if (typeof globalScope.fetch === 'function') return globalScope.fetch
  try {
    const nf = (await import('node-fetch')) as unknown as { default: typeof fetch }
    return nf.default
  } catch (_e: unknown) {
    throw new Error('No fetch available in this runtime')
  }
}

export interface CheckpointBundleStore {
  createBundle(bundle: CheckpointBundle): Promise<CheckpointBundle>
  getBundle(bundleId: string): Promise<CheckpointBundle | undefined>
  listBundles(sessionId: string, threadId: string, projectId?: string): Promise<CheckpointBundle[]>
}

export class HttpCheckpointBundleStore implements CheckpointBundleStore {
  private baseUrl: string

  constructor(apiPort: number) {
    this.baseUrl = `http://localhost:${apiPort}/api/checkpoints`
  }

  async createBundle(bundle: CheckpointBundle): Promise<CheckpointBundle> {
    const fetch = await getFetch()
    const res = await fetch(`${this.baseUrl}/bundles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle)
    })

    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Failed to create checkpoint bundle: ${detail}`)
    }

    return (await res.json()) as CheckpointBundle
  }

  async getBundle(bundleId: string): Promise<CheckpointBundle | undefined> {
    const fetch = await getFetch()
    const res = await fetch(`${this.baseUrl}/bundles/${bundleId}`)
    if (res.status === 404) return undefined
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Failed to get checkpoint bundle: ${detail}`)
    }
    return (await res.json()) as CheckpointBundle
  }

  async listBundles(
    sessionId: string,
    threadId: string,
    projectId?: string
  ): Promise<CheckpointBundle[]> {
    const fetch = await getFetch()
    const params = new URLSearchParams({ sessionId, threadId })
    if (projectId) {
      params.set('projectId', projectId)
    }
    const res = await fetch(`${this.baseUrl}/bundles?${params.toString()}`)
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Failed to list checkpoint bundles: ${detail}`)
    }
    const payload = (await res.json()) as { bundles?: CheckpointBundle[] }
    return payload.bundles || []
  }
}
