import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  bootstrapLegacyCanvasToLedger,
  bootstrapWorkspaceDirectory,
  mapLegacyRelationToClaimRelation
} from '../LegacyArchiveBootstrapper'
import { RelationalLedgerStore } from '../RelationalLedgerStore'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

describe('LegacyArchiveBootstrapper (Spec §7.8)', () => {
  let ledgerStore: RelationalLedgerStore
  let tempDir: string

  beforeEach(() => {
    ledgerStore = new RelationalLedgerStore()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collar-bootstrapper-test-'))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  describe('mapLegacyRelationToClaimRelation', () => {
    it('correctly maps various semantic aliases to typed ClaimRelations', () => {
      expect(mapLegacyRelationToClaimRelation('supports')).toBe('supports')
      expect(mapLegacyRelationToClaimRelation('Evidence')).toBe('supports')
      expect(mapLegacyRelationToClaimRelation('disproves')).toBe('contradicts')
      expect(mapLegacyRelationToClaimRelation('supersedes')).toBe('supersedes')
      expect(mapLegacyRelationToClaimRelation('replaces')).toBe('supersedes')
      expect(mapLegacyRelationToClaimRelation('elaborates')).toBe('details')
      expect(mapLegacyRelationToClaimRelation('references')).toBe('cites')
      expect(mapLegacyRelationToClaimRelation('derived_from')).toBe('derived_from')
      expect(mapLegacyRelationToClaimRelation('unknown_custom_link')).toBe('relates_to')
      expect(mapLegacyRelationToClaimRelation(undefined)).toBe('relates_to')
    })
  })

  describe('bootstrapLegacyCanvasToLedger', () => {
    it('synthesizes ledger entries from legacy canvas structure without data loss', () => {
      const legacyCanvas = {
        schemaVersion: 1,
        type: 'graph-canvas',
        graph: {
          nodes: {
            'node-101': { id: 'node-101', name: 'AttentionMechanism' },
            'node-102': { id: 'node-102', name: 'TransformerModel' },
            'node-103': { id: 'node-103', name: 'RecurrentNetwork' }
          },
          relationships: {
            'rel-1': {
              id: 'rel-1',
              from: { nodeId: 'node-102' },
              to: { nodeId: 'node-101' },
              attrs: { label: 'derived_from' }
            },
            'rel-2': {
              id: 'rel-2',
              from: { nodeId: 'node-102' },
              to: { nodeId: 'node-103' },
              attrs: { label: 'supersedes' }
            }
          }
        }
      }

      const entries = bootstrapLegacyCanvasToLedger(legacyCanvas, ledgerStore)

      expect(entries).toHaveLength(2)
      expect(ledgerStore.getAllEdges()).toHaveLength(2)

      const e1 = ledgerStore
        .getAllEdges()
        .find(
          (e) =>
            e.sourceEntityId === 'TransformerModel' && e.targetEntityId === 'AttentionMechanism'
        )
      expect(e1).toBeDefined()
      expect(e1?.rel).toBe('derived_from')
      expect(e1?.provenance).toBe('canvas_relational')
      expect(e1?.status).toBe('active')
      expect(e1?.meta.author).toBe('user')

      const e2 = ledgerStore
        .getAllEdges()
        .find(
          (e) => e.sourceEntityId === 'TransformerModel' && e.targetEntityId === 'RecurrentNetwork'
        )
      expect(e2).toBeDefined()
      expect(e2?.rel).toBe('supersedes')
    })

    it('handles legacy canvas with array-based edges and title attributes', () => {
      const arrayCanvas = {
        nodes: {
          n1: { id: 'n1', attrs: { title: 'FirstDoc' } },
          n2: { id: 'n2', attrs: { title: 'SecondDoc' } }
        },
        edges: [
          {
            id: 'edge-array-1',
            source: 'n1',
            target: 'n2',
            attrs: { rel: 'supports' }
          }
        ]
      }

      const entries = bootstrapLegacyCanvasToLedger(arrayCanvas, ledgerStore)
      expect(entries).toHaveLength(1)
      expect(entries[0].sourceEntityId).toBe('FirstDoc')
      expect(entries[0].targetEntityId).toBe('SecondDoc')
      expect(entries[0].rel).toBe('supports')
    })

    it('generates standard UUIDs when legacy edge id is not a valid UUID', () => {
      const legacyCanvas = {
        nodes: {
          n1: { id: 'n1', name: 'Doc1' },
          n2: { id: 'n2', name: 'Doc2' }
        },
        relationships: {
          'non-uuid-rel': {
            id: 'legacy-id-123',
            from: 'n1',
            to: 'n2',
            attrs: { label: 'supports' }
          }
        }
      }

      const entries = bootstrapLegacyCanvasToLedger(legacyCanvas, ledgerStore)
      expect(entries).toHaveLength(1)
      const UUID_V4_PATTERN =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      expect(entries[0].id).toMatch(UUID_V4_PATTERN)
    })
  })

  describe('bootstrapWorkspaceDirectory', () => {
    it('synthesizes and persists ledger-default.json when missing', async () => {
      const instancesDir = path.join(tempDir, 'instances')
      fs.mkdirSync(instancesDir, { recursive: true })

      const legacyCanvasPath = path.join(instancesDir, 'canvas-default.json')
      fs.writeFileSync(
        legacyCanvasPath,
        JSON.stringify({
          graph: {
            nodes: {
              'node-a': { name: 'ConceptA' },
              'node-b': { name: 'ConceptB' }
            },
            relationships: {
              'edge-1': {
                from: { nodeId: 'node-a' },
                to: { nodeId: 'node-b' },
                attrs: { label: 'supports' }
              }
            }
          }
        }),
        'utf8'
      )

      const res = await bootstrapWorkspaceDirectory(tempDir, ledgerStore)
      expect(res.bootstrapped).toBe(true)
      expect(res.entriesCount).toBe(1)

      const savedLedgerPath = path.join(instancesDir, 'ledger-default.json')
      expect(fs.existsSync(savedLedgerPath)).toBe(true)

      // Next run should detect existing ledger and load without bootstrapping
      const newStore = new RelationalLedgerStore()
      const secondRun = await bootstrapWorkspaceDirectory(tempDir, newStore)
      expect(secondRun.bootstrapped).toBe(false)
      expect(secondRun.entriesCount).toBe(1)
      expect(newStore.getAllEdges()[0].sourceEntityId).toBe('ConceptA')
    })

    it('throws WORKSPACE_WIKI_MIGRATION_FAILED on corrupt canvas JSON', async () => {
      const instancesDir = path.join(tempDir, 'instances')
      fs.mkdirSync(instancesDir, { recursive: true })

      const corruptCanvasPath = path.join(instancesDir, 'canvas-corrupt.json')
      fs.writeFileSync(corruptCanvasPath, '{ corrupted json : ', 'utf8')

      await expect(bootstrapWorkspaceDirectory(tempDir, ledgerStore)).rejects.toThrowError(
        expect.objectContaining({
          code: WorkspaceErrorCode.WORKSPACE_WIKI_MIGRATION_FAILED
        })
      )
    })
  })
})
