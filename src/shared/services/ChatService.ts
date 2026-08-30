let _apiPort: number | null = null;

export function setApiPort(port: number | null) {
  _apiPort = port;
}

export function getApiPort(): number | null {
  if (_apiPort) return _apiPort;
  // Try window-level injection (preload)
  try {
    // @ts-ignore
    const p = (window as any).projectSession?.apiPort;
    if (p) return Number(p);
  } catch (e) {}
  return null;
}

async function doFetch(path: string, opts: RequestInit = {}) {
  const port = getApiPort();
  if (!port) {
    console.warn('[ChatService] No apiPort available');
    throw new Error('No apiPort available');
  }
  const url = `http://localhost:${port}${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export async function getSessions(): Promise<Array<{ id: string; title: string; updatedAt: number; messageCount: number }>> {
  try {
    const json = await doFetch('/api/chat/sessions');
    return json.sessions || [];
  } catch (err) {
    console.warn('[ChatService] getSessions failed', err);
    return [];
  }
}

export async function getMessages(sessionId: string): Promise<any[]> {
  try {
    const json = await doFetch(`/api/chat/sessions/${sessionId}`);
    return json.messages || json;
  } catch (err) {
    console.warn('[ChatService] getMessages failed', err);
    return [];
  }
}

export async function postMessage(
  sessionId: string,
  message: {
    id?: string;
    role: string;
    content: string;
    toolCalls?: any[];
    blocks?: any[];
    actions?: any[];
    usage?: any;
    timestamp?: number;
    metadata?: Record<string, any>;
  }
) {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    return true;
  } catch (err) {
    console.warn('[ChatService] postMessage failed', err);
    return false;
  }
}

export async function deleteSession(sessionId: string) {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    console.warn('[ChatService] deleteSession failed', err);
    return false;
  }
}

export async function restoreSession(sessionId: string, messageId: string, blockIndex?: number) {
  try {
    await doFetch(`/api/chat/sessions/${sessionId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, blockIndex })
    });
    return true;
  } catch (err) {
    console.warn('[ChatService] restoreSession failed', err);
    return false;
  }
}

export default { setApiPort, getApiPort, getSessions, getMessages, postMessage, deleteSession, restoreSession };
