import type { Block } from '@workspace/persistence/editorContent'

export interface SearchResult {
  documentId: string
  documentTitle: string
  score: number
  matchedTerms: string[]
  snippet: string
}

interface IndexedDocument {
  id: string
  title: string
  rawText: string
  termFrequencies: Map<string, number>
  length: number
}

class TrieNode {
  children = new Map<string, TrieNode>()
  isEndOfWord = false
}

/**
 * Trie for fast prefix-based token search and autocompletion.
 */
export class TokenTrie {
  private root = new TrieNode()

  insert(word: string): void {
    let current = this.root
    for (const char of word.toLowerCase()) {
      let next = current.children.get(char)
      if (!next) {
        next = new TrieNode()
        current.children.set(char, next)
      }
      current = next
    }
    current.isEndOfWord = true
  }

  findWordsWithPrefix(prefix: string, maxResults = 10): string[] {
    let current = this.root
    const normalizedPrefix = prefix.toLowerCase()
    for (const char of normalizedPrefix) {
      const next = current.children.get(char)
      if (!next) return []
      current = next
    }

    const results: string[] = []
    this.collectWords(current, normalizedPrefix, results, maxResults)
    return results
  }

  private collectWords(
    node: TrieNode,
    currentWord: string,
    results: string[],
    maxResults: number
  ): void {
    if (results.length >= maxResults) return
    if (node.isEndOfWord) {
      results.push(currentWord)
    }
    for (const [char, child] of node.children.entries()) {
      if (results.length >= maxResults) break
      this.collectWords(child, currentWord + char, results, maxResults)
    }
  }

  remove(word: string): void {
    const normalized = word.toLowerCase()
    if (!normalized) return

    const path: Array<{ parent: TrieNode; char: string; node: TrieNode }> = []
    let current = this.root

    for (const char of normalized) {
      const next = current.children.get(char)
      if (!next) return
      path.push({ parent: current, char, node: next })
      current = next
    }

    if (!current.isEndOfWord) return

    current.isEndOfWord = false

    // Prune unreferenced nodes from bottom up
    for (let i = path.length - 1; i >= 0; i--) {
      const { parent, char, node } = path[i]
      if (node.isEndOfWord || node.children.size > 0) {
        break
      }
      parent.children.delete(char)
    }
  }

  clear(): void {
    this.root = new TrieNode()
  }
}

/**
 * In-memory BM25 Inverted Index & Trie Search Manager for workspace wiki documents.
 */
export class InvertedIndexManager {
  private readonly documents = new Map<string, IndexedDocument>()
  private readonly invertedIndex = new Map<string, Set<string>>()
  private readonly trie = new TokenTrie()

  // BM25 parameters
  private readonly k1 = 1.2
  private readonly b = 0.75

  /**
   * Tokenizes text into normalized lowercase alphanumeric terms.
   */
  public tokenize(text: string): string[] {
    const rawTokens = text.toLowerCase().match(/[a-z0-9_\-]+/g) ?? []
    return rawTokens.filter((token) => token.length > 1)
  }

