#!/usr/bin/env node
/**
 * scripts/run-eval.mjs
 * Lightweight runner script for headless evaluation CLI with TypeScript path alias resolution.
 */

import { createJiti } from 'jiti';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load .env.eval or .env if present for headless evaluation runs
function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('export ')) {
        trimmed = trimmed.slice(7).trim();
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.resolve(rootDir, '.env.eval'));
loadEnvFile(path.resolve(rootDir, '.env'));

const jiti = createJiti(rootDir, {
  alias: {
    '@shared': path.resolve(rootDir, 'src/shared'),
    '@workspace': path.resolve(rootDir, 'src/workspace'),
    '@collaragent': path.resolve(rootDir, 'src/collaragent'),
    '@evals': path.resolve(rootDir, 'evals'),
    '@main': path.resolve(rootDir, 'src/main'),
  },
});

try {
  const cliModule = await jiti.import('./evals/cli.ts');
  if (cliModule && typeof cliModule.main === 'function') {
    await cliModule.main(process.argv.slice(2));
  }
} catch (error) {
  console.error('Execution error in evaluation harness:', error);
  process.exit(1);
}

