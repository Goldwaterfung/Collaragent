import { describe, it, expect } from 'vitest'
import { PatchCommandEngine } from '../PatchCommandEngine'

describe('PatchCommandEngine (Flaw #6 Attribute Preservation)', () => {
  it('preserves align="right" when updating a block with plain paragraph HTML', () => {
    // Initial patch view with right alignment
    const initialPatchView =
      '<p id="b1" data-block-id="b1" style="text-align: right">Original aligned text</p>'

    const result = PatchCommandEngine.compile(initialPatchView, [
      {
        action: 'update',
        blockId: 'b1',
        newHtml: '<p>Updated content without explicit style</p>'
      }
    ])

    expect(result.applied).toBe(true)
    if (result.applied) {
      // The emitted command must preserve align: 'right'
      const updateCmd = result.commands.find((c) => c.type === 'editor:update_block')
      expect(updateCmd).toBeDefined()
      expect(updateCmd?.changes).toMatchObject({
        align: 'right'
      })

      // The updated patch view HTML should retain the style attribute
      expect(result.updatedContent).toContain('style="text-align: right"')
      expect(result.updatedContent).toContain('Updated content without explicit style')
    }
  })

  it('preserves code block language when updating code block without data-language attribute', () => {
    const initialPatchView =
      '<pre id="b2" data-block-id="b2" data-language="typescript"><code>const x = 1</code></pre>'

    const result = PatchCommandEngine.compile(initialPatchView, [
      {
        action: 'update',
        blockId: 'b2',
        newHtml: '<pre><code>const x = 2; const y = 3;</code></pre>'
      }
    ])

    expect(result.applied).toBe(true)
    if (result.applied) {
      const updateCmd = result.commands.find((c) => c.type === 'editor:update_block')
      expect(updateCmd).toBeDefined()
      expect(updateCmd?.changes).toMatchObject({
        language: 'typescript'
      })
      expect(result.updatedContent).toContain('data-language="typescript"')
    }
  })

  describe('replace_text surgical in-block replacement', () => {
    it('replaces target text while preserving block attributes', () => {
      const initialPatchView =
        '<p id="b1" data-block-id="b1" style="text-align: center">The result was p &lt; 0.05 in test.</p>'

      const result = PatchCommandEngine.compile(initialPatchView, [
        {
          action: 'replace_text',
          blockId: 'b1',
          target: 'p &lt; 0.05',
          replacement: 'p &lt; 0.01'
        }
      ])

      expect(result.applied).toBe(true)
      if (result.applied) {
        expect(result.stats.blocksUpdated).toBe(1)
        const updateCmd = result.commands.find((c) => c.type === 'editor:update_block')
        expect(updateCmd).toBeDefined()
        expect(updateCmd?.changes).toMatchObject({
          align: 'center'
        })
        expect(result.updatedContent).toContain('p &lt; 0.01')
        expect(result.updatedContent).toContain('style="text-align: center"')
      }
    })

    it('fails with PATCH_CONTEXT_MISMATCH if blockId does not exist', () => {
      const initialPatchView = '<p id="b1" data-block-id="b1">Existing text</p>'

      const result = PatchCommandEngine.compile(initialPatchView, [
        {
          action: 'replace_text',
          blockId: 'missing-blk',
          target: 'Existing',
          replacement: 'New'
        }
      ])

      expect(result.applied).toBe(false)
      if (!result.applied) {
        expect(result.code).toBe('PATCH_CONTEXT_MISMATCH')
        expect(result.message).toContain('Could not find block missing-blk')
      }
    })

    it('fails with PATCH_CONTEXT_MISMATCH if target text is not in block', () => {
      const initialPatchView = '<p id="b1" data-block-id="b1">Existing text</p>'

      const result = PatchCommandEngine.compile(initialPatchView, [
        {
          action: 'replace_text',
          blockId: 'b1',
          target: 'Nonexistent substring',
          replacement: 'New'
        }
      ])

      expect(result.applied).toBe(false)
      if (!result.applied) {
        expect(result.code).toBe('PATCH_CONTEXT_MISMATCH')
        expect(result.message).toContain(
          'Target text "Nonexistent substring" was not found in block b1'
        )
      }
    })

    it('fails with INVALID_PATCH if target or replacement is omitted', () => {
      const initialPatchView = '<p id="b1" data-block-id="b1">Existing text</p>'

      const result = PatchCommandEngine.compile(initialPatchView, [
        {
          action: 'replace_text',
          blockId: 'b1'
        }
      ])

      expect(result.applied).toBe(false)
      if (!result.applied) {
        expect(result.code).toBe('INVALID_PATCH')
        expect(result.message).toContain('both "target" and "replacement" are required')
      }
    })
  })
})
