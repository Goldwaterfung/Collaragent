/**
 * ProjectLockManager: Single-Writer File Lock with Dead PID Auto-Recovery
 * Conforms to docs/sqlite-storage-architecture/spec.md Section 6.3 (HR-INV-02),
 * storage-engine-design.md Section 7.1, and .agents/rules/coding-rules.md (Zero any, structured errors).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

export interface ProjectLockData {
  readonly pid: number
  readonly timestamp: number
  readonly host: string
}

export interface ProjectLockManagerOptions {
  readonly isProcessAlive?: (pid: number) => boolean
}

/**
 * Checks if a process with the specified PID is currently alive on the host.
 * Uses process.kill(pid, 0) with POSIX error code discrimination:
 * - ESRCH: Process does not exist (dead)
 * - EPERM: Process exists but current process lacks permission to signal it (alive)
 * - No error: Process exists (alive)
 */
export function isProcessAlive(pid: number): boolean {
  if (pid <= 0 || !Number.isInteger(pid)) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    if (err !== null && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: unknown }).code
      if (code === 'ESRCH') {
        return false
      }
      if (code === 'EPERM') {
        return true
      }
    }
    return false
  }
}

function isProjectLockData(value: unknown): value is ProjectLockData {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const obj = value as Record<string, unknown>
  return (
    typeof obj.pid === 'number' && typeof obj.timestamp === 'number' && typeof obj.host === 'string'
  )
}

export class ProjectLockManager {
  private readonly checkProcessAlive: (pid: number) => boolean
  private currentLockPath: string | null = null
  private currentCagentPath: string | null = null

  constructor(options?: ProjectLockManagerOptions) {
    this.checkProcessAlive = options?.isProcessAlive ?? isProcessAlive
  }

  public get activeLockPath(): string | null {
    return this.currentLockPath
  }

  public get activeCagentPath(): string | null {
    return this.currentCagentPath
  }

  /**
   * Computes the standardized companion lock file path (<path>.lock).
   */
  public getLockPath(cagentPath: string): string {
    return cagentPath.endsWith('.lock') ? cagentPath : `${cagentPath}.lock`
  }

  /**
   * Reads and parses the lock file payload, returning null if the lock file does not exist or is invalid.
   */
  public async getLockData(cagentPath: string): Promise<ProjectLockData | null> {
    const lockPath = this.getLockPath(cagentPath)
    try {
      const content = await fs.promises.readFile(lockPath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      if (isProjectLockData(parsed)) {
        return parsed
      }
      // Backward compatibility for legacy lock files with { pid, time }
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'pid' in parsed &&
        typeof (parsed as Record<string, unknown>).pid === 'number'
      ) {
        const obj = parsed as Record<string, unknown>
        return {
          pid: obj.pid as number,
          timestamp:
            typeof obj.timestamp === 'number'
              ? obj.timestamp
              : typeof obj.time === 'number'
                ? obj.time
                : Date.now(),
          host: typeof obj.host === 'string' ? obj.host : os.hostname()
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Checks whether the given project is actively locked by a running process.
   */
  public async isLocked(cagentPath: string): Promise<boolean> {
    const lockData = await this.getLockData(cagentPath)
    if (!lockData) {
      return false
    }

    // If locked on another host, assume active conflict
    if (lockData.host && lockData.host !== os.hostname()) {
      return true
    }

    return this.checkProcessAlive(lockData.pid)
  }

  /**
   * Acquires the single-writer lock for the given .cagent project path.
   * If a lock exists:
   * - Checks PID liveness.
   * - If the recorded PID is dead, auto-recovers the stale lock.
   * - If the recorded PID is alive and force is false, throws StorageError(STORAGE_LOCK_CONFLICT).
   * - If force is true, overwrites the lock.
   */
  public async acquire(cagentPath: string, options?: { force?: boolean }): Promise<void> {
    const lockPath = this.getLockPath(cagentPath)
    const existingLock = await this.getLockData(cagentPath)

    if (existingLock !== null) {
      const isCurrentProcess = existingLock.pid === process.pid
      const isSameHost = !existingLock.host || existingLock.host === os.hostname()

      if (isCurrentProcess) {
        // Lock already held by this process, refresh timestamp
        this.currentLockPath = lockPath
        this.currentCagentPath = cagentPath
        await this.writeLockFile(lockPath)
        return
      }

      const active = isSameHost ? this.checkProcessAlive(existingLock.pid) : true

      if (active) {
        if (!options?.force) {
          throw new StorageError(
            StorageErrorCode.STORAGE_LOCK_CONFLICT,
            `Project file is currently locked by active process (PID: ${existingLock.pid}, host: ${existingLock.host})`,
            { lockData: existingLock, lockPath }
          )
        }
        // Force takeover requested: proceed to overwrite
      } else {
        // Stale lock detected (dead PID) -> auto-recover
        try {
          await fs.promises.unlink(lockPath)
        } catch {
          // Ignore unlink failure if already gone
        }
      }
    }

    await this.writeLockFile(lockPath)
    this.currentLockPath = lockPath
    this.currentCagentPath = cagentPath
  }

  /**
   * Releases the lock file if it is owned by the current process.
   */
  public async release(cagentPath?: string): Promise<void> {
    const targetPath = cagentPath ? this.getLockPath(cagentPath) : this.currentLockPath
    if (!targetPath) {
      return
    }

    try {
      const lockData = await this.getLockData(targetPath)
      // Only delete if lock file does not exist, or is owned by current PID
      if (lockData === null || lockData.pid === process.pid) {
        await fs.promises.unlink(targetPath)
      }
    } catch {
      // Ignore cleanup error if already removed
    } finally {
      if (this.currentLockPath === targetPath) {
        this.currentLockPath = null
        this.currentCagentPath = null
      }
    }
  }

  private async writeLockFile(lockPath: string): Promise<void> {
    const dir = path.dirname(lockPath)
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true })
    }

    const payload: ProjectLockData = {
      pid: process.pid,
      timestamp: Date.now(),
      host: os.hostname()
    }

    const tempPath = `${lockPath}.tmp.${process.pid}.${Date.now()}`
    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
      await fs.promises.rename(tempPath, lockPath)
    } catch (err: unknown) {
      try {
        if (fs.existsSync(tempPath)) {
          await fs.promises.unlink(tempPath)
        }
      } catch {
        // Ignore temp cleanup error
      }
      const cause = err instanceof Error ? err : new Error(String(err))
      throw new StorageError(
        StorageErrorCode.STORAGE_LOCK_ACQUISITION_FAILED,
        `Failed to write lock file at ${lockPath}: ${cause.message}`,
        { lockPath, cause },
        cause
      )
    }
  }
}
