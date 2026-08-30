type SyncPauseListener = (paused: boolean) => void;

const listeners = new Set<SyncPauseListener>();
let paused = false;

export function isSyncPaused(): boolean {
  return paused;
}

export function setSyncPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  listeners.forEach((listener) => listener(paused));
}

export function subscribeSyncPause(listener: SyncPauseListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
