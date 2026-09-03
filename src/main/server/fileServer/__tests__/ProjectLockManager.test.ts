import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ProjectLockManager,
  isProcessAlive,
  type ProjectLockData
} from '../locks/ProjectLockManager'
import { StorageError, StorageErrorCode } from '../errors/StorageErrors'

describe('ProjectLockManager', () => {
  const testDir = path.join(
    os.tmpdir(),
    `collar-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const projectPath = path.join(testDir, 'test-project.cagent')
  const lockFilePath = `${projectPath}.lock`

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true)
    })

    it('returns false for invalid or dead PIDs', () => {
      expect(isProcessAlive(0)).toBe(false)
      expect(isProcessAlive(-1)).toBe(false)
      expect(isProcessAlive(NaN)).toBe(false)
      // Extremely large PID unlikely to exist
      expect(isProcessAlive(9999999)).toBe(false)
    })
  })

  describe('acquire and release', () => {
    it('cleanly acquires and releases a lock', async () => {
      const lockManager = new ProjectLockManager()

      expect(await lockManager.isLocked(projectPath)).toBe(false)
      expect(await lockManager.getLockData(projectPath)).toBeNull()

      await lockManager.acquire(projectPath)

      expect(await lockManager.isLocked(projectPath)).toBe(true)
      const lockData = await lockManager.getLockData(projectPath)
      expect(lockData).not.toBeNull()
      expect(lockData?.pid).toBe(process.pid)
      expect(lockData?.host).toBe(os.hostname())
      expect(typeof lockData?.timestamp).toBe('number')

      await lockManager.release()

      expect(await lockManager.isLocked(projectPath)).toBe(false)
      expect(await lockManager.getLockData(projectPath)).toBeNull()
    })

    it('re-acquiring with same process refreshes lock without error', async () => {
      const lockManager = new ProjectLockManager()
      await lockManager.acquire(projectPath)

      const firstData = await lockManager.getLockData(projectPath)
      expect(firstData?.pid).toBe(process.pid)

      // Acquire again
      await lockManager.acquire(projectPath)
      const secondData = await lockManager.getLockData(projectPath)
      expect(secondData?.pid).toBe(process.pid)

      await lockManager.release()
    })

    it('creates missing directories when acquiring lock', async () => {
      const nestedPath = path.join(testDir, 'nested', 'deep', 'project.cagent')
      const lockManager = new ProjectLockManager()

      await lockManager.acquire(nestedPath)
      expect(await lockManager.isLocked(nestedPath)).toBe(true)

      await lockManager.release(nestedPath)
      expect(await lockManager.isLocked(nestedPath)).toBe(false)
    })
  })

  describe('concurrency conflict and dead PID auto-recovery', () => {
    it('auto-recovers stale lock when recorded PID is dead', async () => {
      // Simulate dead PID
      const deadPid = 9999998
      const staleLock: ProjectLockData = {
        pid: deadPid,
        timestamp: Date.now() - 60000,
        host: os.hostname()
      }
      await fs.promises.writeFile(lockFilePath, JSON.stringify(staleLock, null, 2), 'utf8')

      const lockManager = new ProjectLockManager({
        isProcessAlive: (pid: number) => pid !== deadPid && pid === process.pid
      })

      // isLocked should return false because process is dead
      expect(await lockManager.isLocked(projectPath)).toBe(false)

      // acquire should auto-recover without throwing
      await lockManager.acquire(projectPath)

      const currentLock = await lockManager.getLockData(projectPath)
      expect(currentLock?.pid).toBe(process.pid)

      await lockManager.release()
    })

    it('throws STORAGE_LOCK_CONFLICT when project is locked by active process', async () => {
      const activePid = 12345
      const activeLock: ProjectLockData = {
        pid: activePid,
        timestamp: Date.now() - 5000,
        host: os.hostname()
      }
      await fs.promises.writeFile(lockFilePath, JSON.stringify(activeLock, null, 2), 'utf8')

      const lockManager = new ProjectLockManager({
        isProcessAlive: (pid: number) => pid === activePid
      })

      expect(await lockManager.isLocked(projectPath)).toBe(true)

      let caughtError: unknown
      try {
        await lockManager.acquire(projectPath)
      } catch (err: unknown) {
        caughtError = err
      }

      expect(caughtError).toBeInstanceOf(StorageError)
      const storageError = caughtError as StorageError
      expect(storageError.code).toBe(StorageErrorCode.STORAGE_LOCK_CONFLICT)
      expect(storageError.subsystem).toBe('STORAGE')

      const details = storageError.details as { lockData: ProjectLockData; lockPath: string }
      expect(details.lockData.pid).toBe(activePid)
      expect(details.lockPath).toBe(lockFilePath)
    })

    it('allows force takeover when force is true even if PID is alive', async () => {
      const otherPid = 54321
      const activeLock: ProjectLockData = {
        pid: otherPid,
        timestamp: Date.now() - 5000,
        host: os.hostname()
      }
      await fs.promises.writeFile(lockFilePath, JSON.stringify(activeLock, null, 2), 'utf8')

      const lockManager = new ProjectLockManager({
        isProcessAlive: (pid: number) => pid === otherPid || pid === process.pid
      })

      // Acquire with force: true
      await lockManager.acquire(projectPath, { force: true })

      const currentLock = await lockManager.getLockData(projectPath)
      expect(currentLock?.pid).toBe(process.pid)

      await lockManager.release()
    })

    it('does not delete lock file during release if owned by another process', async () => {
      const foreignPid = 88888
      const foreignLock: ProjectLockData = {
        pid: foreignPid,
        timestamp: Date.now(),
        host: os.hostname()
      }
      await fs.promises.writeFile(lockFilePath, JSON.stringify(foreignLock, null, 2), 'utf8')

      const lockManager = new ProjectLockManager()
      // Attempt to release projectPath not owned by current process
      await lockManager.release(projectPath)

      // Lock file should still be preserved
      expect(fs.existsSync(lockFilePath)).toBe(true)
      const data = await lockManager.getLockData(projectPath)
      expect(data?.pid).toBe(foreignPid)
    })
  })
})
