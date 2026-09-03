import { describe, it, expect } from 'vitest'
import {
  estimateNodeDimensions,
  computeAutoLayout,
  applyGraphSpec,
  type NodeSpec,
  type EdgeSpec
} from '../graphSchemaConverter'
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_EXPANDED_HEIGHT,
  NODE_SPACING
} from '@shared/constants'
import { calculateHeaderHeight } from '@workspace/canvas/components/nodeLayout'

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

      // Verify rank separation matches or exceeds NODE_SPACING
      expect(childLayout.y - parentBottomEdge).toBeGreaterThanOrEqual(NODE_SPACING - 1)
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
      expect(rightLayout.x - leftRightEdge).toBeGreaterThanOrEqual(NODE_SPACING - 1)
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
})
