import { describe, it, expect } from 'vitest'
import { InverseCommandEngine } from '../InverseCommandEngine'
import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import { RelationalLedgerEntry } from '@shared/wiki'

const mockEntryA: RelationalLedgerEntry = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  sourceEntityId: 'doc-source',
  targetEntityId: 'doc-target',
  relationshipType: 'supports',
  anchor: {
    blockId: 'blk-1',
    justification: 'evidence from source'
  },
  status: 'active',
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z'
}

const mockEntryB: RelationalLedgerEntry = {
  ...mockEntryA,
  relationshipType: 'contradicts',
  updatedAt: '2026-09-08T01:00:00.000Z'
}

describe('InverseCommandEngine - Ledger Commands (ADR-005)', () => {
  it('inverts ledger:upsert_edge to ledger:remove_edge when edge was newly created (existed: false)', () => {
    const logEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 1 },
      command: {
        type: 'ledger:upsert_edge',
        entry: mockEntryA
      },
      previousState: {
        existed: false
      }
    }

    const inverse = InverseCommandEngine.invert(logEntry)
    expect(inverse).toEqual({
      type: 'ledger:remove_edge',
      edgeId: mockEntryA.id
    })
  })

  it('inverts ledger:upsert_edge to ledger:upsert_edge when edge previously existed (existed: true)', () => {
    const logEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 2 },
      command: {
        type: 'ledger:upsert_edge',
        entry: mockEntryB
      },
      previousState: {
        existed: true,
        entry: mockEntryA
      }
    }

    const inverse = InverseCommandEngine.invert(logEntry)
    expect(inverse).toEqual({
      type: 'ledger:upsert_edge',
      entry: mockEntryA
    })
  })

  it('inverts ledger:remove_edge to ledger:upsert_edge with removedEntry', () => {
    const logEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 3 },
      command: {
        type: 'ledger:remove_edge',
        edgeId: mockEntryA.id
      },
      previousState: {
        removedEntry: mockEntryA
      }
    }

    const inverse = InverseCommandEngine.invert(logEntry)
    expect(inverse).toEqual({
      type: 'ledger:upsert_edge',
      entry: mockEntryA
    })
  })

  it('inverts ledger:degrade_edge to ledger:restore_edge with previousAnchor', () => {
    const logEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 4 },
      command: {
        type: 'ledger:degrade_edge',
        edgeId: mockEntryA.id,
        reason: 'anchor_lost'
      },
      previousState: {
        previousAnchor: {
          blockId: 'blk-1',
          justification: 'evidence from source',
          selectedTextSnippet: 'quoted sentence'
        }
      }
    }

    const inverse = InverseCommandEngine.invert(logEntry)
    expect(inverse).toEqual({
      type: 'ledger:restore_edge',
      edgeId: mockEntryA.id,
      anchor: {
        blockId: 'blk-1',
        justification: 'evidence from source',
        selectedTextSnippet: 'quoted sentence'
      }
    })
  })

  it('inverts ledger:restore_edge to ledger:degrade_edge when previousStatus was anchor_lost', () => {
    const logEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 5 },
      command: {
        type: 'ledger:restore_edge',
        edgeId: mockEntryA.id,
        anchor: {
          blockId: 'blk-2',
          justification: 're-anchored'
        }
      },
      previousState: {
        previousStatus: 'anchor_lost'
      }
    }

    const inverse = InverseCommandEngine.invert(logEntry)
    expect(inverse).toEqual({
      type: 'ledger:degrade_edge',
      edgeId: mockEntryA.id,
      reason: 'anchor_lost'
    })
  })

  it('returns null if required previousState is missing', () => {
    const missingStateEntry: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 6 },
      command: {
        type: 'ledger:upsert_edge',
        entry: mockEntryA
      },
      previousState: {}
    }

    expect(InverseCommandEngine.invert(missingStateEntry)).toBeNull()

    const missingRemoveState: WorkspaceCommandLogEntry = {
      instanceId: 'inst-ledger',
      instanceType: 'ledger',
      projectId: 'proj-1',
      cursor: { seq: 7 },
      command: {
        type: 'ledger:remove_edge',
        edgeId: mockEntryA.id
      }
    }
    expect(InverseCommandEngine.invert(missingRemoveState)).toBeNull()
  })
})
