import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  extractGraphRecords,
  parseGraphFromSnapshot,
  executeReadGraph,
  executeWriteGraph
} from '../manageGraph'
import * as ClientConnection from '@workspace/sync/ClientConnection'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import { flattenMindMap, type MindMapNode } from '../graphSchemaConverter'
import { getCodeRecommendFix, extractErrorInfo } from '@collaragent/tools/WorkspaceTools'
import { z } from 'zod'

describe('manageGraph - Snapshot Parsing and readGraph Tool', () => {
  const wireDtoSnapshot = {
    graph: {
      nodes: {
        'node-1': {
          id: 'node-1',
          name: 'Machine Learning',
          attrs: {
            memo: '# ML Details\nCore concepts of ML.',
            clusterId: 'AI Theory'
          }
        },
        'node-2': {
          id: 'node-2',
          name: 'Deep Learning',
          attrs: {
            memo: '',
            clusterId: 'AI Theory'
          }
        },
        'node-3': {
          id: 'node-3',
          name: 'Unassigned Card',
          attrs: {
            clusterId: '__unassigned__'
          }
        }
      },
      relationships: {
        'rel-1': {
          id: 'rel-1',
          from: { nodeId: 'node-1', portId: 'east' },
          to: { nodeId: 'node-2', portId: 'west' },
          attrs: { label: 'subfield of' }
        }
      }
    },
    layout: {
      'node-1': { x: 100, y: 100, width: 300, height: 100 },
      'node-2': { x: 500, y: 100, width: 300, height: 100 }
    }
  }

  const domainSnapshot = {
    graph: {
      id: 'graph-1',
      nodesById: {
        'node-1': {
          id: 'node-1',
          type: 'card',
          name: 'Domain Node 1',
          attrs: {
            memo: 'Domain memo content',
            group: 'Core Domain'
          },
          ports: {}
        },
        'node-2': {
          id: 'node-2',
          type: 'card',
          name: 'Domain Node 2',
          attrs: {},
          ports: {}
        }
      },
      relationshipsById: {
        'rel-domain-1': {
          id: 'rel-domain-1',
          from: { nodeId: 'node-1' },
          to: { nodeId: 'node-2' },
          attrs: { label: 'connects to' }
        }
      },
      outgoingByNodeId: {},
      incomingByNodeId: {}
    },
    layoutByNodeId: {
      'node-1': { x: 0, y: 0, width: 300, height: 100 },
      'node-2': { x: 400, y: 0, width: 300, height: 100 }
    }
  }

  describe('extractGraphRecords', () => {
    it('extracts nodes and relationships from wire DTO snapshot (graph.nodes & graph.relationships)', () => {
      const records = extractGraphRecords(wireDtoSnapshot)
      expect(records.nodes.length).toBe(3)
      expect(records.relationships.length).toBe(1)

      expect(records.nodes.map((n) => n.name)).toContain('Machine Learning')
      expect(records.nodes.map((n) => n.name)).toContain('Deep Learning')
      expect(records.relationships[0].from.nodeId).toBe('node-1')
      expect(records.relationships[0].to.nodeId).toBe('node-2')
      expect(records.relationships[0].attrs?.label).toBe('subfield of')
    })

    it('extracts nodes and relationships from domain snapshot (graph.nodesById & graph.relationshipsById)', () => {
      const records = extractGraphRecords(domainSnapshot)
      expect(records.nodes.length).toBe(2)
      expect(records.relationships.length).toBe(1)

      expect(records.nodes.map((n) => n.name)).toContain('Domain Node 1')
      expect(records.relationships[0].attrs?.label).toBe('connects to')
    })

    it('handles empty or null snapshots safely without throwing', () => {
      expect(extractGraphRecords(null)).toEqual({ nodes: [], relationships: [] })
      expect(extractGraphRecords(undefined)).toEqual({ nodes: [], relationships: [] })
      expect(extractGraphRecords({})).toEqual({ nodes: [], relationships: [] })
      expect(extractGraphRecords({ graph: {} })).toEqual({ nodes: [], relationships: [] })
    })
  })

  describe('parseGraphFromSnapshot', () => {
    it('correctly parses wire DTO snapshot into human-readable nodes, edges, and groups', () => {
      const result = parseGraphFromSnapshot(wireDtoSnapshot, { includeMemo: true })

      expect(result.nodes.length).toBe(3)
      expect(result.edges.length).toBe(1)

      // Node 1 checks
      const mlNode = result.nodes.find((n) => n.entity === 'Machine Learning')
      expect(mlNode).toBeDefined()
      expect(mlNode?.hasMemo).toBe(true)
      expect(mlNode?.memo).toBe('# ML Details\nCore concepts of ML.')
      expect(mlNode?.group).toBe('AI Theory')

      // Node 2 checks
      const dlNode = result.nodes.find((n) => n.entity === 'Deep Learning')
      expect(dlNode).toBeDefined()
      expect(dlNode?.hasMemo).toBe(false)
      expect(dlNode?.memo).toBeUndefined()
      expect(dlNode?.group).toBe('AI Theory')

      // Edge endpoint resolution to entity names
      expect(result.edges[0]).toEqual({
        from: 'Machine Learning',
        to: 'Deep Learning',
        label: 'subfield of'
      })

      // Groups summary (excludes __unassigned__)
      expect(result.groups).toBeDefined()
      expect(result.groups?.length).toBe(1)
      expect(result.groups?.[0]).toEqual({
        name: 'AI Theory',
        nodeCount: 2,
        entities: ['Machine Learning', 'Deep Learning']
      })
    })

    it('omits memo content when includeMemo is false or omitted, but preserves hasMemo flag', () => {
      const result = parseGraphFromSnapshot(wireDtoSnapshot, { includeMemo: false })
      const mlNode = result.nodes.find((n) => n.entity === 'Machine Learning')

      expect(mlNode?.hasMemo).toBe(true)
      expect(mlNode?.memo).toBeUndefined()
    })
  })

  describe('executeReadGraph Integration with WebSocket Client', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('returns full graph state and disconnects client after reading', async () => {
      const mockDisconnect = vi.fn()
      const mockGetSnapshot = vi.fn().mockReturnValue(wireDtoSnapshot)
      const mockGetClientId = vi.fn().mockReturnValue('agent-test-123')

      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: mockGetSnapshot,
        getClientId: mockGetClientId,
        disconnect: mockDisconnect
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      const result = await executeReadGraph({
        instanceId: 'canvas-test-uuid',
        wsPort: 3000,
        includeMemo: true
      })

      expect(result.instanceId).toBe('canvas-test-uuid')
      expect(result.clientId).toBe('agent-test-123')
      expect(result.nodes.length).toBe(3)
      expect(result.edges.length).toBe(1)
      expect(result.edges[0].from).toBe('Machine Learning')
      expect(result.edges[0].to).toBe('Deep Learning')
      expect(mockDisconnect).toHaveBeenCalledTimes(1)
    })

    it('resolves existing nodes from wire DTO snapshot in writeGraph merge mode', async () => {
      const mockDisconnect = vi.fn()
      const mockGetSnapshot = vi.fn().mockReturnValue(wireDtoSnapshot)
      const mockSendBatch = vi.fn().mockResolvedValue([1, 2])

      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: mockGetSnapshot,
        getClientId: vi.fn().mockReturnValue('agent-test-123'),
        sendBatch: mockSendBatch,
        disconnect: mockDisconnect
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      const { executeWriteGraph } = await import('../manageGraph')

      // Merge a new node connected from existing node "Machine Learning"
      const result = await executeWriteGraph({
        instanceId: 'canvas-test-uuid',
        mode: 'merge',
        direction: 'LR',
        nodes: [{ entity: 'New LLM Node', name: 'New LLM Node' }],
        edges: [{ from: 'Machine Learning', to: 'New LLM Node', label: 'extends' }]
      })

      expect(result.status).toBe('success')
      expect(mockSendBatch).toHaveBeenCalled()
      expect(mockDisconnect).toHaveBeenCalledTimes(1)
    })

    it('throws WORKSPACE_GRAPH_SNAPSHOT_FAILED when snapshot is missing on write', async () => {
      const mockDisconnect = vi.fn()
      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: vi.fn().mockReturnValue(null),
        disconnect: mockDisconnect
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      await expect(
        executeWriteGraph({
          instanceId: 'canvas-missing-snapshot',
          mode: 'replace',
          direction: 'LR',
          nodes: [{ entity: 'Node 1' }],
          edges: []
        })
      ).rejects.toThrowError(WorkspaceError)

      try {
        await executeWriteGraph({
          instanceId: 'canvas-missing-snapshot',
          mode: 'replace',
          direction: 'LR',
          nodes: [{ entity: 'Node 1' }],
          edges: []
        })
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_SNAPSHOT_FAILED)
        }
      }
      expect(mockDisconnect).toHaveBeenCalled()
    })

    it('throws WORKSPACE_GRAPH_DUPLICATE_NODE_ALIAS when duplicate node entities are provided', async () => {
      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: vi.fn().mockReturnValue(wireDtoSnapshot),
        disconnect: vi.fn()
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      try {
        await executeWriteGraph({
          instanceId: 'canvas-test-uuid',
          mode: 'replace',
          direction: 'LR',
          nodes: [{ entity: 'DupNode' }, { entity: 'DupNode' }],
          edges: []
        })
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_DUPLICATE_NODE_ALIAS)
          expect(err.message).toContain('Duplicate node entity aliases are not allowed')
        }
      }
    })

    it('throws WORKSPACE_GRAPH_START_NODE_NOT_FOUND when merge mode anchor is not found', async () => {
      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: vi.fn().mockReturnValue(wireDtoSnapshot),
        disconnect: vi.fn()
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      try {
        await executeWriteGraph({
          instanceId: 'canvas-test-uuid',
          mode: 'merge',
          direction: 'LR',
          startFrom: 'NonExistentAnchorEntity',
          nodes: [{ entity: 'New Node' }],
          edges: []
        })
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_START_NODE_NOT_FOUND)
          expect(err.message).toContain("Cannot find 'startFrom' anchor entity")
        }
      }
    })

    it('throws WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED when edge refers to unknown node', async () => {
      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: vi.fn().mockReturnValue(wireDtoSnapshot),
        disconnect: vi.fn()
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      try {
        await executeWriteGraph({
          instanceId: 'canvas-test-uuid',
          mode: 'replace',
          direction: 'LR',
          nodes: [{ entity: 'Node A' }],
          edges: [{ from: 'Node A', to: 'Missing Node B' }]
        })
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED)
          expect(err.message).toContain('Unable to resolve edge endpoint(s)')
        }
      }
    })

    it('throws WORKSPACE_GRAPH_NODE_ALIAS_COLLISION when different aliases map to the same node ID', async () => {
      const canonicalId = 'node-11111111-1111-4111-8111-111111111111'
      const collisionSnapshot = {
        graph: {
          nodes: {
            [canonicalId]: { id: canonicalId, name: 'Shared Alias' }
          },
          relationships: {}
        },
        layout: {}
      }

      vi.spyOn(ClientConnection, 'connectToCanvas').mockResolvedValue({
        getSnapshot: vi.fn().mockReturnValue(collisionSnapshot),
        sendBatch: vi.fn(),
        disconnect: vi.fn()
      } as unknown as Awaited<ReturnType<typeof ClientConnection.connectToCanvas>>)

      try {
        await executeWriteGraph({
          instanceId: 'canvas-test-uuid',
          mode: 'merge',
          direction: 'LR',
          nodes: [
            { entity: canonicalId, name: 'Canonical Reference' },
            { entity: 'Shared Alias', name: 'Name Reference' }
          ],
          edges: []
        })
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_NODE_ALIAS_COLLISION)
          expect(err.message).toContain('Multiple node aliases resolved to the same node')
        }
      }
    })
  })

  describe('flattenMindMap Validation & Errors', () => {
    it('throws WORKSPACE_GRAPH_MINDMAP_ROOT_EMPTY if root entity is empty or whitespace', () => {
      expect(() => {
        flattenMindMap({ entity: '' })
      }).toThrowError(WorkspaceError)

      try {
        flattenMindMap({ entity: '   ' })
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_ROOT_EMPTY)
          expect(err.message).toContain('non-empty entity name')
        }
      }
    })

    it('throws WORKSPACE_GRAPH_MINDMAP_CYCLE_DETECTED if hierarchy has circular references', () => {
      const child: MindMapNode = { entity: 'Child Node', children: [] }
      const root: MindMapNode = { entity: 'Root Node', children: [child] }
      // Introduce circular reference
      child.children = [root]

      expect(() => {
        flattenMindMap(root)
      }).toThrowError(WorkspaceError)

      try {
        flattenMindMap(root)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_CYCLE_DETECTED)
          expect(err.message).toContain('Circular reference detected')
        }
      }
    })

    it('successfully flattens valid hierarchical mind map', () => {
      const root: MindMapNode = {
        entity: 'Topic',
        children: [
          { entity: 'Subtopic 1', memo: 'Memo 1' },
          { entity: 'Subtopic 2', children: [{ entity: 'Subtopic 2.1' }] }
        ]
      }

      const { nodes, edges } = flattenMindMap(root)
      expect(nodes.length).toBe(4)
      expect(edges.length).toBe(3)
      expect(nodes.map((n) => n.entity)).toEqual([
        'Topic',
        'Subtopic 1',
        'Subtopic 2',
        'Subtopic 2.1'
      ])
      expect(edges).toContainEqual({ from: 'Topic', to: 'Subtopic 1' })
      expect(edges).toContainEqual({ from: 'Topic', to: 'Subtopic 2' })
      expect(edges).toContainEqual({ from: 'Subtopic 2', to: 'Subtopic 2.1' })
    })
  })

  describe('Graph Canvas Diagnostics & Recommendations', () => {
    it('provides actionable recommendations for all graph canvas error codes', () => {
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_NOT_FOUND)).toBe(
        'The requested graph canvas instance does not exist. Use listWorkspaceItems to verify available canvas names.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_SNAPSHOT_FAILED)).toBe(
        'Failed to retrieve the graph canvas snapshot from the server. Ensure the canvas server is reachable and initialized.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_CORRUPTED)).toBe(
        'The graph canvas snapshot contains an invalid or unreadable schema. Re-create or re-initialize the canvas instance.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_SPEC_INVALID)).toBe(
        'The graph specification is invalid. Verify direction (LR/TD/RADIAL), mode (replace/merge), and nodes/edges schemas.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_DUPLICATE_NODE_ALIAS)).toBe(
        'Each node in the "nodes" array must have a unique "entity" alias. Consolidate or rename duplicate entries.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_NODE_ALIAS_COLLISION)).toBe(
        'Multiple entity aliases resolved to the same underlying node ID. Use unique entity names for distinct nodes.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED)).toBe(
        'Edge endpoints must refer to an entity in the "nodes" array or an existing canvas node. Call readGraph first to confirm available entities.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_START_NODE_NOT_FOUND)).toBe(
        'The "startFrom" anchor entity was not found on the canvas. Run readGraph to see existing node entity aliases.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_ROOT_EMPTY)).toBe(
        'The root node of a mind map must have a non-empty "entity" name.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_CYCLE_DETECTED)).toBe(
        'Mind maps must be strictly hierarchical trees. Remove circular parent-child references.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_LAYOUT_COMPUTATION_FAILED)).toBe(
        'Automated graph layout computation failed. Check for cyclic or disconnected node structures.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_INVALID_CLUSTER_SPEC)).toBe(
        'The clustering specification is invalid. Ensure cluster names and node group assignments are valid strings.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_CLUSTER_EXECUTION_FAILED)).toBe(
        'Graph clustering algorithm execution failed. Verify graph connectivity and node relationships.'
      )
      expect(getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_CLUSTER_ABORTED)).toBe(
        'Graph clustering operation was aborted or timed out.'
      )
    })

    it('extractErrorInfo cleanly extracts WorkspaceError and provides recommendations', () => {
      const err = new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED,
        'Edge references unknown node alias: Node A -> Node B'
      )
      const info = extractErrorInfo(err)
      expect(info.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED)
      expect(info.message).toBe('Edge references unknown node alias: Node A -> Node B')
      expect(info.recommendFix).toBe(
        'Edge endpoints must refer to an entity in the "nodes" array or an existing canvas node. Call readGraph first to confirm available entities.'
      )
    })

    it('extractErrorInfo maps ZodError to WORKSPACE_GRAPH_SPEC_INVALID with schema detail', () => {
      const TestSchema = z.object({
        direction: z.enum(['LR', 'TD'])
      })

      const parseResult = TestSchema.safeParse({ direction: 'INVALID_DIR' })
      expect(parseResult.success).toBe(false)
      if (!parseResult.success) {
        const info = extractErrorInfo(parseResult.error)
        expect(info.code).toBe(WorkspaceErrorCode.WORKSPACE_GRAPH_SPEC_INVALID)
        expect(info.message).toContain('direction')
        expect(info.recommendFix).toBe(
          'The graph specification is invalid. Verify direction (LR/TD/RADIAL), mode (replace/merge), and nodes/edges schemas.'
        )
      }
    })
  })
})
