import { randomUUID } from 'node:crypto';

async function getFetch(): Promise<typeof fetch> {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
  // dynamic import of node-fetch for older node versions
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nf = await import('node-fetch');
    return (nf as any).default;
  } catch (e) {
    throw new Error('No fetch available in this runtime');
  }
}

export async function saveMessageToProject(
  apiPort: number | undefined | null,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  toolCalls?: any[],
  blocks?: any[],
  actions?: any[],
  usage?: any,
  messageId?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  if (!apiPort) return false;
  const fetch = await getFetch();
  const url = `http://localhost:${apiPort}/api/chat/sessions/${sessionId}/messages`;
  const body = {
    id: messageId || randomUUID(),
    role,
    content,
    toolCalls: toolCalls || [],
    blocks: blocks || [],
    actions: actions || [],
    usage,
    timestamp: Date.now(),
    metadata: metadata || {}
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // short timeout via AbortController could be added if needed
    });
    return res.ok;
  } catch (err) {
    console.warn('[chatPersistence] Failed to POST message to project API:', err);
    return false;
  }
}

export async function deleteSessionFromProject(apiPort: number | undefined | null, sessionId: string): Promise<boolean> {
  if (!apiPort) return false;
  const fetch = await getFetch();
  const url = `http://localhost:${apiPort}/api/chat/sessions/${sessionId}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    return res.ok;
  } catch (err) {
    console.warn('[chatPersistence] Failed to DELETE session via project API:', err);
    return false;
  }
}

export async function listSessionsFromProject(apiPort: number | undefined | null) {
  if (!apiPort) return [];
  const fetch = await getFetch();
  const url = `http://localhost:${apiPort}/api/chat/sessions`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.sessions || [];
  } catch (err) {
    console.warn('[chatPersistence] Failed to list sessions via project API:', err);
    return [];
  }
}

export default {};
