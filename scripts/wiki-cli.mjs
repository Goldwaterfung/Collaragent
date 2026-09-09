#!/usr/bin/env node
/**
 * scripts/wiki-cli.mjs
 * Lightweight runner script for Workspace-as-Wiki CLI with TypeScript path alias resolution.
 */

import { createJiti } from 'jiti'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const jiti = createJiti(rootDir, {
  alias: {
    '@shared': path.resolve(rootDir, 'src/shared'),
    '@workspace': path.resolve(rootDir, 'src/workspace'),
    '@collaragent': path.resolve(rootDir, 'src/collaragent'),
    '@main': path.resolve(rootDir, 'src/main')
  }
})

try {
  const cliModule = await jiti.import('./src/workspace/wiki/cli.ts')
  if (cliModule && typeof cliModule.main === 'function') {
    await cliModule.main(process.argv.slice(2))
  }
} catch (err) {
  console.error('[wiki-cli] Execution failed:', err)
  process.exit(1)
}
