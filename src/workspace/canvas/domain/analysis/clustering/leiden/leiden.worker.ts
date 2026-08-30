import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto';
import type { HierarchicalLeidenOptions, HierarchicalLeidenResult } from './types';
import type { LeidenProgressEvent } from './index';
import { runHierarchicalLeidenOnDto } from './index';

type RunRequest = {
  type: 'run';
  requestId: string;
  dto: GraphCanvasDTO;
  options?: HierarchicalLeidenOptions;
};

type RunResponse =
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

const ctx = self as any;

ctx.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'run') return;

  try {
    const result = await runHierarchicalLeidenOnDto(msg.dto, msg.options, {
      onProgress: (event) => {
        const p: RunResponse = { type: 'progress', requestId: msg.requestId, event };
        ctx.postMessage(p);
      },
    });
    const response: RunResponse = { type: 'result', requestId: msg.requestId, ok: true, result };
    ctx.postMessage(response);
  } catch (err: any) {
    const response: RunResponse = {
      type: 'result',
      requestId: msg.requestId,
      ok: false,
      error: {
        name: err?.name,
        message: String(err?.message ?? err),
        stack: err?.stack,
      },
    };
    ctx.postMessage(response);
  }
};
