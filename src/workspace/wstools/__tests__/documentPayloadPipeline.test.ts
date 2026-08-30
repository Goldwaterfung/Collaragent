import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { listDocumentInstances } from '../listDocumentInstances';
import { SyncClient } from '../../sync/SyncClient';
import { convertBlocksToPatchView } from '../../editor/schemas/htmlContentConversion';
import type { Block } from '@workspace/persistence/editorContent';

describe('Document Payload Pipeline & Identity Tests', () => {
  describe('listDocumentInstances REST Response Handling', () => {
    it('correctly parses object envelope { instances: [...] } from REST API', async () => {
      const mockInstancesPayload = {
        instances: [
          {
            id: 'doc-uuid-1',
            name: 'Architecture Spec',
            projectId: 'proj-1',
            type: 'document',
            updatedAt: '2026-08-30T12:00:00.000Z'
          },
          {
            id: 'canvas-uuid-2',
            name: 'System Canvas',
            projectId: 'proj-1',
            type: 'canvas',
            updatedAt: '2026-08-30T12:00:00.000Z'
          }
        ]
      };

      const mockProjectsPayload = {
        projects: [
          {
            id: 'proj-1',
            name: 'Core Project',
            createdAt: '2026-08-30T12:00:00.000Z',
            updatedAt: '2026-08-30T12:00:00.000Z'
          }
        ]
      };

      // Mock http.request to simulate REST API responses
      vi.spyOn(http, 'request').mockImplementation((options: unknown, callback?: unknown) => {
        const reqOptions = options as http.RequestOptions;
        const cb = callback as ((res: http.IncomingMessage) => void) | undefined;
        const path = reqOptions.path;
        const res = new (require('events').EventEmitter)();
        (res as unknown as { statusCode: number }).statusCode = 200;

        process.nextTick(() => {
          if (cb) cb(res as unknown as http.IncomingMessage);
          if (path === '/api/instances') {
            res.emit('data', JSON.stringify(mockInstancesPayload));
          } else if (path === '/api/projects') {
            res.emit('data', JSON.stringify(mockProjectsPayload));
          }
          res.emit('end');
        });

        const req = new (require('events').EventEmitter)();
        (req as unknown as { write: unknown; end: unknown }).write = vi.fn();
        (req as unknown as { write: unknown; end: unknown }).end = vi.fn();
        return req as unknown as http.ClientRequest;
      });

      const result = await listDocumentInstances({ apiPort: 4567 });

      expect(result.instances).toHaveLength(2);
      expect(result.instances[0].instanceId).toBe('doc-uuid-1');
      expect(result.instances[0].name).toBe('Architecture Spec');
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('Core Project');

      vi.restoreAllMocks();
    });

    it('rejects with error when REST API returns invalid schema', async () => {
      vi.spyOn(http, 'request').mockImplementation((_options: unknown, callback?: unknown) => {
        const cb = callback as ((res: http.IncomingMessage) => void) | undefined;
        const res = new (require('events').EventEmitter)();
        (res as unknown as { statusCode: number }).statusCode = 200;

        process.nextTick(() => {
          if (cb) cb(res as unknown as http.IncomingMessage);
          res.emit('data', JSON.stringify({ invalidField: "corrupted" }));
          res.emit('end');
        });

        const req = new (require('events').EventEmitter)();
        (req as unknown as { write: unknown; end: unknown }).write = vi.fn();
        (req as unknown as { write: unknown; end: unknown }).end = vi.fn();
        return req as unknown as http.ClientRequest;
      });

      await expect(listDocumentInstances({ apiPort: 4567 })).rejects.toThrow(
        'Invalid /api/instances schema'
      );

      vi.restoreAllMocks();
    });
  });

  describe('SyncClient Error Handling & Determinism', () => {
    it('rejects readyPromise immediately when receiving an error message', async () => {
      const client = new SyncClient({ host: 'localhost:9999' });

      // Simulate connection and message dispatch
      const wsMessage = {
        type: 'error' as const,
        code: 'WORKSPACE_INSTANCE_NOT_FOUND',
        message: 'Instance "non-existent" could not be found'
      };

      // Dispatch error message via onMessage handler or message listener
      client.onMessage(() => {});
      (client as unknown as { handleMessage: (msg: typeof wsMessage) => void }).handleMessage(wsMessage);

      await expect(client.waitForReady()).rejects.toThrow(
        '[WORKSPACE_INSTANCE_NOT_FOUND] Instance "non-existent" could not be found'
      );
    });

    it('resolves readyPromise and populates snapshot on sync-snapshot', async () => {
      const client = new SyncClient<{ type: string }, { blocks: Block[] }>({ host: 'localhost:9999' });

      const snapshotMsg = {
        type: 'sync-snapshot' as const,
        version: 1,
        blocks: [
          {
            id: 'block-1',
            type: 'paragraph' as const,
            children: [{ text: 'Hello Collaragent' }]
          }
        ]
      };

      (client as unknown as { handleMessage: (msg: typeof snapshotMsg) => void }).handleMessage(snapshotMsg);

      await expect(client.waitForReady()).resolves.toBeUndefined();
      const snapshot = client.getSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot?.blocks).toHaveLength(1);
      expect(snapshot?.blocks[0].id).toBe('block-1');
    });
  });

  describe('Block Identity and Patch View Conversion', () => {
    it('converts blocks to patch view while preserving stable block IDs', () => {
      const blocks: Block[] = [
        {
          id: 'heading-1',
          type: 'h1',
          children: [{ text: 'Document Title' }]
        },
        {
          id: 'p-2',
          type: 'paragraph',
          children: [{ text: 'Paragraph body.' }]
        }
      ];

      const patchView = convertBlocksToPatchView(blocks);
      expect(patchView).toBe(
        '<h1 data-block-id="heading-1">Document Title</h1>\n<p data-block-id="p-2">Paragraph body.</p>'
      );
    });
  });
});
