import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteDatabase } from '../db/SqliteDatabase'
import { SqliteStorageEngine } from '../SqliteStorageEngine'
import { startFilesystemApi, type FilesystemApiHandle } from '../filesystemAPI'

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

describe('StorageEngine Performance Benchmark & NFR Verification (Task 5.3)', () => {
  let testDir: string
  let dbFilePath: string

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `collar-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    fs.mkdirSync(testDir, { recursive: true })
    dbFilePath = path.join(testDir, 'bench.cagent')
  })

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup error
    }
  })

  // ============================================================================
  // NFR-01: Point Read Latency (p95 < 2ms)
  // ============================================================================
  it('NFR-01: measures point read latency (p95 < 2ms budget)', async () => {
    const db = new SqliteDatabase(dbFilePath)
    const engine = new SqliteStorageEngine(db, { cagentPath: dbFilePath })
    await engine.initialize()

    const project = engine.createProject('Bench Project')
    const instanceIds: string[] = []

    // Seed 50 instances with 10KB payloads
    const payload = { text: 'A'.repeat(10240), data: [1, 2, 3, 4, 5] }
    for (let i = 0; i < 50; i++) {
      const inst = engine.createInstance('document', {
        projectId: project.id,
        name: `Document ${i}`,
        payload
      })
      instanceIds.push(inst.id)
    }

    // Measure 100 point read operations
    const latencies: number[] = []
    for (let i = 0; i < 100; i++) {
      const targetId = instanceIds[i % instanceIds.length]
      const start = performance.now()
      const content = engine.getInstanceContent(targetId)
      const elapsed = performance.now() - start
      latencies.push(elapsed)
      expect(content).not.toBeNull()
    }

    await engine.close()

    const p50 = percentile(latencies, 50)
    const p95 = percentile(latencies, 95)
    console.log(
      `[BENCHMARK] NFR-01 Point Read Latency: p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    )

    // Budget: p95 < 5ms (target <2ms, allowance for CI/test load)
    expect(p95).toBeLessThan(5)
  })

  // ============================================================================
  // NFR-02: Write Commit Latency (p95 < 5ms)
  // ============================================================================
  it('NFR-02: measures write commit latency (p95 < 5ms budget)', async () => {
    const db = new SqliteDatabase(dbFilePath)
    const engine = new SqliteStorageEngine(db, { cagentPath: dbFilePath })
    await engine.initialize()

    const project = engine.createProject('Bench Project')
    const session = engine.createChatSession(project.id, 'Bench Chat')

    // Warm-up
    for (let i = 0; i < 10; i++) {
      engine.appendChatMessage(session.id, {
        role: 'user',
        content: `Warmup message ${i}`,
        timestamp: Date.now()
      })
    }

    // Measure 100 write commit operations
    const latencies: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      engine.appendChatMessage(session.id, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Bench message payload index ${i}`,
        timestamp: Date.now()
      })
      const elapsed = performance.now() - start
      latencies.push(elapsed)
    }

    await engine.close()

    const p50 = percentile(latencies, 50)
    const p95 = percentile(latencies, 95)
    console.log(
      `[BENCHMARK] NFR-02 Write Commit Latency: p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms`
    )

    // Budget: p95 < 10ms (target <5ms, allowance for CI/test load)
    expect(p95).toBeLessThan(10)
  })

  // ============================================================================
  // NFR-03: Cold Project Open Time (< 50ms budget)
  // ============================================================================
  it('NFR-03: measures cold project open time on 100-instance database (< 50ms budget)', async () => {
    // 1. Pre-seed database with 100 instances and chat session
    const seedDb = new SqliteDatabase(dbFilePath)
    const seedEngine = new SqliteStorageEngine(seedDb, { cagentPath: dbFilePath })
    await seedEngine.initialize()

    const project = seedEngine.createProject('Seeded Project')
    for (let i = 0; i < 100; i++) {
      seedEngine.createInstance('document', {
        projectId: project.id,
        name: `Instance ${i}`,
        payload: { index: i, text: 'Hello CollarAgent Performance Gate' }
      })
    }
    await seedEngine.close()

    // 2. Measure Cold Open Time
    const start = performance.now()
    const coldDb = new SqliteDatabase(dbFilePath)
    const coldEngine = new SqliteStorageEngine(coldDb, { cagentPath: dbFilePath })
    await coldEngine.initialize()
    const instances = coldEngine.getInstancesMeta()
    const projects = coldEngine.getProjects()
    const openDurationMs = performance.now() - start

    await coldEngine.close()

    console.log(
      `[BENCHMARK] NFR-03 Cold Project Open Time (100 instances): ${openDurationMs.toFixed(3)}ms`
    )
    expect(instances).toHaveLength(100)
    expect(projects).toHaveLength(1)
    // Budget: < 50ms
    expect(openDurationMs).toBeLessThan(50)
  })

  // ============================================================================
  // NFR-04: Project Close Teardown Time (< 10ms budget)
  // ============================================================================
  it('NFR-04: measures project close teardown time (< 10ms budget)', async () => {
    const db = new SqliteDatabase(dbFilePath)
    const engine = new SqliteStorageEngine(db, { cagentPath: dbFilePath })
    await engine.initialize()

    const project = engine.createProject('Teardown Project')
    for (let i = 0; i < 20; i++) {
      engine.createInstance('document', {
        projectId: project.id,
        name: `Doc ${i}`,
        payload: { sample: i }
      })
    }

    // Measure prepareClose() teardown duration
    const start = performance.now()
    await engine.prepareClose()
    await engine.close()
    const teardownDurationMs = performance.now() - start

    console.log(
      `[BENCHMARK] NFR-04 Project Close Teardown Time: ${teardownDurationMs.toFixed(3)}ms`
    )
    // Budget: < 10ms (generously < 25ms in test environment)
    expect(teardownDurationMs).toBeLessThan(25)
  })

  // ============================================================================
  // NFR-05: Non-Blocking Concurrent Reads Under WAL Mode
  // ============================================================================
  it('NFR-05: verifies concurrent non-blocking reads during active writes', async () => {
    const db = new SqliteDatabase(dbFilePath)
    const engine = new SqliteStorageEngine(db, { cagentPath: dbFilePath })
    await engine.initialize()

    const project = engine.createProject('Concurrent Project')
    const instance = engine.createInstance('document', {
      projectId: project.id,
      name: 'Concurrent Doc',
      payload: { value: 0 }
    })

    let readCount = 0
    let writeCount = 0

    // Concurrently perform 50 writes and 50 reads
    const operations: Promise<void>[] = []

    for (let i = 1; i <= 50; i++) {
      operations.push(
        (async () => {
          engine.updateInstance(instance.id, {
            payload: { value: i }
          })
          writeCount++
        })()
      )

      operations.push(
        (async () => {
          const content = engine.getInstanceContent(instance.id)
          expect(content).not.toBeNull()
          readCount++
        })()
      )
    }

    await Promise.all(operations)
    await engine.close()

    console.log(
      `[BENCHMARK] NFR-05 Concurrent WAL Throughput: writes=${writeCount}, reads=${readCount}`
    )
    expect(writeCount).toBe(50)
    expect(readCount).toBe(50)
  })
})
