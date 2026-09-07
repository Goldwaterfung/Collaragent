import { describe, it, expect, vi } from 'vitest'
import { SyncClient } from '../SyncClient'

describe('SyncClient', () => {
  it('sendBatch advances baseVersion with each returned server sequence', async () => {
    const client = new SyncClient<{ type: string }, Record<string, unknown>>({
      host: 'localhost:1234'
    })

    const capturedOptions: Array<{ baseVersion?: number; threadId?: string } | undefined> = []

    let simulatedServerSeq = 10
    vi.spyOn(client, 'send').mockImplementation(async (_cmd, options) => {
      capturedOptions.push(typeof options === 'object' ? { ...options } : undefined)
      simulatedServerSeq += 1
      return simulatedServerSeq
    })

    const commands = [{ type: 'test:cmd_1' }, { type: 'test:cmd_2' }, { type: 'test:cmd_3' }]

    const seqs = await client.sendBatch(commands, { threadId: 'thread-1', baseVersion: 10 })

    expect(seqs).toEqual([11, 12, 13])
    expect(capturedOptions).toEqual([
      { threadId: 'thread-1', baseVersion: 10 },
      { threadId: 'thread-1', baseVersion: 11 },
      { threadId: 'thread-1', baseVersion: 12 }
    ])
  })

  it('sendBatch preserves undefined baseVersion when none provided', async () => {
    const client = new SyncClient<{ type: string }, Record<string, unknown>>({
      host: 'localhost:1234'
    })

    const capturedOptions: Array<{ baseVersion?: number } | undefined> = []

    vi.spyOn(client, 'send').mockImplementation(async (_cmd, options) => {
      capturedOptions.push(typeof options === 'object' ? { ...options } : undefined)
      return 1
    })

    await client.sendBatch([{ type: 'test:cmd_1' }, { type: 'test:cmd_2' }])

    expect(capturedOptions).toEqual([undefined, undefined])
  })
})
