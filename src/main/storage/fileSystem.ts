import fs from 'fs';
import path from 'path';

/**
 * Core filesystem utilities for the main process.
 */
export const fileSystem = {
  exists(p: string): boolean {
    return fs.existsSync(p);
  },

  ensureDir(p: string): void {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  },

  readFile(p: string): string {
    return fs.readFileSync(p, 'utf-8');
  },

  writeFile(p: string, content: string): void {
    this.ensureDir(path.dirname(p));
    fs.writeFileSync(p, content, 'utf-8');
  }
};
