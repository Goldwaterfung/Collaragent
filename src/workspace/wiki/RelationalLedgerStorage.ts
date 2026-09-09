import fs from 'node:fs/promises'
import path from 'node:path'
import { RelationalLedgerStore } from './RelationalLedgerStore'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

/**
 * Loads the ledger from .collar/instances/ledger-default.json.
 * If the file does not exist, initializes an empty ledger without error.
 */
export async function loadLedgerFromFile(
  store: RelationalLedgerStore,
  filePath: string
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const json = JSON.parse(content) as unknown
    store.loadFromSnapshot(json)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      store.clear()
      return
    }
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED,
      `Failed to load relational ledger from "${filePath}": ${(err as Error).message}`,
      { cause: err as Error }
    )
  }
}

/**
 * Persists the ledger snapshot to disk at .collar/instances/ledger-default.json atomically.
 */
export async function saveLedgerToFile(
  store: RelationalLedgerStore,
  filePath: string
): Promise<void> {
  try {
    const snapshot = store.exportSnapshot()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpPath = `${filePath}.${Date.now()}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (err: unknown) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED,
      `Failed to persist relational ledger to "${filePath}": ${(err as Error).message}`,
      { cause: err as Error }
    )
  }
}

// Automatically bind file persistence delegates for Node.js environments
RelationalLedgerStore.fileLoader = loadLedgerFromFile
RelationalLedgerStore.fileSaver = saveLedgerToFile
