import { describe, it, expect, beforeEach } from 'vitest'
import { InvertedIndexManager, TokenTrie } from '../InvertedIndexManager'
import type { Block } from '@workspace/persistence/editorContent'

describe('InvertedIndexManager (BM25 & Trie)', () => {
  let indexManager: InvertedIndexManager

  beforeEach(() => {
    indexManager = new InvertedIndexManager()
  })

  it('indexes documents and calculates BM25 ranking accurately', () => {
    const doc1Blocks: Block[] = [
      {
        id: 'b1',
        type: 'h1',
        children: [{ text: 'Vision Transformer Architecture' }]
      },
      {
        id: 'b2',
        type: 'paragraph',
        children: [
          { text: 'Vision Transformer uses self-attention patches for computer vision tasks.' }
        ]
      }
    ]

    const doc2Blocks: Block[] = [
      {
        id: 'b3',
        type: 'h1',
        children: [{ text: 'Convolutional Neural Networks' }]
      },
      {
        id: 'b4',
        type: 'paragraph',
        children: [{ text: 'CNNs use sliding kernel convolutional filters for vision features.' }]
      }
    ]

    indexManager.addDocument('doc-vit', 'Vision Transformer', doc1Blocks)
    indexManager.addDocument('doc-cnn', 'Convolutional Neural Networks', doc2Blocks)
    expect(indexManager.getDocumentCount()).toBe(2)

    // Query for "transformer self-attention"
    const results = indexManager.search('transformer self-attention')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].documentId).toBe('doc-vit')
    expect(results[0].matchedTerms).toContain('transformer')
    expect(results[0].matchedTerms).toContain('self-attention')
    expect(results[0].snippet).toContain('Vision Transformer')

    // Query for "convolutional"
    const cnnResults = indexManager.search('convolutional')
    expect(cnnResults.length).toBeGreaterThan(0)
    expect(cnnResults[0].documentId).toBe('doc-cnn')
  })

  it('removes documents and updates term sets cleanly', () => {
    indexManager.addDocument('doc-1', 'Doc One', 'Quantum computing qubits entanglement')
    indexManager.addDocument('doc-2', 'Doc Two', 'Classical computing bits silicon')

    expect(indexManager.search('quantum').length).toBe(1)
    indexManager.removeDocument('doc-1')
    expect(indexManager.search('quantum').length).toBe(0)
    expect(indexManager.getDocumentCount()).toBe(1)
  })

  it('supports prefix autocompletion via Trie', () => {
    indexManager.addDocument('d1', 'Doc', 'transformer translation tensor train')
    const completions = indexManager.autocomplete('tr')
    expect(completions).toContain('transformer')
    expect(completions).toContain('translation')
    expect(completions).toContain('train')
  })

  it('prunes vocabulary from Trie when documents are removed', () => {
    indexManager.addDocument('doc-1', 'Doc One', 'zebra quantum entanglement')
    indexManager.addDocument('doc-2', 'Doc Two', 'quantum mechanics electron')

    expect(indexManager.autocomplete('ze')).toEqual(['zebra'])
    expect(indexManager.autocomplete('qu')).toEqual(['quantum'])

    // Remove doc-1: unique word 'zebra' must be pruned, shared word 'quantum' must remain
    indexManager.removeDocument('doc-1')
    expect(indexManager.autocomplete('ze')).toEqual([])
    expect(indexManager.autocomplete('qu')).toEqual(['quantum'])

    // Remove doc-2: 'quantum' now has zero documents referencing it and must be pruned
    indexManager.removeDocument('doc-2')
    expect(indexManager.autocomplete('qu')).toEqual([])
    expect(indexManager.autocomplete('el')).toEqual([])
  })

  describe('TokenTrie', () => {
    it('correctly prunes branches upon remove without altering other words', () => {
      const trie = new TokenTrie()
      trie.insert('cat')
      trie.insert('cats')
      trie.insert('car')

      expect(trie.findWordsWithPrefix('ca')).toEqual(['cat', 'cats', 'car'])

      trie.remove('cats')
      expect(trie.findWordsWithPrefix('ca')).toEqual(['cat', 'car'])

      trie.remove('cat')
      expect(trie.findWordsWithPrefix('ca')).toEqual(['car'])

      trie.remove('car')
      expect(trie.findWordsWithPrefix('ca')).toEqual([])
    })

    it('handles removal of non-existent words or empty prefixes gracefully', () => {
      const trie = new TokenTrie()
      trie.insert('dog')
      trie.remove('cat')
      trie.remove('d')
      trie.remove('')
      expect(trie.findWordsWithPrefix('do')).toEqual(['dog'])
    })
  })
})
