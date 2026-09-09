import { describe, it, expect } from 'vitest'
import {
  convertHtmlToBlocks,
  convertBlocksToPatchView,
  parseWikilinkContent
} from '../schemas/htmlContentConversion'
import { BlockSchema } from '@workspace/persistence/editorContent'
import { buildEditableBlocks } from '@collaragent/tools/WorkspaceTools'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import { syncDocumentClaimsToLedger } from '@workspace/wiki/LinkExtractor'

describe('Wikilink Conversion & Claim Badge Pipeline', () => {
  describe('parseWikilinkContent', () => {
    it('parses relation:target|justification format', () => {
      const badge = parseWikilinkContent('supports:Doc-Architecture|Verified with test suite')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('supports')
      expect(badge?.targetEntityId).toBe('Doc-Architecture')
      expect(badge?.justification).toBe('Verified with test suite')
      expect(badge?.badgeId).toBeDefined()
    })

    it('parses relation:target format without justification', () => {
      const badge = parseWikilinkContent('contradicts:Legacy-Spec')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('contradicts')
      expect(badge?.targetEntityId).toBe('Legacy-Spec')
      expect(badge?.justification).toBe('')
    })

    it('parses target|rel:relation|justification format', () => {
      const badge = parseWikilinkContent('Doc-Target|rel:supersedes|Upgrades to v4')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('supersedes')
      expect(badge?.targetEntityId).toBe('Doc-Target')
      expect(badge?.justification).toBe('Upgrades to v4')
    })

    it('parses target|relation|justification format', () => {
      const badge = parseWikilinkContent('Doc-Target|details|Hierarchical breakdown')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('details')
      expect(badge?.targetEntityId).toBe('Doc-Target')
      expect(badge?.justification).toBe('Hierarchical breakdown')
    })

    it('defaults to relates_to for target|justification without relation keyword', () => {
      const badge = parseWikilinkContent('Doc-Target|General context note')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('relates_to')
      expect(badge?.targetEntityId).toBe('Doc-Target')
      expect(badge?.justification).toBe('General context note')
    })

    it('defaults to relates_to for simple target name', () => {
      const badge = parseWikilinkContent('Doc-Target')
      expect(badge).not.toBeNull()
      expect(badge?.rel).toBe('relates_to')
      expect(badge?.targetEntityId).toBe('Doc-Target')
      expect(badge?.justification).toBe('')
    })

    it('returns null for empty or whitespace content', () => {
      expect(parseWikilinkContent('')).toBeNull()
      expect(parseWikilinkContent('   ')).toBeNull()
    })
  })

  describe('convertHtmlToBlocks with wikilinks', () => {
    it('parses inline wikilinks inside paragraph blocks into claim badges', () => {
      const html = `<p id="p1">Architecture [[supports:Doc-Storage|Matches multi-process isolation]] is confirmed.</p>`
      const blocks = convertHtmlToBlocks(html)

      expect(blocks).toHaveLength(1)
      const p = blocks[0]
      expect(p.type).toBe('paragraph')
      expect(p.id).toBe('p1')
      expect(p.children).toHaveLength(3)

      expect(p.children![0].text).toBe('Architecture ')
      expect(p.children![1].claimBadge).toEqual({
        badgeId: expect.any(String),
        rel: 'supports',
        targetEntityId: 'Doc-Storage',
        justification: 'Matches multi-process isolation'
      })
      expect(p.children![2].text).toBe(' is confirmed.')

      expect(() => BlockSchema.parse(p)).not.toThrow()
    })

    it('parses span with data-lexical-claim-badge into claim badges and ignores inner text', () => {
      const html = `<p id="p2">Evidence <span data-lexical-claim-badge="true" data-target-entity="Doc-Benchmark" data-rel="cites" data-justification="Page 12 table 2">⚡ cites: Doc-Benchmark</span> verified.</p>`
      const blocks = convertHtmlToBlocks(html)

      expect(blocks).toHaveLength(1)
      const p = blocks[0]
      expect(p.children).toHaveLength(3)
      expect(p.children![0].text).toBe('Evidence ')
      expect(p.children![1].claimBadge).toEqual({
        badgeId: expect.any(String),
        rel: 'cites',
        targetEntityId: 'Doc-Benchmark',
        justification: 'Page 12 table 2'
      })
      expect(p.children![2].text).toBe(' verified.')
    })

    it('parses wikilinks and formulas simultaneously without collision', () => {
      const html = `<p>Equation $E=mc^2$ [[derived_from:Einstein-1905|Special relativity]] and $$\\int_0^1 x dx$$.</p>`
      const blocks = convertHtmlToBlocks(html)

      expect(blocks).toHaveLength(1)
      const runs = blocks[0].children!
      expect(runs).toHaveLength(7)
      expect(runs[0].text).toBe('Equation ')
      expect(runs[1].equation).toBe('E=mc^2')
      expect(runs[1].inline).toBe(true)
      expect(runs[2].text).toBe(' ')
      expect(runs[3].claimBadge?.rel).toBe('derived_from')
      expect(runs[3].claimBadge?.targetEntityId).toBe('Einstein-1905')
      expect(runs[4].text).toBe(' and ')
      expect(runs[5].equation).toBe('\\int_0^1 x dx')
      expect(runs[5].inline).toBe(false)
      expect(runs[6].text).toBe('.')
    })

    it('parses wikilinks inside table cells', () => {
      const html = `<table>
        <thead>
          <tr><th>Component</th><th>Claim</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Storage V4</td>
            <td>Evaluation [[supports:Architecture-Spec|Zero data loss verified]]</td>
          </tr>
        </tbody>
      </table>`
      const blocks = convertHtmlToBlocks(html)
      expect(blocks).toHaveLength(1)
      const cellRuns = blocks[0].tableRows![1].cells[1].children!
      expect(cellRuns).toHaveLength(2)
      expect(cellRuns[0].text).toBe('Evaluation ')
      expect(cellRuns[1].claimBadge?.rel).toBe('supports')
      expect(cellRuns[1].claimBadge?.targetEntityId).toBe('Architecture-Spec')
    })
  })

  describe('PatchView & EditableBlocks Serialization', () => {
    it('serializes claim badges into wikilink syntax in convertBlocksToPatchView', () => {
      const blocks = convertHtmlToBlocks(
        `<p id="b1">System model [[supports:TargetDoc|Proof of stability]] is valid.</p>`
      )
      const patchView = convertBlocksToPatchView(blocks)
      expect(patchView).toBe(
        `<p data-block-id="b1">System model [[supports:TargetDoc|Proof of stability]] is valid.</p>`
      )
    })

    it('surfaces clean wikilink syntax in buildEditableBlocks for the LLM', () => {
      const blocks = convertHtmlToBlocks(
        `<p id="block-99">Analysis [[contradicts:OldDoc|New experimental finding]] recorded.</p>`
      )
      const editable = buildEditableBlocks(blocks)
      expect(editable).toHaveLength(1)
      expect(editable[0].id).toBe('block-99')
      expect(editable[0].html).toBe(
        `<p>Analysis [[contradicts:OldDoc|New experimental finding]] recorded.</p>`
      )
    })

    it('preserves claim badges across complete roundtrip', () => {
      const originalHtml = `<p id="rt1">Start [[details:SubComponent|Architecture details]] end.</p>`
      const blocks1 = convertHtmlToBlocks(originalHtml)
      const patchView = convertBlocksToPatchView(blocks1)
      const blocks2 = convertHtmlToBlocks(patchView)

      expect(blocks2).toHaveLength(1)
      expect(blocks2[0].children![1].claimBadge?.rel).toBe('details')
      expect(blocks2[0].children![1].claimBadge?.targetEntityId).toBe('SubComponent')
      expect(blocks2[0].children![1].claimBadge?.justification).toBe('Architecture details')
    })
  })

  describe('syncDocumentClaimsToLedger', () => {
    it('promotes extracted document claim badges into the relational ledger store', () => {
      const ledgerStore = new RelationalLedgerStore()
      const blocks = convertHtmlToBlocks(
        `<p id="block-anchor-1">Our engine [[supports:Spec-V4|P99 latency &lt; 2ms]] handles concurrent reads.</p>`
      )
      const doc = { blocks }

      const result = syncDocumentClaimsToLedger('Doc-Benchmarking', doc, ledgerStore)
      expect(result.activeClaims).toHaveLength(1)
      expect(result.promotedOrUpsertedEdgeIds).toHaveLength(1)

      const edges = ledgerStore.getAllEdges()
      expect(edges).toHaveLength(1)
      expect(edges[0].sourceEntityId).toBe('Doc-Benchmarking')
      expect(edges[0].targetEntityId).toBe('Spec-V4')
      expect(edges[0].rel).toBe('supports')
      expect(edges[0].provenance).toBe('document_claim')
      expect(edges[0].status).toBe('active')
      expect(edges[0].anchor?.blockId).toBe('block-anchor-1')
      expect(edges[0].anchor?.justification).toBe('P99 latency < 2ms')
    })
  })
})
