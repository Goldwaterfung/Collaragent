import { randomUUID } from 'node:crypto'

async function getFetch(): Promise<typeof fetch> {
  const g = globalThis as unknown as { fetch?: typeof fetch }
  if (typeof g.fetch === 'function') return g.fetch
  // dynamic import of node-fetch for older node versions
  try {
    const nf = (await import('node-fetch')) as unknown as { default?: typeof fetch }
    if (typeof nf.default === 'function') return nf.default
    throw new Error('No default fetch export found')
  } catch {
    throw new Error('No fetch available in this runtime')
  }
}

export async function saveMessageToProject(
  apiPort: number | undefined | null,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  toolCalls?: unknown[],
  blocks?: unknown[],
  actions?: unknown[],
  usage?: unknown,
  messageId?: string,
  metadata?: Record<string, unknown>,
  parentMessageId?: string | null,
  checkpointId?: string | null,
  branchId?: string | null
): Promise<boolean> {
  if (!apiPort) return false
  const fetchFn = await getFetch()
  const url = `http://localhost:${apiPort}/api/chat/sessions/${sessionId}/messages`
  const body = {
    id: messageId || randomUUID(),
    role,
    content,
    toolCalls: toolCalls || [],
    blocks: blocks || [],
    actions: actions || [],
    usage,
    timestamp: Date.now(),
    metadata: metadata || {},
    parentMessageId: parentMessageId ?? undefined,
    checkpointId: checkpointId ?? undefined,
    branchId: branchId ?? undefined
  }

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return res.ok
  } catch (err) {
    console.warn('[chatPersistence] Failed to POST message to project API:', err)
    return false
  }
}

export async function getSessionDetailFromProject(
  apiPort: number | undefined | null,
  sessionId: string
): Promise<{ activeMessageId?: string | null; activeCheckpointId?: string | null } | null> {
  if (!apiPort) return null
  const fetchFn = await getFetch()
  const url = `http://localhost:${apiPort}/api/chat/sessions/${sessionId}`
  try {
    const res = await fetchFn(url)
    if (!res.ok) return null
    const json = (await res.json()) as unknown
    if (json && typeof json === 'object') {
      const rec = json as Record<string, unknown>
      return {
        activeMessageId: typeof rec.activeMessageId === 'string' ? rec.activeMessageId : null,
        activeCheckpointId:
          typeof rec.activeCheckpointId === 'string' ? rec.activeCheckpointId : null
      }
    }
    return null
  } catch (err) {
    console.warn('[chatPersistence] Failed to get session detail via project API:', err)
    return null
  }
}

export async function deleteSessionFromProject(
  apiPort: number | undefined | null,
  sessionId: string
): Promise<boolean> {
  if (!apiPort) return false
  const fetchFn = await getFetch()
  const url = `http://localhost:${apiPort}/api/chat/sessions/${sessionId}`
  try {
    const res = await fetchFn(url, { method: 'DELETE' })
    return res.ok
  } catch (err) {
    console.warn('[chatPersistence] Failed to DELETE session via project API:', err)
    return false
  }
}

export async function listSessionsFromProject(
  apiPort: number | undefined | null
): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
  if (!apiPort) return []
  const fetchFn = await getFetch()
  const url = `http://localhost:${apiPort}/api/chat/sessions`
  try {
    const res = await fetchFn(url)
    if (!res.ok) return []
    const json = (await res.json()) as unknown
    if (
      json &&
      typeof json === 'object' &&
      'sessions' in json &&
      Array.isArray((json as { sessions: unknown }).sessions)
    ) {
      return (json as { sessions: Array<{ id: string; title: string; updatedAt: number }> })
        .sessions
    }
    return []
  } catch (err) {
    console.warn('[chatPersistence] Failed to list sessions via project API:', err)
    return []
  }
}

export default {}
