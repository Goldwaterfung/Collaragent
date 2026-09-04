import { describe, it, expect } from 'vitest'
import { tool } from 'langchain'
import { z } from 'zod/v3'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import {
  createDynamicTaskTool,
  createDynamicSubagentMiddleware,
  filterStateForSubagent,
  extractSubagentSessionData,
  DYNAMIC_TASK_TOOL_NAME,
  DYNAMIC_SUBAGENT_DEFAULT_RECURSION_LIMIT
} from '../tools/DynamicTaskTool.js'

describe('DynamicTaskTool', () => {
  const dummyTool = tool(async () => 'dummy result', {
    name: 'test_helper_tool',
    description: 'A test helper tool',
    schema: z.object({ input: z.string() })
  })

  it('creates dynamic_task tool with expected properties and schema', () => {
    const dynamicTool = createDynamicTaskTool({
      availableTools: [dummyTool],
      defaultModel: 'claude-sonnet-4-5-20250929',
      recursionLimit: DYNAMIC_SUBAGENT_DEFAULT_RECURSION_LIMIT
    })

    expect(dynamicTool.name).toBe(DYNAMIC_TASK_TOOL_NAME)
    expect(dynamicTool.description).toContain('Launch an ad-hoc, ephemeral subagent')
    expect(dynamicTool.schema).toBeDefined()
  })

  it('supports legacy argument list signature for backward compatibility', () => {
    const dynamicTool = createDynamicTaskTool([dummyTool], 'claude-sonnet-4-5-20250929')

    expect(dynamicTool.name).toBe(DYNAMIC_TASK_TOOL_NAME)
    expect(dynamicTool.schema).toBeDefined()
  })

  it('allows omitting tools in subagent_config and defaults to empty array', () => {
    const dynamicTool = createDynamicTaskTool({
      availableTools: [dummyTool],
      defaultModel: 'claude-sonnet-4-5-20250929'
    })

    const parsed = dynamicTool.schema.parse({
      description: 'Analyze data',
      subagent_config: {
        systemPrompt: 'You are an analysis assistant.'
      }
    })

    expect(parsed.subagent_config.tools).toEqual([])
  })

  it('filterStateForSubagent strips excluded state channels', () => {
    const originalState = {
      messages: [new HumanMessage({ content: 'test' })],
      todos: ['write code'],
      structuredResponse: { done: true },
      files: { '/test.txt': 'data' },
      customWorkspaceKey: 'keep-this',
      anotherAllowedField: 123
    }

    const filtered = filterStateForSubagent(originalState)

    expect(filtered).not.toHaveProperty('messages')
    expect(filtered).not.toHaveProperty('todos')
    expect(filtered).not.toHaveProperty('structuredResponse')
    expect(filtered).not.toHaveProperty('files')
    expect(filtered).toHaveProperty('customWorkspaceKey', 'keep-this')
    expect(filtered).toHaveProperty('anotherAllowedField', 123)
  })

  it('extractSubagentSessionData extracts messages, reasoning, and tool calls into SubagentSessionData', () => {
    const mockResult = {
      messages: [
        new HumanMessage({ content: 'Do research on X' }),
        new AIMessage({
          content: 'I will search for X',
          tool_calls: [
            {
              id: 'call_1',
              name: 'web_search',
              args: { query: 'X' },
              type: 'tool_call'
            }
          ],
          additional_kwargs: {
            reasoning_content: 'Let me think about how to search for X.'
          }
        }),
        new ToolMessage({
          tool_call_id: 'call_1',
          content: JSON.stringify({ title: 'Result X' })
        }),
        new AIMessage({
          content: 'Here is the summary of X.'
        })
      ]
    }

    const sessionData = extractSubagentSessionData(mockResult, {
      subagentType: 'custom',
      description: 'Do research on X'
    })

    expect(sessionData.summary).toBe('Here is the summary of X.')
    expect(sessionData.agentType).toBe('custom')
    expect(sessionData.description).toBe('Do research on X')
    expect(sessionData.totalTurns).toBe(3) // Human, AI (with tool), AI (final)
    expect(sessionData.toolCalls).toHaveLength(1)
    expect(sessionData.toolCalls[0].name).toBe('web_search')
    expect(sessionData.toolCalls[0].status).toBe('completed')
    expect(sessionData.messages[1].blocks).toBeDefined()
    expect(sessionData.messages[1].blocks?.some((b) => b.type === 'reasoning')).toBe(true)
  })

  it('createDynamicSubagentMiddleware wraps the tool properly', () => {
    const middleware = createDynamicSubagentMiddleware({
      availableTools: [dummyTool],
      defaultModel: 'claude-sonnet-4-5-20250929'
    })

    expect(middleware.name).toBe('dynamicSubagentMiddleware')
    expect(middleware.tools).toBeDefined()
    expect(middleware.tools?.length).toBe(1)
    expect(middleware.tools?.[0].name).toBe(DYNAMIC_TASK_TOOL_NAME)
  })
})
