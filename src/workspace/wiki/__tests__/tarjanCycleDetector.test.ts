import { describe, it, expect } from 'vitest'
import { detectSupersedenceCycle, assertNoSupersedenceCycle } from '../TarjanCycleDetector'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import type { RelationalLedgerEntry } from '@shared/wiki'

function createTestEdge(
  id: string,
  source: string,
  target: string,
  rel: RelationalLedgerEntry['rel'] = 'supersedes'
): RelationalLedgerEntry {
  return {
    id,
    sourceEntityId: source,
    targetEntityId: target,
    rel,
    provenance: 'document_claim',
    status: 'active',
    anchor: {
      blockId: 'blk-1',
      justification: `${source} ${rel} ${target}`
    },
    meta: {
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      author: 'agent'
    }
  }
}

describe('TarjanCycleDetector (Spec §7.7)', () => {
  it('allows a linear acyclic chain of supersedence edges', () => {
    const edges: RelationalLedgerEntry[] = [
      createTestEdge('e1', 'ResNet', 'AlexNet'),
      createTestEdge('e2', 'ViT', 'ResNet')
    ]
    const candidate = createTestEdge('e3', 'NextViT', 'ViT')

    const result = detectSupersedenceCycle(edges, candidate)
    expect(result.hasCycle).toBe(false)
    expect(() => assertNoSupersedenceCycle(edges, candidate)).not.toThrow()
  })

  it('detects a 2-node circular supersedence cycle and throws WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE', () => {
    const edges: RelationalLedgerEntry[] = [createTestEdge('e1', 'CNN', 'ViT')]
    const candidate = createTestEdge('e2', 'ViT', 'CNN')

    const result = detectSupersedenceCycle(edges, candidate)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleEntities).toEqual(['CNN', 'ViT', 'CNN'])
    expect(result.cycleEdgeIds).toContain('e1')
    expect(result.cycleEdgeIds).toContain('e2')

    try {
      assertNoSupersedenceCycle(edges, candidate)
      expect.fail('Should have thrown WorkspaceError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WorkspaceError)
      const wErr = err as WorkspaceError
      expect(wErr.code).toBe(WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE)
      expect(wErr.message).toContain('Circular supersedence cycle detected')
    }
  })

  it('detects a 3-node circular supersedence cycle (A -> B -> C -> A)', () => {
    const edges: RelationalLedgerEntry[] = [
      createTestEdge('e1', 'A', 'B'),
      createTestEdge('e2', 'B', 'C')
    ]
    const candidate = createTestEdge('e3', 'C', 'A')

    const result = detectSupersedenceCycle(edges, candidate)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleEntities).toEqual(['A', 'B', 'C', 'A'])
    expect(result.cycleEdgeIds).toHaveLength(3)

    expect(() => assertNoSupersedenceCycle(edges, candidate)).toThrowError(
      /Circular supersedence cycle detected: A -> B -> C -> A/
    )
  })

  it('detects self-loop supersedence edge (A -> A)', () => {
    const edges: RelationalLedgerEntry[] = []
    const candidate = createTestEdge('e-self', 'LoopEntity', 'LoopEntity')

    const result = detectSupersedenceCycle(edges, candidate)
    expect(result.hasCycle).toBe(true)
    expect(result.cycleEntities).toEqual(['LoopEntity', 'LoopEntity'])
    expect(result.cycleEdgeIds).toEqual(['e-self'])
  })

  it('ignores non-supersedes relations when detecting cycles', () => {
    const edges: RelationalLedgerEntry[] = [
      createTestEdge('e1', 'A', 'B', 'supports'),
      createTestEdge('e2', 'B', 'C', 'contradicts')
    ]
    const candidate = createTestEdge('e3', 'C', 'A', 'supports')

    const result = detectSupersedenceCycle(edges, candidate)
    expect(result.hasCycle).toBe(false)
    expect(() => assertNoSupersedenceCycle(edges, candidate)).not.toThrow()
  })
})
