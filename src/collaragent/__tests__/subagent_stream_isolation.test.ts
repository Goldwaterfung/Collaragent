import { describe, it, expect } from 'vitest'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatResult } from '@langchain/core/outputs'
import { createAgent, tool } from 'langchain'
import { z } from 'zod'
import { createSubAgentMiddleware } from '../middleware/subagents.js'

class MockChatModel extends BaseChatModel {
  private responses: BaseMessage[]
  constructor(responses: BaseMessage[]) {
    super({})
    this.responses = responses
  }
  _llmType(): string {
    return 'mock'
  }
  _combineLLMOutput(): never[] {
    return []
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const nextMsg = this.responses.shift() || new AIMessage('mock response')
    return {
      generations: [
        { message: nextMsg, text: typeof nextMsg.content === 'string' ? nextMsg.content : '' }
      ]
    }
  }
  bindTools() {
    return this
  }
}

describe('Subagent stream tagging and classification', () => {
  it('deterministically tags subagent execution chunks with subagentToolCallId and tags', async () => {
    const mockReadFile = tool(async () => 'mock file data', {
      name: 'read_file',
      description: 'reads file',
      schema: z.object({ path: z.string() })
    })

    // Subagent model emits a tool call then final subagent output
    const subagentModel = new MockChatModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'read_file',
            args: { path: '/sample.txt' },
            id: 'call_sub_001',
            type: 'tool_call'
          }
        ]
      }),
      new AIMessage({ content: 'Subagent completed research successfully.' })
    ])

    // Orchestrator calls task tool, then completes
    const orchestratorModel = new MockChatModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'task',
            args: {
              description: 'Research quantum cryptography',
              subagent_type: 'general-purpose'
            },
            id: 'call_task_root_999',
            type: 'tool_call'
          }
        ]
      }),
      new AIMessage({ content: 'Here is the synthesized answer for the user.' })
    ])

    const subagentMiddleware = createSubAgentMiddleware({
      defaultModel: subagentModel,
      defaultTools: [mockReadFile],
      generalPurposeAgent: true
    })

    const orchestrator = createAgent({
      model: orchestratorModel,
      middleware: [subagentMiddleware]
    })

    const stream = await orchestrator.stream(
      { messages: [new HumanMessage('Start task')] },
      { streamMode: 'messages' }
    )

    const rootChunks: unknown[] = []
    const subagentChunks: unknown[] = []

    for await (const tuple of stream as AsyncIterable<unknown>) {
      const [chunk, rawMetadata] = Array.isArray(tuple)
        ? (tuple as [Record<string, unknown>, Record<string, unknown> | undefined])
        : [tuple as Record<string, unknown>, undefined]

      const metadata = rawMetadata || {}
      const subagentTag = Array.isArray(metadata.tags)
        ? (metadata.tags as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.startsWith('subagent:'))
            .map((t) => t.slice('subagent:'.length))[0]
        : undefined

      const metadataSubagentId =
        typeof metadata.subagentToolCallId === 'string' ? metadata.subagentToolCallId : undefined

      const subagentId = metadataSubagentId || subagentTag

      if (subagentId) {
        expect(subagentId).toBe('call_task_root_999')
        subagentChunks.push(chunk)
      } else {
        rootChunks.push(chunk)
      }
    }

    // Verify isolation:
    // Subagent chunks exist and were cleanly segregated
    expect(subagentChunks.length).toBeGreaterThan(0)
    // Root chunks contain orchestrator tool call and orchestrator final message
    expect(rootChunks.length).toBeGreaterThan(0)
  })

  it('captures subagent completion and artifact via streamMode updates', async () => {
    const mockReadFile = tool(async () => 'mock file data', {
      name: 'read_file',
      description: 'reads file',
      schema: z.object({ path: z.string() })
    })

    const subagentModel = new MockChatModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'read_file',
            args: { path: '/sample.txt' },
            id: 'call_sub_002',
            type: 'tool_call'
          }
        ]
      }),
      new AIMessage({ content: 'Subagent completed research successfully.' })
    ])

    const orchestratorModel = new MockChatModel([
      new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'task',
            args: {
              description: 'Research quantum cryptography',
              subagent_type: 'general-purpose'
            },
            id: 'call_task_root_1000',
            type: 'tool_call'
          }
        ]
      }),
      new AIMessage({ content: 'Here is the synthesized answer for the user.' })
    ])

    const subagentMiddleware = createSubAgentMiddleware({
      defaultModel: subagentModel,
      defaultTools: [mockReadFile],
      generalPurposeAgent: true
    })

    const orchestrator = createAgent({
      model: orchestratorModel,
      middleware: [subagentMiddleware]
    })

    const stream = await orchestrator.stream(
      { messages: [new HumanMessage('Start task')] },
      { streamMode: ['messages', 'updates'] }
    )

    let completedToolResult: unknown = undefined
    let completedToolId: string | undefined = undefined

    for await (const rawItem of stream as AsyncIterable<unknown>) {
      if (!Array.isArray(rawItem) || rawItem.length < 2) continue
      const mode = rawItem[0]
      const payload = rawItem[1]

      if (mode === 'updates' && typeof payload === 'object' && payload !== null) {
        const payloadRec = payload as Record<string, unknown>
        for (const nodeKey of Object.keys(payloadRec)) {
          const nodeUpdate = payloadRec[nodeKey]
          if (typeof nodeUpdate === 'object' && nodeUpdate !== null && 'messages' in nodeUpdate) {
            const msgs = (nodeUpdate as { messages: unknown[] }).messages
            for (const msg of msgs) {
              if (typeof msg === 'object' && msg !== null) {
                const msgRec = msg as Record<string, unknown>
                if (msgRec.tool_call_id === 'call_task_root_1000') {
                  completedToolId = 'call_task_root_1000'
                  completedToolResult = msgRec.artifact ?? msgRec.content
                }
              }
            }
          }
        }
      }
    }

    expect(completedToolId).toBe('call_task_root_1000')
    expect(completedToolResult).toBeDefined()
    expect(typeof completedToolResult).toBe('object')
    const sessionData = completedToolResult as Record<string, unknown>
    expect(sessionData.summary).toBe('Subagent completed research successfully.')
    expect(Array.isArray(sessionData.messages)).toBe(true)
    expect((sessionData.messages as unknown[]).length).toBeGreaterThan(0)
  })
})
