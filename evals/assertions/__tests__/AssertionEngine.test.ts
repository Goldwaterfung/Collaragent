import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { AssertionEngine } from '../AssertionEngine'
import type { DocumentPayload, GraphCanvasDTO } from '@shared/schemas/instances'

describe('AssertionEngine', () => {
  describe('assertToolSchema', () => {
    const testSchema = z.object({
      instanceName: z.string().min(1),
      count: z.number().int().positive()
    })

    it('should validate conforming arguments', () => {
      const result = AssertionEngine.assertToolSchema(
        'testTool',
        {
          instanceName: 'test-doc',
          count: 5
        },
        testSchema
      )

      expect(result.valid).toBe(true)
      expect(result.toolName).toBe('testTool')
      expect(result.errors).toBeUndefined()
    })

    it('should catch schema validation failures', () => {
      const result = AssertionEngine.assertToolSchema(
        'testTool',
        {
          instanceName: '',
          count: -1
        },
        testSchema
      )

      expect(result.valid).toBe(false)
      expect(result.errors?.length).toBeGreaterThan(0)
    })
  })

  describe('assertLexicalAST', () => {
    it('should validate a healthy Lexical Document AST', () => {
      const doc: DocumentPayload = {
        blocks: [
          { id: 'b1', type: 'h1', content: 'Title' },
          { id: 'b2', type: 'h2', content: 'Subtitle' },
          {
            id: 'b3',
            type: 'paragraph',
            children: [{ text: 'Content with formula', equation: 'E=mc^2', inline: true }]
          },
          {
            id: 'b4',
            type: 'table',
            tableRows: [
              {
                cells: [{ children: [{ text: 'Header 1' }] }, { children: [{ text: 'Header 2' }] }]
              },
              { cells: [{ children: [{ text: 'Value 1' }] }, { children: [{ text: 'Value 2' }] }] }
            ]
          }
        ]
      }

      const result = AssertionEngine.assertLexicalAST(doc)
      expect(result.valid).toBe(true)
      expect(result.blockCount).toBe(4)
      expect(result.hasDuplicateIds).toBe(false)
      expect(result.hasValidHeadingHierarchy).toBe(true)
      expect(result.hasConsistentTables).toBe(true)
    })

    it('should flag duplicate block IDs', () => {
      const doc: DocumentPayload = {
        blocks: [
          { id: 'duplicate-id', type: 'paragraph', content: 'First' },
          { id: 'duplicate-id', type: 'paragraph', content: 'Second' }
        ]
      }

      const result = AssertionEngine.assertLexicalAST(doc)
      expect(result.valid).toBe(false)
      expect(result.hasDuplicateIds).toBe(true)
      expect(result.duplicateIds).toContain('duplicate-id')
    })

    it('should flag heading hierarchy gaps (e.g. h1 -> h3)', () => {
      const doc: DocumentPayload = {
        blocks: [
          { id: 'b1', type: 'h1', content: 'Top Header' },
          { id: 'b2', type: 'h3', content: 'Deep Subheader without h2' }
        ]
      }

      const result = AssertionEngine.assertLexicalAST(doc)
      expect(result.valid).toBe(false)
      expect(result.hasValidHeadingHierarchy).toBe(false)
    })

    it('should flag inconsistent table row column counts', () => {
      const doc: DocumentPayload = {
        blocks: [
          {
            id: 'b1',
            type: 'table',
            tableRows: [
              { cells: [{ children: [{ text: 'Col 1' }] }, { children: [{ text: 'Col 2' }] }] },
              { cells: [{ children: [{ text: 'Only Col 1' }] }] } // Mismatch: 1 cell vs 2
            ]
          }
        ]
      }

      const result = AssertionEngine.assertLexicalAST(doc)
      expect(result.valid).toBe(false)
      expect(result.hasConsistentTables).toBe(false)
    })
  })

  describe('assertGraphDAG', () => {
    it('should validate a valid Directed Acyclic Graph (DAG)', () => {
      const canvas: GraphCanvasDTO = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: {
          nodes: {
            'n-1': { id: 'n-1', type: 'card', name: 'Root Concept' },
            'n-2': { id: 'n-2', type: 'card', name: 'Child Concept A' },
            'n-3': { id: 'n-3', type: 'card', name: 'Child Concept B' }
          },
          relationships: {
            'r-1': { id: 'r-1', from: { nodeId: 'n-1' }, to: { nodeId: 'n-2' } },
            'r-2': { id: 'r-2', from: { nodeId: 'n-1' }, to: { nodeId: 'n-3' } }
          }
        },
        layout: {
          layoutByNodeId: {
            'n-1': { x: 0, y: 0, width: 150, height: 100 },
            'n-2': { x: -200, y: 150, width: 150, height: 100 },
            'n-3': { x: 200, y: 150, width: 150, height: 100 }
          }
        }
      }

      const result = AssertionEngine.assertGraphDAG(canvas)
      expect(result.valid).toBe(true)
      expect(result.nodeCount).toBe(3)
      expect(result.relationshipCount).toBe(2)
      expect(result.isAcyclic).toBe(true)
      expect(result.hasDanglingEndpoints).toBe(false)
    })

    it('should detect dangling relationship endpoints', () => {
      const canvas: GraphCanvasDTO = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: {
          nodes: {
            'n-1': { id: 'n-1', type: 'card', name: 'Root' }
          },
          relationships: {
            'r-1': { id: 'r-1', from: { nodeId: 'n-1' }, to: { nodeId: 'nonexistent-node' } }
          }
        },
        layout: {
          layoutByNodeId: {
            'n-1': { x: 0, y: 0, width: 100, height: 100 }
          }
        }
      }

      const result = AssertionEngine.assertGraphDAG(canvas)
      expect(result.valid).toBe(false)
      expect(result.hasDanglingEndpoints).toBe(true)
      expect(result.danglingEndpoints).toContain('nonexistent-node')
    })

    it('should detect cycles in directed graphs', () => {
      const canvas: GraphCanvasDTO = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: {
          nodes: {
            'n-1': { id: 'n-1', type: 'card', name: 'Node 1' },
            'n-2': { id: 'n-2', type: 'card', name: 'Node 2' },
            'n-3': { id: 'n-3', type: 'card', name: 'Node 3' }
          },
          relationships: {
            'r-1': { id: 'r-1', from: { nodeId: 'n-1' }, to: { nodeId: 'n-2' } },
            'r-2': { id: 'r-2', from: { nodeId: 'n-2' }, to: { nodeId: 'n-3' } },
            'r-3': { id: 'r-3', from: { nodeId: 'n-3' }, to: { nodeId: 'n-1' } } // Directed cycle: 1 -> 2 -> 3 -> 1
          }
        },
        layout: {
          layoutByNodeId: {
            'n-1': { x: 0, y: 0, width: 100, height: 100 },
            'n-2': { x: 100, y: 0, width: 100, height: 100 },
            'n-3': { x: 200, y: 0, width: 100, height: 100 }
          }
        }
      }

      const result = AssertionEngine.assertGraphDAG(canvas, true)
      expect(result.valid).toBe(false)
      expect(result.isAcyclic).toBe(false)
      expect(result.cyclePath).toBeDefined()
    })
  })

  describe('assertRollbackParity', () => {
    it('should confirm 100% byte parity for identical states', () => {
      const baseline = { blocks: [{ id: 'b1', content: 'Original text' }] }
      const restored = { blocks: [{ id: 'b1', content: 'Original text' }] }

      const result = AssertionEngine.assertRollbackParity(baseline, restored)
      expect(result.matches).toBe(true)
      expect(result.byteParity).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should flag rollback mismatch when state is mutated', () => {
      const baseline = { blocks: [{ id: 'b1', content: 'Original text' }] }
      const restored = { blocks: [{ id: 'b1', content: 'Mutated text' }] }

      const result = AssertionEngine.assertRollbackParity(baseline, restored)
      expect(result.matches).toBe(false)
      expect(result.byteParity).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('evaluateScenarioInvariants', () => {
    it('should produce 1.0 scores for a fully passing scenario', () => {
      const doc: DocumentPayload = {
        blocks: [{ id: 'b1', type: 'paragraph', content: 'Valid document' }]
      }

      const summary = AssertionEngine.evaluateScenarioInvariants({
        expectedTools: ['createDocumentHtml'],
        toolCalls: [
          {
            name: 'createDocumentHtml',
            args: { html_content: '<p>Valid document</p>', instanceName: 'doc1' },
            status: 'success'
          }
        ],
        documentPayload: doc,
        initialSnapshot: { doc: 'baseline' },
        restoredSnapshot: { doc: 'baseline' },
        errorRecoveryAchieved: true
      })

      expect(summary.passed).toBe(true)
      expect(summary.toolSelectionAccuracy).toBe(1.0)
      expect(summary.schemaAdherence).toBe(1.0)
      expect(summary.invariantIntegrity).toBe(1.0)
      expect(summary.rollbackInvariantPassed).toBe(true)
      expect(summary.errorRecoverySuccess).toBe(true)
      expect(summary.errors.length).toBe(0)
    })

    it('should drop toolSelectionAccuracy to 0.0 on incorrect initial tool', () => {
      const summary = AssertionEngine.evaluateScenarioInvariants({
        expectedTools: ['createDocumentHtml'],
        toolCalls: [
          {
            name: 'searchWorkspace',
            args: { query: 'something' },
            status: 'success'
          }
        ]
      })

      expect(summary.passed).toBe(false)
      expect(summary.toolSelectionAccuracy).toBe(0.0)
    })
  })
})
