import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractGraphRecords, parseGraphFromSnapshot, executeReadGraph } from '../manageGraph'
import * as ClientConnection from '@workspace/sync/ClientConnection'

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
  })
})