  /**
   * Extracts raw text from blocks or accepts raw text directly.
   */
  private extractText(content: Block[] | string): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    const parts: string[] = []
    for (const block of content) {
      if (block.children && Array.isArray(block.children)) {
        for (const child of block.children) {
          if (child.text) parts.push(child.text)
          if (child.claimBadge?.justification) parts.push(child.claimBadge.justification)
        }
      }
      if (block.tableRows && Array.isArray(block.tableRows)) {
        for (const row of block.tableRows) {
          for (const cell of row.cells) {
            if (cell.children && Array.isArray(cell.children)) {
              for (const child of cell.children) {
                if (child.text) parts.push(child.text)
              }
            }
          }
        }
      }
    }
    return parts.join(' ')
  }

  /**
   * Adds or updates a document in the inverted index.
   */
  public addDocument(documentId: string, documentTitle: string, content: Block[] | string): void {
    this.removeDocument(documentId)

    const rawText = `${documentTitle} ${this.extractText(content)}`
    const tokens = this.tokenize(rawText)
    const termFrequencies = new Map<string, number>()

    for (const token of tokens) {
      termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1)
      this.trie.insert(token)

      let docSet = this.invertedIndex.get(token)
      if (!docSet) {
        docSet = new Set<string>()
        this.invertedIndex.set(token, docSet)
      }
      docSet.add(documentId)
    }

    this.documents.set(documentId, {
      id: documentId,
      title: documentTitle,
      rawText,
      termFrequencies,
      length: tokens.length
    })
  }

  /**
   * Removes a document from the inverted index.
   */
  public removeDocument(documentId: string): void {
    const existing = this.documents.get(documentId)
    if (!existing) return

    for (const token of existing.termFrequencies.keys()) {
      const docSet = this.invertedIndex.get(token)
      if (docSet) {
        docSet.delete(documentId)
        if (docSet.size === 0) {
          this.invertedIndex.delete(token)
          this.trie.remove(token)
        }
      }
    }

    this.documents.delete(documentId)
  }

  /**
   * Clears all indexed documents and indices.
   */
  public clear(): void {
    this.documents.clear()
    this.invertedIndex.clear()
    this.trie.clear()
  }

  /**
   * Returns total count of indexed documents.
   */
  public getDocumentCount(): number {
    return this.documents.size
  }

  /**
   * Executes BM25 search across all indexed documents.
   */
  public search(query: string, limit = 10): SearchResult[] {
    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0 || this.documents.size === 0) {
      return []
    }

    // Calculate Average Document Length (avgdl)
    let totalLength = 0
    for (const doc of this.documents.values()) {
      totalLength += doc.length
    }
    const avgdl = totalLength / this.documents.size
    const totalDocs = this.documents.size

    // Identify candidate documents containing at least one query token
    const candidateDocIds = new Set<string>()
    for (const token of queryTokens) {
      const matchingDocs = this.invertedIndex.get(token)
      if (matchingDocs) {
        for (const docId of matchingDocs) {
          candidateDocIds.add(docId)
        }
      }
    }

    const scores: Array<{ doc: IndexedDocument; score: number; matchedTerms: string[] }> = []

    for (const docId of candidateDocIds) {
      const doc = this.documents.get(docId)
      if (!doc) continue

      let score = 0
      const matchedTerms: string[] = []

      for (const token of queryTokens) {
        const tf = doc.termFrequencies.get(token) ?? 0
        if (tf > 0) {
          matchedTerms.push(token)
          const docFreq = this.invertedIndex.get(token)?.size ?? 0
          // Standard BM25 Robertson-Spärck Jones IDF
          const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1)
          const numerator = tf * (this.k1 + 1)
          const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / (avgdl || 1)))
          score += idf * (numerator / denominator)
        }
      }

      if (score > 0) {
        scores.push({ doc, score, matchedTerms })
      }
    }

    scores.sort((a, b) => b.score - a.score)
    const top = scores.slice(0, limit)

    return top.map(({ doc, score, matchedTerms }) => ({
      documentId: doc.id,
      documentTitle: doc.title,
      score: Number(score.toFixed(4)),
      matchedTerms,
      snippet: this.generateSnippet(doc.rawText, matchedTerms)
    }))
  }

  /**
   * Generates a context snippet around the first matched term.
   */
  private generateSnippet(rawText: string, matchedTerms: string[]): string {
    if (matchedTerms.length === 0) {
      return rawText.slice(0, 160)
    }

    const lower = rawText.toLowerCase()
    let earliestIndex = -1
    for (const term of matchedTerms) {
      const idx = lower.indexOf(term)
      if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
        earliestIndex = idx
      }
    }

    if (earliestIndex === -1) {
      return rawText.slice(0, 160)
    }

    const start = Math.max(0, earliestIndex - 60)
    const end = Math.min(rawText.length, earliestIndex + 100)
    const prefix = start > 0 ? '...' : ''
    const suffix = end < rawText.length ? '...' : ''
    return `${prefix}${rawText.slice(start, end).trim()}${suffix}`
  }

  /**
   * Finds tokens starting with prefix using Trie.
   */
  public autocomplete(prefix: string, maxResults = 10): string[] {
    return this.trie.findWordsWithPrefix(prefix, maxResults)
  }
}
