import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'
import { unpack } from 'msgpackr'

import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { startFilesystemApi, type FilesystemApiHandle } from '../filesystemAPI'
import { startWsServer, type WsServerHandle } from '../../ws/ws-server'
import { applyWorkspaceCommands } from '@workspace/persistence/checkpointRestoreHelpers'
import { agentCheckpointRegistry } from '@collaragent/checkpoint'
import { executeWriteGraph } from '@workspace/wstools/manageGraph'
import { executeWriteDocument, executeDocumentCommands } from '@workspace/wstools/manageDocument'
import { createGraphPayload } from '@workspace/wstools/createGraphPayload'
import type { GraphCanvasDTO } from '@workspace/persistence/graphCanvasDto'
import type { DocumentPayload } from '@shared/schemas/instances'
import type { NodeId, RelationshipId } from '@workspace/canvas/domain'
import type { CheckpointBundle, WorkspaceCommandLogEntry } from '@shared/checkpoints/types'

describe('Checkpoint Lifecycle & Sound Foundation Verification', () => {
  let testDir: string
  let dbFilePath: string
  let db: SqliteDatabase
  let storage: SqliteStorageEngine

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-checkpoint-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'lifecycle.cagent')

    db = new SqliteDatabase(dbFilePath)
    storage = new SqliteStorageEngine(db, { cagentPath: dbFilePath })
  })

  afterEach(async () => {
    agentCheckpointRegistry.clear()
    await storage.close()
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore directory removal failure
    }
  })

  describe('1. CAS Blob Decoupling & Multi-Instance Deduplication', () => {
    it('shares the same workspace_blobs entry when multiple instances snapshot identical content', () => {
      const project = storage.createProject('CAS Project')
      const sharedPayload = {
        blocks: [
          { id: 'p1', type: 'paragraph', content: 'Identical document content across instances' }
        ]
      }

      const instA = storage.createInstance('document', {
        projectId: project.id,
        name: 'Document A',
        payload: sharedPayload
      })

      const instB = storage.createInstance('document', {
        projectId: project.id,
        name: 'Document B',
        payload: sharedPayload
      })

      const snapA = storage.createSnapshot({
        instanceId: instA.id,
        projectId: project.id,
        instanceType: 'document',
        snapshotPayload: sharedPayload
      })

      const snapB = storage.createSnapshot({
        instanceId: instB.id,
        projectId: project.id,
        instanceType: 'document',
        snapshotPayload: sharedPayload
      })

      // Both snapshots share the same hash
      expect(snapA.snapshotHash).toBe(snapB.snapshotHash)
      expect(snapA.blobHash).toBe(snapB.blobHash)

      // Only ONE row in workspace_blobs
      const blobCountRaw = db
        .prepare('SELECT COUNT(*) as count FROM workspace_blobs WHERE hash = ?')
        .get(snapA.snapshotHash) as { count: number }
      expect(blobCountRaw.count).toBe(1)

      // Both snapshot references exist
      const snapshotRows = db
        .prepare('SELECT id, instance_id, blob_hash FROM workspace_snapshots WHERE blob_hash = ?')
        .all(snapA.snapshotHash)
      expect(snapshotRows).toHaveLength(2)
    })

    it('preserves CAS blob and other instance snapshots when an instance is deleted (cascade deletion immunity)', async () => {
      const project = storage.createProject('Immunity Project')
      const sharedPayload = {
        blocks: [{ id: 'p1', type: 'paragraph', content: 'Immune content' }]
      }

      const instA = storage.createInstance('document', {
        projectId: project.id,
        name: 'Instance A',
        payload: sharedPayload
      })

      const instB = storage.createInstance('document', {
        projectId: project.id,
        name: 'Instance B',
        payload: sharedPayload
      })

      const snapA = storage.createSnapshot({
        instanceId: instA.id,
        projectId: project.id,
        instanceType: 'document',
        snapshotPayload: sharedPayload
      })

      const snapB = storage.createSnapshot({
        instanceId: instB.id,
        projectId: project.id,
        instanceType: 'document',
        snapshotPayload: sharedPayload
      })

      // Delete instance A
      storage.deleteInstance(instA.id)

      // Instance A snapshot row is gone
      const loadedSnapA = storage.getWorkspaceSnapshot(snapA.id)
      expect(loadedSnapA).toBeFalsy()

      // Instance B snapshot row is still present
      const loadedSnapB = storage.getWorkspaceSnapshot(snapB.id)
      expect(loadedSnapB).toBeTruthy()
      expect(loadedSnapB?.instanceId).toBe(instB.id)

      // Underlying CAS blob is still present in workspace_blobs
      const blob = storage.getBlob(snapA.snapshotHash)
      expect(blob).not.toBeNull()

      // Snapshot content can still be loaded for B
      const contentB = await storage.loadWorkspaceSnapshot(snapB.id)
      expect(contentB).not.toBeNull()
      expect(contentB).toEqual(sharedPayload)
    })
  })

  describe('2. Fail-Closed Snapshot Restoration', () => {
    it('fails loudly with 404/STORAGE_CHECKPOINT_NOT_FOUND if snapshot data is missing rather than wiping the document', async () => {
      const project = storage.createProject('Fail-Closed Project')
      const initialPayload = {
        blocks: [{ id: 'p1', type: 'paragraph', content: 'Pre-restore document data' }]
      }

      const inst = storage.createInstance('document', {
        projectId: project.id,
        name: 'Doc',
        payload: initialPayload
      })

      const apiHandle: FilesystemApiHandle = await startFilesystemApi({
        port: 0,
        filePath: dbFilePath,
        storageEngine: storage
      })
      const baseUrl = `http://127.0.0.1:${apiHandle.port}`

      try {
        // Create a bundle pointing to a non-existent snapshot
        const missingSnapshotBundleId = 'missing-snapshot-bundle'
        const bundle: CheckpointBundle = {
          id: missingSnapshotBundleId,
          createdAt: new Date().toISOString(),
          sessionId: 'session-1',
          threadId: 'thread-1',
          projectId: project.id,
          label: 'Corrupted Checkpoint',
          reason: 'test',
          chat: { messageId: '__start__' },
          instances: [
            {
              instanceId: inst.id,
              instanceType: 'document',
              projectId: project.id,
              snapshotId: 'non-existent-snapshot-id',
              targetCursor: { seq: 0 }
            }
          ]
        }

        // Save bundle to project bundles
        storage.saveProjectBundles([bundle], project.id)

        // Attempt restore via API
        const restoreRes = await fetch(`${baseUrl}/api/checkpoints/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId: missingSnapshotBundleId })
        })

        // Must fail with 404 / STORAGE_CHECKPOINT_NOT_FOUND
        expect(restoreRes.status).toBe(404)
        const errorJson = (await restoreRes.json()) as { error?: { code?: string } }
        expect(errorJson.error?.code).toBe('STORAGE_CHECKPOINT_NOT_FOUND')

        // CRITICAL INVARIANT: The instance was NOT wiped to null/empty!
        const liveContentBuf = storage.getInstanceContent(inst.id)
        expect(liveContentBuf).not.toBeNull()
        const livePayload = liveContentBuf ? unpack(liveContentBuf) : null
        expect(livePayload).toEqual(initialPayload)
      } finally {
        await apiHandle.close()
      }
    })
  })

  describe('3. DAG Lineage & Active Branch Parent Tracking', () => {
    it('correctly records and tracks effective bundle IDs across restore and branching', () => {
      const threadId = 'thread-dag-test'

      // Turn 1 creates Bundle 1
      agentCheckpointRegistry.setEffectiveBundleId(threadId, 'bundle-1')
      expect(agentCheckpointRegistry.getEffectiveBundleId(threadId)).toBe('bundle-1')

      // Turn 2 creates Bundle 2
      agentCheckpointRegistry.setEffectiveBundleId(threadId, 'bundle-2')
      expect(agentCheckpointRegistry.getEffectiveBundleId(threadId)).toBe('bundle-2')

      // Turn 3 creates Bundle 3
      agentCheckpointRegistry.setEffectiveBundleId(threadId, 'bundle-3')
      expect(agentCheckpointRegistry.getEffectiveBundleId(threadId)).toBe('bundle-3')

      // User restores Bundle 1 (time travel back to Turn 1)
      agentCheckpointRegistry.setEffectiveBundleId(threadId, 'bundle-1')
      expect(agentCheckpointRegistry.getEffectiveBundleId(threadId)).toBe('bundle-1')

      // When the next turn branches from the restored state, it branches from bundle-1, NOT bundle-3
      const activeParent = agentCheckpointRegistry.getEffectiveBundleId(threadId)
      expect(activeParent).toBe('bundle-1')

      // Turn 4 created on the branched path records parent as bundle-1
      const branchedBundleId = 'bundle-4-branched'
      agentCheckpointRegistry.setEffectiveBundleId(threadId, branchedBundleId)
      expect(agentCheckpointRegistry.getEffectiveBundleId(threadId)).toBe(branchedBundleId)
    })
  })

  describe('4. Graph Integrity Rollback & Relationship Cascade', () => {
    it('cascades deletion of relationships when a node is removed during rollback', () => {
      const nodeIdA = 'a0000000-0000-4000-8000-000000000001' as NodeId
      const nodeIdB = 'b0000000-0000-4000-8000-000000000002' as NodeId
      const relId = 'r0000000-0000-4000-8000-000000000001' as RelationshipId

      const initialCanvas: GraphCanvasDTO = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: {
          nodes: {
            [nodeIdA]: { id: nodeIdA, type: 'card', name: 'Node A', attrs: {} },
            [nodeIdB]: { id: nodeIdB, type: 'card', name: 'Node B', attrs: {} }
          },
          relationships: {
            [relId]: {
              id: relId,
              from: { nodeId: nodeIdA },
              to: { nodeId: nodeIdB },
              attrs: {}
            }
          }
        },
        layout: {
          layoutByNodeId: {
            [nodeIdA]: { x: 0, y: 0, width: 200, height: 100 },
            [nodeIdB]: { x: 300, y: 0, width: 200, height: 100 }
          }
        }
      }

      // Rollback command removes node A
      const undoEntries: WorkspaceCommandLogEntry[] = [
        {
          instanceId: 'canvas-1',
          instanceType: 'graph-canvas',
          projectId: 'p1',
          cursor: { seq: 1 },
          command: {
            type: 'graph:remove_node',
            nodeId: nodeIdA
          }
        }
      ]

      const restoredCanvas = applyWorkspaceCommands(
        initialCanvas,
        'graph-canvas',
        undoEntries
      ) as GraphCanvasDTO

      // Node A is removed
      expect(restoredCanvas.graph.nodes[nodeIdA]).toBeUndefined()
      expect(restoredCanvas.layout.layoutByNodeId[nodeIdA]).toBeUndefined()

      // Node B remains
      expect(restoredCanvas.graph.nodes[nodeIdB]).toBeDefined()

      // CRITICAL: Relationship between A and B was cascaded and deleted (no dangling edge!)
      expect(restoredCanvas.graph.relationships[relId]).toBeUndefined()
      expect(Object.keys(restoredCanvas.graph.relationships)).toHaveLength(0)
    })
  })

  describe('5. WebSocket Staged Proposal Persistence Isolation', () => {
    let wsServer: WsServerHandle
    let apiHandle: FilesystemApiHandle
    let wsUrl: string
    let baseUrl: string

    beforeEach(async () => {
      apiHandle = await startFilesystemApi({
        port: 0,
        filePath: dbFilePath,
        storageEngine: storage
      })
      baseUrl = `http://127.0.0.1:${apiHandle.port}`

      wsServer = await startWsServer({
        port: 0,
        apiBaseUrl: `${baseUrl}/api/instances`
      })
      apiHandle.setWsPort(wsServer.port)
      wsUrl = `ws://127.0.0.1:${wsServer.port}`
    })

    afterEach(async () => {
      await wsServer.close()
      await apiHandle.close()
    })

    it('does NOT persist staged commands to SQLite disk and reverts in-memory on rejection', async () => {
      const project = storage.createProject('Proposal Isolation Project')
      const baselinePayload: DocumentPayload = {
        blocks: [{ id: 'p1', type: 'paragraph', content: 'Baseline unpolluted text' }]
      }

      const instance = storage.createInstance('document', {
        projectId: project.id,
        name: 'Staged Doc',
        payload: baselinePayload
      })

      // Connect WebSocket client to /ws/editor/:id
      const ws = new WebSocket(`${wsUrl}/ws/editor/${instance.id}`)
      await new Promise<void>((resolve) => ws.once('open', () => resolve()))

      try {
        // Send a staged edit (AI proposal)
        const stagedCommand = {
          type: 'editor:insert_block',
          index: 1,
          block: { id: 'p2', type: 'paragraph', content: 'Unaccepted AI proposal block' },
          staged: true
        }

        ws.send(
          JSON.stringify({
            type: 'sync-command',
            command: stagedCommand,
            clientId: 'agent-copilot',
            version: 0,
            threadId: 'thread-proposal'
          })
        )

        // Wait for sync-ack
        await new Promise<void>((resolve) => {
          const handler = (data: WebSocket.RawData) => {
            const msg = JSON.parse(data.toString()) as { type: string }
            if (msg.type === 'sync-ack') {
              ws.off('message', handler)
              resolve()
            }
          }
          ws.on('message', handler)
        })

        // Flush WebSocket debounce
        await wsServer.flush(instance.id)

        // SQLite disk must still contain the pristine baselinePayload, NOT the proposal
        const diskContentBuf = storage.getInstanceContent(instance.id)
        expect(diskContentBuf).not.toBeNull()
        const diskPayload = diskContentBuf ? unpack(diskContentBuf) : null
        expect(diskPayload).toEqual(baselinePayload)

        // Now reject the proposal
        ws.send(
          JSON.stringify({
            type: 'reject-changes',
            instanceId: instance.id,
            clientId: 'ui-user',
            threadId: 'thread-proposal'
          })
        )

        // Wait for reverted broadcast
        await new Promise<void>((resolve) => {
          const handler = (data: WebSocket.RawData) => {
            const msg = JSON.parse(data.toString()) as { type: string; from?: string }
            if (msg.type === 'sync-snapshot' && msg.from === 'agent-proposal-reverted') {
              ws.off('message', handler)
              resolve()
            }
          }
          ws.on('message', handler)
        })

        // SQLite disk remains completely pristine
        const finalDiskContentBuf = storage.getInstanceContent(instance.id)
        expect(finalDiskContentBuf).not.toBeNull()
        const finalDiskPayload = finalDiskContentBuf ? unpack(finalDiskContentBuf) : null
        expect(finalDiskPayload).toEqual(baselinePayload)
      } finally {
        ws.close()
      }
    })

    it('persists canvas writeGraph commands to SQLite disk and flushes reliably', async () => {
      const project = storage.createProject('Canvas Persistence Project')
      const emptyGraphPayload = createGraphPayload()

      const canvasInstance = storage.createInstance('canvas', {
        projectId: project.id,
        name: 'Agent Canvas',
        payload: emptyGraphPayload
      })

      // Execute writeGraph tool as the agent would
      const result = await executeWriteGraph({
        instanceId: canvasInstance.id,
        mode: 'replace',
        direction: 'LR',
        nodes: [
          { entity: 'Node 1', name: 'Concept Alpha', memo: 'Notes on Alpha' },
          { entity: 'Node 2', name: 'Concept Beta' }
        ],
        edges: [{ from: 'Node 1', to: 'Node 2', label: 'relates to' }],
        wsPort: wsServer.port
      })

      expect(result.status).toBe('success')

      // Flush WebSocket debounce
      await wsServer.flush(canvasInstance.id)

      // Verify SQLite disk persistence directly
      const diskContentBuf = storage.getInstanceContent(canvasInstance.id)
      expect(diskContentBuf).not.toBeNull()
      const diskPayload = diskContentBuf ? (unpack(diskContentBuf) as GraphCanvasDTO) : null
      expect(diskPayload).not.toBeNull()

      const diskNodes = Object.values(diskPayload?.graph.nodes || {})
      expect(diskNodes.length).toBe(2)
      const alphaNode = diskNodes.find((n) => n.name === 'Concept Alpha')
      const betaNode = diskNodes.find((n) => n.name === 'Concept Beta')
      expect(alphaNode).toBeDefined()
      expect(betaNode).toBeDefined()
      expect((alphaNode?.attrs as Record<string, unknown> | undefined)?.memo).toBe('Notes on Alpha')

      const diskRels = Object.values(diskPayload?.graph.relationships || {})
      expect(diskRels.length).toBe(1)
      expect(diskRels[0].attrs?.label).toBe('relates to')
    })

    it('persists document write (createDocument) commands to SQLite disk and flushes reliably', async () => {
      const project = storage.createProject('Document Create Persistence Project')
      const emptyDocPayload: DocumentPayload = { blocks: [] }

      const docInstance = storage.createInstance('document', {
        projectId: project.id,
        name: 'Agent Document',
        payload: emptyDocPayload
      })

      // Execute writeDocument (underlying createDocument) with initial content
      const result = await executeWriteDocument({
        instanceId: docInstance.id,
        payload: {
          blocks: [
            { id: 'b1', type: 'heading', level: 1, content: 'Research Document' },
            { id: 'b2', type: 'paragraph', content: 'Initial paragraphs content' }
          ]
        },
        wsPort: wsServer.port
      })

      expect(result.status).toBe('success')

      // Flush WebSocket debounce
      await wsServer.flush(docInstance.id)

      // Verify SQLite disk persistence directly
      const diskContentBuf = storage.getInstanceContent(docInstance.id)
      expect(diskContentBuf).not.toBeNull()
      const diskPayload = diskContentBuf ? (unpack(diskContentBuf) as DocumentPayload) : null
      expect(diskPayload).not.toBeNull()

      expect(diskPayload?.blocks.length).toBe(2)
      expect(diskPayload?.blocks[0]).toMatchObject({
        id: 'b1',
        type: 'heading',
        content: 'Research Document'
      })
      expect(diskPayload?.blocks[1]).toMatchObject({
        id: 'b2',
        type: 'paragraph',
        content: 'Initial paragraphs content'
      })
    })

    it('persists document edit (editDocument) commands to SQLite disk and flushes reliably', async () => {
      const project = storage.createProject('Document Edit Persistence Project')
      const initialDocPayload: DocumentPayload = {
        blocks: [{ id: 'b1', type: 'paragraph', content: 'Existing block before patch' }]
      }

      const docInstance = storage.createInstance('document', {
        projectId: project.id,
        name: 'Agent Editable Document',
        payload: initialDocPayload
      })

      // Execute document commands (underlying editDocument) with a patch command
      const result = await executeDocumentCommands({
        instanceId: docInstance.id,
        commands: [
          {
            type: 'editor:insert_block',
            index: 1,
            block: { id: 'b2', type: 'paragraph', content: 'Appended block from edit patch' }
          }
        ],
        wsPort: wsServer.port
      })

      expect(result.status).toBe('success')

      // Flush WebSocket debounce
      await wsServer.flush(docInstance.id)

      // Verify SQLite disk persistence directly
      const diskContentBuf = storage.getInstanceContent(docInstance.id)
      expect(diskContentBuf).not.toBeNull()
      const diskPayload = diskContentBuf ? (unpack(diskContentBuf) as DocumentPayload) : null
      expect(diskPayload).not.toBeNull()

      expect(diskPayload?.blocks.length).toBe(2)
      expect(diskPayload?.blocks[0]).toMatchObject({
        id: 'b1',
        content: 'Existing block before patch'
      })
      expect(diskPayload?.blocks[1]).toMatchObject({
        id: 'b2',
        content: 'Appended block from edit patch'
      })
    })
  })
})
