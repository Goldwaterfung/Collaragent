import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto';
import type { HierarchicalLeidenOptions, HierarchicalLeidenResult } from './types';
import type { LeidenProgressEvent } from './index';

type WorkerRunRequest = {
  type: 'run';
  requestId: string;
  dto: GraphCanvasDTO;
  options?: HierarchicalLeidenOptions;
};

type WorkerRunResponse =
  | {
      type: 'progress';
      requestId: string;
      event: LeidenProgressEvent;
    }
  | {
      type: 'result';
      requestId: string;
      ok: true;
      result: HierarchicalLeidenResult;
    }
  | {
      type: 'result';
      requestId: string;
      ok: false;
      error: { message: string; name?: string; stack?: string };
    };

export async function runHierarchicalLeidenOnDtoInWorker(
  dto: GraphCanvasDTO,
  options: HierarchicalLeidenOptions = {},
  workerOptions: { signal?: AbortSignal; onProgress?: (ev: LeidenProgressEvent) => void } = {},
): Promise<HierarchicalLeidenResult> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const worker = new Worker(new URL('./leiden.worker.ts', import.meta.url), {
    type: 'module',
  });

  const abortSignal = workerOptions.signal;

  return await new Promise<HierarchicalLeidenResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      abortSignal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Leiden worker aborted', 'AbortError'));
    };

    const onError = (ev: ErrorEvent) => {
      cleanup();
      reject(ev.error ?? new Error(ev.message));
    };

    const onMessage = (ev: MessageEvent<WorkerRunResponse>) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'result' || msg.requestId !== requestId) return;

      if (msg.ok) {
        cleanup();
        resolve(msg.result);
      } else {
        cleanup();
        const e = new Error(msg.error.message);
        e.name = msg.error.name ?? 'WorkerError';
        (e as any).stack = msg.error.stack;
        reject(e);
      }
    };

    const onProgressMessage = (ev: MessageEvent<WorkerRunResponse>) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'progress' || msg.requestId !== requestId) return;
      workerOptions.onProgress?.(msg.event);
    };

    if (abortSignal?.aborted) {
      onAbort();
      return;
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onProgressMessage);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    const req: WorkerRunRequest = { type: 'run', requestId, dto, options };
    worker.postMessage(req);
  });
}
