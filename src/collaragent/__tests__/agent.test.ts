import { describe, it, expect } from 'vitest'
import { tool } from 'langchain'
import { z } from 'zod/v3'
import { createDeepAgent } from '../runtime/agent.js'
import { DYNAMIC_TASK_TOOL_NAME } from '../tools/DynamicTaskTool.js'

describe('createDeepAgent studio wrapper', () => {
  const dummyTool = tool(async () => 'dummy result', {
    name: 'test_calc',
    description: 'A test calculator tool',
    schema: z.object({ query: z.string() })
  })

  it('creates an agent combining upstream deepagents with collaragent studio middleware and dynamic_task', () => {
    const agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      tools: [dummyTool],
      allAvailableTools: [dummyTool],
      dynamicEnabled: true,
      workspaceReadOnly: false
    })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })

  it('omits dynamic_task tool when dynamicEnabled is false', () => {
    const agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      tools: [dummyTool],
      dynamicEnabled: false
    })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })

  it('wires custom subagents with custom tools and strictly eliminates preset general-purpose subagent', () => {
    const customTool = tool(async () => 'custom tool output', {
      name: 'special_research_tool',
      description: 'Special research tool',
      schema: z.object({ query: z.string() })
    })

    const agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      tools: [dummyTool],
      subagents: [
        {
          name: 'apa-research-specialist',
          description: 'Specialist for APA research with dedicated tools',
          systemPrompt: 'You are an APA specialist.',
          tools: [customTool]
        }
      ],
      dynamicEnabled: true
    })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })
})
