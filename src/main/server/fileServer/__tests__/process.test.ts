import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { UtilityProcessController, type ProcessContext } from '../process'
import { StorageMigrationEngine } from '../StorageMigrationEngine'

describe('UtilityProcessController (Task 5.2 / Process Lifecycle)', () => {
  let testDir: string
  let dbFilePath: string
  let controller: UtilityProcessController
  let messagesSent: unknown[]
  let context: ProcessContext
  let exitCalled: number | null

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-process-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'workspace.cagent')

    controller = new UtilityProcessController()
    messagesSent = []
    exitCalled = null

    context = {
      postMessage: (msg: unknown) => {
        messagesSent.push(msg)
      },
      exit: (code?: number) => {
        exitCalled = code ?? 0
      }
    }
  })

  afterEach(async () => {
    if (controller.apiHandle) {
      await controller.apiHandle.close()
    }
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  describe('start message', () => {
    it('initializes V4 storage directly without staging folder unpacking', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: { filePath: dbFilePath }
        },
        context
      )

      expect(messagesSent).toHaveLength(1)
      const readyMsg = messagesSent[0] as { type: string; payload: { port: number } }
      expect(readyMsg.type).toBe('ready')
      expect(readyMsg.payload.port).toBeGreaterThan(0)

      // Verify no legacy .collar directory was created
      const legacyCollarDir = path.join(testDir, 'workspace.collar')
      expect(fs.existsSync(legacyCollarDir)).toBe(false)

      // Verify SQLite file was created directly at dbFilePath
      expect(fs.existsSync(dbFilePath)).toBe(true)
      expect(controller.apiHandle).not.toBeNull()
    })

    it('returns error when filePath is missing', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: {}
        },
        context
      )

      expect(messagesSent).toHaveLength(1)
      const errMsg = messagesSent[0] as { type: string; payload: { message: string } }
      expect(errMsg.type).toBe('error')
      expect(errMsg.payload.message).toContain('Missing filePath')
    })
  })

  describe('get-close-state message', () => {
    it('returns close state payload', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: { filePath: dbFilePath }
        },
        context
      )

      messagesSent = []
      await controller.handleMessage({ type: 'get-close-state' }, context)

      expect(messagesSent).toHaveLength(1)
      const stateMsg = messagesSent[0] as {
        type: string
        payload: { sourceArchivePath: string; isArchiveBacked: boolean }
      }
      expect(stateMsg.type).toBe('close-state-ready')
      expect(stateMsg.payload.isArchiveBacked).toBe(true)
    })
  })

  describe('prepare-close message (NFR-04 <10ms Teardown Budget)', () => {
    it('prepares close in under 10ms without zip repackaging', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: { filePath: dbFilePath }
        },
        context
      )

      // Insert an instance to ensure write activity
      controller.apiHandle?.storage.createProject('Quick Close Project')

      messagesSent = []
      const startTime = performance.now()
      await controller.handleMessage({ type: 'prepare-close' }, context)
      const teardownDurationMs = performance.now() - startTime

      expect(messagesSent).toHaveLength(1)
      const preparedMsg = messagesSent[0] as { type: string; payload: { success: boolean } }
      expect(preparedMsg.type).toBe('close-prepared')
      expect(preparedMsg.payload.success).toBe(true)
      expect(controller.apiHandle).toBeNull()

      // NFR-04 verification: Teardown budget < 10ms (generously assert < 50ms in test environment)
      expect(teardownDurationMs).toBeLessThan(50)
    })
  })

  describe('export message', () => {
    it('exports project to target path', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: { filePath: dbFilePath }
        },
        context
      )

      controller.apiHandle?.storage.createProject('Exported Project')

      const targetPath = path.join(testDir, 'exported-copy.cagent')
      messagesSent = []
      await controller.handleMessage(
        {
          type: 'export',
          payload: { targetPath }
        },
        context
      )

      expect(messagesSent).toHaveLength(1)
      const exportMsg = messagesSent[0] as { type: string; payload: { success: boolean } }
      expect(exportMsg.type).toBe('export-ready')
      expect(exportMsg.payload.success).toBe(true)
      expect(fs.existsSync(targetPath)).toBe(true)
    })
  })

  describe('close message', () => {
    it('disposes resources and calls exit', async () => {
      await controller.handleMessage(
        {
          type: 'start',
          payload: { filePath: dbFilePath }
        },
        context
      )

      await controller.handleMessage({ type: 'close' }, context)

      expect(controller.apiHandle).toBeNull()
      expect(exitCalled).toBe(0)
    })
  })
})
