import { describe, it, expect } from 'vitest'
import {
  estimateNodeDimensions,
  computeAutoLayout,
  applyGraphSpec,
  NodeSpecSchema,
  mergeClusterAttrs,
  flattenMindMap,
  type NodeSpec,
  type EdgeSpec
} from '../graphSchemaConverter'
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_SEP,
  DEFAULT_RANK_SEP,
  MIN_NODE_EXPANDED_HEIGHT
} from '@shared/constants'
import { calculateHeaderHeight } from '@workspace/canvas/components/nodeLayout'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

describe('Content-Aware Auto-Layout', () => {
  describe('estimateNodeDimensions', () => {
    it('calculates compact dimensions for nodes without memo content', () => {
      const node: NodeSpec = {
        entity: 'node-compact',
        name: 'Compact Node'
      }

      const dims = estimateNodeDimensions(node)
      const expectedHeaderHeight = calculateHeaderHeight('Compact Node', DEFAULT_NODE_WIDTH)

      expect(dims.width).toBe(DEFAULT_NODE_WIDTH)
      expect(dims.height).toBe(expectedHeaderHeight)
      expect(dims.height).toBe(56)
    })

    it('treats whitespace-only memo as having no memo', () => {
      const node: NodeSpec = {
        entity: 'node-whitespace-memo',
        name: 'Whitespace Memo',
        memo: '   \n\t  '
      }

      const dims = estimateNodeDimensions(node)
      const expectedHeaderHeight = calculateHeaderHeight('Whitespace Memo', DEFAULT_NODE_WIDTH)

      expect(dims.width).toBe(DEFAULT_NODE_WIDTH)
      expect(dims.height).toBe(expectedHeaderHeight)
    })

    it('dynamically increases height for multi-line titles without memo', () => {
      const multiLineName =
        'This is an intentionally long title that wraps across multiple lines in the node header component to test dynamic sizing'
      const node: NodeSpec = {
        entity: 'node-long-title',
        name: multiLineName
      }

      const dims = estimateNodeDimensions(node)
      const expectedHeaderHeight = calculateHeaderHeight(multiLineName, DEFAULT_NODE_WIDTH)

      expect(dims.width).toBe(DEFAULT_NODE_WIDTH)
      expect(dims.height).toBe(expectedHeaderHeight)
      expect(dims.height).toBeGreaterThan(56)
      expect(dims.height).toBeLessThanOrEqual(120)
    })

    it('calculates expanded height for nodes with markdown memo', () => {
      const node: NodeSpec = {
        entity: 'node-with-memo',
        name: 'Memo Node',
        memo: '### Summary\n- Point 1\n- Point 2'
      }

      const dims = estimateNodeDimensions(node)
      const headerHeight = calculateHeaderHeight('Memo Node', DEFAULT_NODE_WIDTH)
      const expectedHeight = Math.max(
        headerHeight + MIN_NODE_EXPANDED_HEIGHT,
        headerHeight + DEFAULT_NODE_HEIGHT
      )

      expect(dims.width).toBe(DEFAULT_NODE_WIDTH)
      expect(dims.height).toBe(expectedHeight)
      expect(dims.height).toBe(56 + MIN_NODE_EXPANDED_HEIGHT)
    })

    it('detects memo inside attrs safely without type coercion errors', () => {
      const node: NodeSpec = {
        entity: 'node-attrs-memo',
        name: 'Attrs Memo Node',
        attrs: {
          memo: 'Memo content stored inside attrs'
        }
      }

      const dims = estimateNodeDimensions(node)
      const headerHeight = calculateHeaderHeight('Attrs Memo Node', DEFAULT_NODE_WIDTH)
      const expectedHeight = Math.max(
        headerHeight + MIN_NODE_EXPANDED_HEIGHT,
        headerHeight + DEFAULT_NODE_HEIGHT
      )

      expect(dims.width).toBe(DEFAULT_NODE_WIDTH)
      expect(dims.height).toBe(expectedHeight)
    })

    it('preserves dimensions from existingLayout while enforcing minimum expanded height', () => {
      const node: NodeSpec = {
        entity: 'node-existing',
        name: 'Custom Node',
        memo: 'Memo body here'
      }

      // Case A: Custom width and taller custom height
      const existingLayoutA = {
        x: 100,
        y: 100,
        width: 450,
        height: 380
      }
      const dimsA = estimateNodeDimensions(node, existingLayoutA)
      expect(dimsA.width).toBe(450)
      expect(dimsA.height).toBe(380)

      // Case B: Custom height smaller than min expanded height is clamped up
      const headerHeight = calculateHeaderHeight('Custom Node', 300)
      const existingLayoutB = {
        x: 0,
        y: 0,
        width: 300,
        height: 60
      }
      const dimsB = estimateNodeDimensions(node, existingLayoutB)
      expect(dimsB.width).toBe(300)
      expect(dimsB.height).toBe(headerHeight + MIN_NODE_EXPANDED_HEIGHT)
    })
  })

  describe('computeAutoLayout with Dagre Sugiyama', () => {
    it('spaces downstream ranks below the true bottom edge of tall parent nodes in TD mode', () => {
      const parent: NodeSpec = {
        entity: 'parent',
        name: 'Parent Node with Multi-Line Title Wrapping Across Multiple Header Lines',
        memo: 'Detailed memo content providing rich background context that expands the card body.'
      }
      const child: NodeSpec = {
        entity: 'child',
        name: 'Downstream Child Node'
      }
      const edges: EdgeSpec[] = [{ from: 'parent', to: 'child' }]

      const layout = computeAutoLayout([parent, child], edges, 'TD')

      const parentLayout = layout['parent']
      const childLayout = layout['child']

      expect(parentLayout).toBeDefined()
      expect(childLayout).toBeDefined()

      // Parent has multi-line header + memo, so its height is significantly larger than default 100px
      expect(parentLayout.height).toBeGreaterThan(150)

      // Dagre rank separation must ensure child top edge is at or below parent bottom edge
      const parentBottomEdge = parentLayout.y + parentLayout.height
      expect(childLayout.y).toBeGreaterThanOrEqual(parentBottomEdge)

      // Verify rank separation matches or exceeds DEFAULT_RANK_SEP
      expect(childLayout.y - parentBottomEdge).toBeGreaterThanOrEqual(DEFAULT_RANK_SEP - 1)
    })

    it('spaces downstream ranks to the right of wide parent nodes in LR mode', () => {
      const parent: NodeSpec = {
        entity: 'node-left',
        name: 'Left Root Node'
      }
      const child: NodeSpec = {
        entity: 'node-right',
        name: 'Right Leaf Node'
      }
      const edges: EdgeSpec[] = [{ from: 'node-left', to: 'node-right' }]

      const layout = computeAutoLayout([parent, child], edges, 'LR')

      const leftLayout = layout['node-left']
      const rightLayout = layout['node-right']

      expect(leftLayout).toBeDefined()
      expect(rightLayout).toBeDefined()

      const leftRightEdge = leftLayout.x + leftLayout.width
      expect(rightLayout.x).toBeGreaterThanOrEqual(leftRightEdge)
      expect(rightLayout.x - leftRightEdge).toBeGreaterThanOrEqual(DEFAULT_RANK_SEP - 1)
    })

    it('spaces sibling nodes within the same rank according to DEFAULT_NODE_SEP in TD mode', () => {
      const parent: NodeSpec = { entity: 'root', name: 'Root' }
      const child1: NodeSpec = { entity: 'child-1', name: 'Child 1' }
      const child2: NodeSpec = { entity: 'child-2', name: 'Child 2' }
      const edges: EdgeSpec[] = [
        { from: 'root', to: 'child-1' },
        { from: 'root', to: 'child-2' }
      ]

      const layout = computeAutoLayout([parent, child1, child2], edges, 'TD')
      const c1 = layout['child-1']
      const c2 = layout['child-2']

      expect(c1).toBeDefined()
      expect(c2).toBeDefined()

      const [leftNode, rightNode] = c1.x < c2.x ? [c1, c2] : [c2, c1]
      const siblingGap = rightNode.x - (leftNode.x + leftNode.width)
      expect(siblingGap).toBeGreaterThanOrEqual(DEFAULT_NODE_SEP - 1)
    })

    it('uses existingLayout dimensions when provided to computeAutoLayout', () => {
      const parent: NodeSpec = {
        entity: 'parent-custom',
        name: 'Parent',
        memo: 'Memo content'
      }
      const child: NodeSpec = {
        entity: 'child-custom',
        name: 'Child'
      }
      const edges: EdgeSpec[] = [{ from: 'parent-custom', to: 'child-custom' }]

      const existingLayouts = {
        'parent-custom': {
          x: 0,
          y: 0,
          width: 300,
          height: 500 // Very tall manual height
        }
      }

      const layout = computeAutoLayout(
        [parent, child],
        edges,
        'TD',
        0,
        0,
        undefined,
        existingLayouts
      )

      const parentLayout = layout['parent-custom']
      const childLayout = layout['child-custom']

      expect(parentLayout.height).toBe(500)
      expect(childLayout.y).toBeGreaterThanOrEqual(parentLayout.y + 500)
    })
  })

  describe('mergeIntoGraph dynamic anchor positioning', () => {
    it('offsets newly merged nodes using the true height of startFrom anchor node', () => {
      const initialGraph = applyGraphSpec(null, {
        instanceId: 'test-instance',
        mode: 'replace',
        direction: 'TD',
        nodes: [
          {
            entity: 'anchor-node',
            name: 'Anchor Node with Very Long Title Requiring Multiple Wrapped Lines in the Header',
            memo: 'Memo content expanding the anchor node card body.'
          }
        ],
        edges: []
      })

      const anchorLayout = initialGraph.layout.layoutByNodeId['anchor-node']
      expect(anchorLayout).toBeDefined()
      expect(anchorLayout.height).toBeGreaterThan(150)

      // Merge a new child node connected from anchor-node
      const mergedGraph = applyGraphSpec(initialGraph, {
        instanceId: 'test-instance',
        mode: 'merge',
        direction: 'TD',
        startFrom: 'anchor-node',
        nodes: [
          {
            entity: 'new-node',
            name: 'Newly Added Node'
          }
        ],
        edges: [{ from: 'anchor-node', to: 'new-node' }]
      })

      const newLayout = mergedGraph.layout.layoutByNodeId['new-node']
      expect(newLayout).toBeDefined()

      // The new node must be placed below the anchor node's true bottom edge
      expect(newLayout.y).toBeGreaterThanOrEqual(anchorLayout.y + anchorLayout.height)
    })
  })

  describe('NodeSpecSchema & Cluster Grouping', () => {
    it('validates a node spec with group property', () => {
      const parsed = NodeSpecSchema.parse({
        entity: 'service-a',
        name: 'Service A',
        group: 'Backend'
      })
      expect(parsed.group).toBe('Backend')
    })

    it('maps group to attrs.clusterId when merging cluster attrs', () => {
      const attrs = mergeClusterAttrs({}, { group: 'Data Pipeline' })
      expect(attrs.clusterId).toBe('Data Pipeline')
    })

    it('clears clusterId when group is an empty or whitespace string', () => {
      const attrs = mergeClusterAttrs({ clusterId: 'Old Group' }, { group: '  ' })
      expect(attrs.clusterId).toBeUndefined()
      expect('clusterId' in attrs).toBe(false)
    })

    it('stamps attrs.clusterId when creating graph via applyGraphSpec', () => {
      const graph = applyGraphSpec(null, {
        instanceId: 'cluster-test',
        mode: 'replace',
        direction: 'LR',
        nodes: [
          { entity: 'ui-node', name: 'UI Card', group: 'Frontend' },
          { entity: 'api-node', name: 'API Card', group: 'Backend' }
        ],
        edges: [{ from: 'ui-node', to: 'api-node' }]
      })

      expect(graph.graph.nodes['ui-node'].attrs?.clusterId).toBe('Frontend')
      expect(graph.graph.nodes['api-node'].attrs?.clusterId).toBe('Backend')
    })

    it('updates existing node name, memo, and cluster group in merge mode', () => {
      const initial = applyGraphSpec(null, {
        instanceId: 'test-merge-update',
        mode: 'replace',
        direction: 'LR',
        nodes: [{ entity: 'card-1', name: 'Original Card' }],
        edges: []
      })

      expect(initial.graph.nodes['card-1'].name).toBe('Original Card')
      expect(initial.graph.nodes['card-1'].attrs?.clusterId).toBeUndefined()

      const merged = applyGraphSpec(initial, {
        instanceId: 'test-merge-update',
        mode: 'merge',
        direction: 'LR',
        nodes: [
          {
            entity: 'card-1',
            name: 'Updated Card',
            memo: 'Updated Memo Content',
            group: 'Core Domain'
          }
        ],
        edges: []
      })

      expect(merged.graph.nodes['card-1'].name).toBe('Updated Card')
      expect(merged.graph.nodes['card-1'].attrs?.memo).toBe('Updated Memo Content')
      expect(merged.graph.nodes['card-1'].attrs?.clusterId).toBe('Core Domain')
    })

    it('automatically assigns branch groups to children in flattenMindMap', () => {
      const root = {
        entity: 'Root Idea',
        children: [
          {
            entity: 'Frontend Branch',
            children: [{ entity: 'React View' }, { entity: 'Tailwind CSS' }]
          },
          {
            entity: 'Backend Branch',
            children: [{ entity: 'Express API' }]
          }
        ]
      }

      const { nodes, edges } = flattenMindMap(root)
      const nodesByEntity = Object.fromEntries(nodes.map((n) => [n.entity, n]))

      expect(nodesByEntity['Root Idea'].group).toBeUndefined()
      expect(nodesByEntity['Frontend Branch'].group).toBe('Frontend Branch')
      expect(nodesByEntity['React View'].group).toBe('Frontend Branch')
      expect(nodesByEntity['Tailwind CSS'].group).toBe('Frontend Branch')
      expect(nodesByEntity['Backend Branch'].group).toBe('Backend Branch')
      expect(nodesByEntity['Express API'].group).toBe('Backend Branch')

      expect(edges.length).toBe(5)
    })

    it('throws WorkspaceError with WORKSPACE_INVALID_CLUSTER_SPEC on duplicate entity aliases', () => {
      const spec = {
        instanceId: 'test-instance',
        mode: 'replace' as const,
        direction: 'LR' as const,
        nodes: [
          { entity: 'duplicate-node', name: 'Node 1' },
          { entity: 'duplicate-node', name: 'Node 2' }
        ],
        edges: []
      }

      expect(() => {
        applyGraphSpec(null, spec)
      }).toThrowError(WorkspaceError)

      try {
        applyGraphSpec(null, spec)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_INVALID_CLUSTER_SPEC)
          expect(err.message).toContain('Duplicate node entity aliases are not allowed')
        }
      }
    })

    it('throws WorkspaceError with WORKSPACE_INVALID_CLUSTER_SPEC on unknown edge endpoints', () => {
      const spec = {
        instanceId: 'test-instance',
        mode: 'replace' as const,
        direction: 'LR' as const,
        nodes: [{ entity: 'node-a', name: 'Node A' }],
        edges: [{ from: 'node-a', to: 'unknown-b' }]
      }

      expect(() => {
        applyGraphSpec(null, spec)
      }).toThrowError(WorkspaceError)

      try {
        applyGraphSpec(null, spec)
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(WorkspaceError)
        if (err instanceof WorkspaceError) {
          expect(err.code).toBe(WorkspaceErrorCode.WORKSPACE_INVALID_CLUSTER_SPEC)
          expect(err.message).toContain('Edge references unknown node alias')
        }
      }
    })
  })
})
