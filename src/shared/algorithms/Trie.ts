export class TrieNode<T> {
  children: Map<string, TrieNode<T>> = new Map();
  isEndOfWord: boolean = false;
  values: T[] = []; // Allow multiple items with same name (e.g. same filename in diff projects)
}

export class Trie<T> {
  root: TrieNode<T> = new TrieNode();
  
  insert(key: string, value: T) {
      if (!key) return;
      let node = this.root;
      const normalizedKey = key.toLowerCase();
      for (const char of normalizedKey) {
          if (!node.children.has(char)) {
              node.children.set(char, new TrieNode());
          }
          node = node.children.get(char)!;
      }
      node.isEndOfWord = true;
      node.values.push(value);
  }

  // Returns all items that start with 'prefix'
  search(prefix: string): T[] {
      if (!prefix) return [];
      let node = this.root;
      const normalizedPrefix = prefix.toLowerCase();
      for (const char of normalizedPrefix) {
          if (!node.children.has(char)) {
              return [];
          }
          node = node.children.get(char)!;
      }
      return this._collect(node);
  }
  
  private _collect(node: TrieNode<T>): T[] {
      let results: T[] = [];
      if (node.isEndOfWord) {
          results.push(...node.values);
      }
      for (const child of node.children.values()) {
            results.push(...this._collect(child));
      }
      return results;
  }
}
