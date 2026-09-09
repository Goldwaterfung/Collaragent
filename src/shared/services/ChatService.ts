let _apiPort: number | null = null

export function setApiPort(port: number | null): void {
  _apiPort = port
}

export function getApiPort(): number | null {
  if (_apiPort) return _apiPort
  // Try window-level injection (preload)
  try {
    if (typeof window !== 'undefined') {
      const win = window as unknown as { projectSession?: { apiPort?: unknown } }
      const p = win.projectSession?.apiPort
      if (p) return Number(p)
    }
  } catch {
    // Ignore error
  }
  return null
}

async function doFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const port = getApiPort()
  if (!port) {
    console.warn('[ChatService] No apiPort available')
    throw new Error('No apiPort available')
  }
  const url = `http://localhost:${port}${path}`
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as T
}

export async function getSessions(): Promise<
  Array<{ id: string; title: string; updatedAt: number; messageCount: number }>
> {
  try {
    const json = await doFetch<{
      sessions?: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>
    }>('/api/chat/sessions')
    return json.sessions || []
  } catch (err) {
    console.warn('[ChatService] getSessions failed', err)
    return []
  }
}

export async function getMessages(sessionId: string): Promise<unknown[]> {
  try {
    const json = await doFetch<{ messages?: unknown[] } | unknown[]>(
      `/api/chat/sessions/${sessionId}`
    )
    if (Array.isArray(json)) return json
    if (json && typeof json === 'object' && 'messages' in json && Array.isArray(json.messages)) {
      return json.messages
    }
    return []
  } catch (err) {
    console.warn('[ChatService] getMessages failed', err)
    return []
  }
}

export async function postMessage(
  sessionId: string,
  message: {
    id?: string
    role: string
    content: string
    toolCalls?: unknown[]
    blocks?: unknown[]
    actions?: unknown[]
    usage?: unknown
    timestamp?: number
    metadata?: Record<string, unknown>
    parentMessageId?: string | null
    checkpointId?: string | null
    branchId?: string | null
  }
): Promise<boolean> {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })
    return true
  } catch (err) {
    console.warn('[ChatService] postMessage failed', err)
    return false
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' })
    return true
  } catch (err) {
    console.warn('[ChatService] deleteSession failed', err)
    return false
  }
}

export async function restoreSession(
  sessionId: string,
  messageId: string,
  blockIndex?: number
): Promise<boolean> {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, blockIndex })
    })
    return true
  } catch (err) {
    console.warn('[ChatService] restoreSession failed', err)
    return false
  }
}

export async function switchBranch(
  sessionId: string,
  messageId: string,
  checkpointId?: string
): Promise<boolean> {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, checkpointId })
    })
    return true
  } catch (err) {
    console.warn('[ChatService] switchBranch failed', err)
    return false
  }
}

export async function getBranches(sessionId: string, messageId: string): Promise<unknown[]> {
  try {
    const res = await doFetch<{ children?: unknown[] }>(
      `/api/chat/sessions/${sessionId}/branches/${messageId}`
    )
    return res.children || []
  } catch (err) {
    console.warn('[ChatService] getBranches failed', err)
    return []
  }
}

export default {
  setApiPort,
  getApiPort,
  getSessions,
  getMessages,
  postMessage,
  deleteSession,
  restoreSession,
  switchBranch,
  getBranches
}
