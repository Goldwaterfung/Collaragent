import { z } from 'zod/v3'
import {
  createMiddleware,
  createAgent,
  type AgentMiddleware,
  tool,
  ToolMessage,
  toolRetryMiddleware,
  type StructuredTool
} from 'langchain'
import { Command, getCurrentTaskInput } from '@langchain/langgraph'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { HumanMessage } from '@langchain/core/messages'
import type {
  ChatMessage,
  ToolCall,
  MessageRole,
  MessageBlock,
  SubagentSessionData
} from '@shared/agents/types'

export const DYNAMIC_SUBAGENT_DEFAULT_RECURSION_LIMIT = 200
export const DYNAMIC_SUBAGENT_MAX_RETRIES = 2
export const DYNAMIC_TASK_TOOL_NAME = 'dynamic_task'

const EXCLUDED_STATE_KEYS = ['messages', 'todos', 'structuredResponse', 'files'] as const
type ExcludedStateKey = (typeof EXCLUDED_STATE_KEYS)[number]

export interface DynamicTaskToolOptions {
  availableTools: StructuredTool[]
  defaultModel: LanguageModelLike | string
  defaultMiddleware?: AgentMiddleware[] | null
  recursionLimit?: number
}

export interface DynamicSubagentMiddlewareOptions extends DynamicTaskToolOptions {
  name?: string
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Filter state to exclude certain keys when passing to subagents
 */
export function filterStateForSubagent(state: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!EXCLUDED_STATE_KEYS.includes(key as ExcludedStateKey)) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * Extract structured subagent session execution history from subagent result
 */
export function extractSubagentSessionData(
  result: Record<string, unknown>,
  context?: { subagentType?: string; description?: string }
): SubagentSessionData {
  const rawMessages = Array.isArray(result.messages) ? result.messages : []
  const chatMessages: ChatMessage[] = []
  const toolCallsMap = new Map<string, ToolCall>()

  let lastContent = ''

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i]
    if (!isRecord(msg)) continue

    const type =
      typeof msg._getType === 'function'
        ? String((msg._getType as () => unknown)())
        : typeof msg.type === 'string'
          ? msg.type
          : ''

    const rawContent = msg.content
    let textContent = ''
    const blocks: MessageBlock[] = []

    if (typeof rawContent === 'string') {
      textContent = rawContent
      if (rawContent.trim()) {
        blocks.push({ type: 'text', content: rawContent })
      }
    } else if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (typeof block === 'string') {
          textContent += block
          blocks.push({ type: 'text', content: block })
        } else if (isRecord(block)) {
          if (block.type === 'text' && typeof block.text === 'string') {
            textContent += block.text
            blocks.push({ type: 'text', content: block.text })
          } else if (
            (block.type === 'reasoning' || block.type === 'thinking') &&
            (typeof block.reasoning === 'string' || typeof block.thinking === 'string')
          ) {
            const reasoningText = String(block.reasoning || block.thinking)
            blocks.push({ type: 'reasoning', content: reasoningText })
          }
        }
      }
    }

    if (isRecord(msg.additional_kwargs)) {
      const reasoning = msg.additional_kwargs.reasoning_content ?? msg.additional_kwargs.thinking
      if (typeof reasoning === 'string' && reasoning.trim()) {
        blocks.unshift({ type: 'reasoning', content: reasoning })
      }
    }

    const msgToolCalls: ToolCall[] = []
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (isRecord(tc)) {
          const id = typeof tc.id === 'string' ? tc.id : `sub_tc_${i}_${msgToolCalls.length}`
          const name = typeof tc.name === 'string' ? tc.name : 'unknown_tool'
          const args = isRecord(tc.args) ? tc.args : {}
          const toolCall: ToolCall = {
            id,
            name,
            args,
            status: 'pending'
          }
          msgToolCalls.push(toolCall)
          toolCallsMap.set(id, toolCall)
          blocks.push({ type: 'tool', toolId: id })
        }
      }
    }

    if (type === 'tool') {
      const toolCallId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : ''
      if (toolCallId && toolCallsMap.has(toolCallId)) {
        const tc = toolCallsMap.get(toolCallId)
        if (tc) {
          tc.status = msg.status === 'error' ? 'error' : 'completed'
          let parsedResult: unknown = rawContent
          if (typeof rawContent === 'string') {
            try {
              parsedResult = JSON.parse(rawContent)
            } catch {
              parsedResult = rawContent
            }
          }
          tc.result = parsedResult
        }
      }
      continue
    }

    if (textContent.trim()) {
      lastContent = textContent
    }

    const role: MessageRole = type === 'human' ? 'user' : type === 'ai' ? 'assistant' : 'system'

    chatMessages.push({
      id: typeof msg.id === 'string' ? msg.id : `sub_msg_${i}`,
      role,
      content: textContent,
      timestamp: new Date(),
      toolCalls: msgToolCalls.length > 0 ? msgToolCalls : undefined,
      blocks: blocks.length > 0 ? blocks : undefined
    })
  }

  const summary = lastContent || 'Task completed'
  const allToolCalls = Array.from(toolCallsMap.values())

  return {
    summary,
    messages: chatMessages,
    toolCalls: allToolCalls,
    totalTurns: chatMessages.length,
    agentType: context?.subagentType,
    description: context?.description
  }
}

/**
 * Create Command with filtered state update from subagent result
 */
export function returnCommandWithStateUpdate(
  result: Record<string, unknown>,
  toolCallId: string,
  toolName = DYNAMIC_TASK_TOOL_NAME,
  context?: { subagentType?: string; description?: string }
): Command {
  const stateUpdate = filterStateForSubagent(result)
  const sessionData = extractSubagentSessionData(result, context)

  return new Command({
    update: {
      ...stateUpdate,
      messages: [
        new ToolMessage({
          content: sessionData.summary,
          tool_call_id: toolCallId,
          name: toolName,
          artifact: sessionData
        })
      ]
    }
  })
}

export function getDynamicTaskToolDescription(): string {
  return `
Launch an ad-hoc, ephemeral subagent with a highly specific persona and custom toolset to handle unique, independent tasks.

While the standard \`task\` tool is used for pre-configured, common agent types, the \`dynamic_task\` tool allows you to create a completely custom worker agent on-the-fly.

## Usage Notes:
1. **When to use**: Use this when you encounter a highly specialized task where a pre-configured subagent does not exist or doesn't fit the exact objective (e.g., a one-off legacy code migration, specialized medical research, custom statistical analysis).
2. **System Prompt**: The \`systemPrompt\` you provide is critical. You must clearly define the agent's persona, its exact objective, constraints, and how it should format its final response back to you.
3. **Minimal Toolset**: Only provide the dynamic subagent with the bare minimum tools it needs to accomplish the task. If no additional tools are needed, provide an empty array \`tools: []\` or omit the field. This prevents distraction.
4. **Stateless Execution**: The dynamic subagent executes in complete isolation. It cannot communicate with you during its run. Your initial \`description\` and \`systemPrompt\` must contain all necessary context.
5. **Parallel Execution**: Like the regular task tool, you can launch multiple dynamic subagents concurrently.

##RULES:
1. NEVER pass Filesystem Tools, Workspace System tools and write_todos tool to the dynamic subagent. They are already provided with access to all workspace tools and write_todos tool.
  `.trim()
}

/**
 * Create the dynamic_task tool for ad-hoc agent creation
 */
export function createDynamicTaskTool(
  optionsOrTools: DynamicTaskToolOptions | StructuredTool[],
  legacyModel?: LanguageModelLike | string,
  legacyMiddleware?: AgentMiddleware[] | null
): StructuredTool {
  const options: DynamicTaskToolOptions = Array.isArray(optionsOrTools)
    ? {
        availableTools: optionsOrTools,
        defaultModel: (legacyModel ?? '') as LanguageModelLike | string,
        defaultMiddleware: legacyMiddleware
      }
    : optionsOrTools

  const {
    availableTools,
    defaultModel,
    defaultMiddleware,
    recursionLimit = DYNAMIC_SUBAGENT_DEFAULT_RECURSION_LIMIT
  } = options
  const toolNames = availableTools.map((t) => t.name)

  return tool(
    async (
      input: { description: string; subagent_config: { systemPrompt: string; tools?: string[] } },
      config
    ): Promise<Command | string> => {
      const requestedTools = Array.isArray(input.subagent_config?.tools)
        ? input.subagent_config.tools
        : []
      const selectedTools = availableTools.filter((t) => requestedTools.includes(t.name))

      const dynamicMiddleware: AgentMiddleware[] = [
        ...(defaultMiddleware || []),
        toolRetryMiddleware({ maxRetries: DYNAMIC_SUBAGENT_MAX_RETRIES, onFailure: 'continue' })
      ]

      const subagent = createAgent({
        model: defaultModel,
        systemPrompt: input.subagent_config.systemPrompt,
        tools: selectedTools,
        middleware: dynamicMiddleware
      })

      const currentState = getCurrentTaskInput<Record<string, unknown>>()
      const subagentState = filterStateForSubagent(currentState)
      subagentState.messages = [new HumanMessage({ content: input.description })]

      const toolCallId = config.toolCall?.id
      if (!toolCallId) {
        throw new Error('Tool call ID is required for subagent invocation')
      }

      const subagentTags = [...(config.tags || []), `subagent:${toolCallId}`]
      const subagentMetadata = {
        ...(config.metadata || {}),
        subagentToolCallId: toolCallId
      }

      const rawResult: unknown = await subagent.invoke(
        subagentState as Parameters<typeof subagent.invoke>[0],
        {
          ...config,
          tags: subagentTags,
          metadata: subagentMetadata,
          recursionLimit
        }
      )

      const result: Record<string, unknown> = isRecord(rawResult) ? rawResult : {}

      return returnCommandWithStateUpdate(result, toolCallId, DYNAMIC_TASK_TOOL_NAME, {
        subagentType: 'custom',
        description: input.description
      })
    },
    {
      name: DYNAMIC_TASK_TOOL_NAME,
      description: getDynamicTaskToolDescription(),
      schema: z.object({
        description: z.string().describe('Task description for the agent to execute autonomously'),
        subagent_config: z.object({
          systemPrompt: z
            .string()
            .describe(
              "Highly specific system prompt defining the ad-hoc agent's instructions, persona, and objective"
            ),
          // Inline the enum directly (not as a variable) to prevent Zod from emitting
          // a $ref in the JSON Schema output, which Google's API does not support.
          tools: z
            .array(toolNames.length > 0 ? z.enum(toolNames as [string, ...string[]]) : z.string())
            .optional()
            .default([])
            .describe(
              toolNames.length > 0
                ? `Array of tool names for the subagent. Available: ${toolNames.join(', ')}. Pass [] if no extra tools are needed.`
                : 'No additional tools available. Pass [].'
            )
        })
      })
    }
  )
}

/**
 * Optional standalone middleware wrapper for dynamic subagent tool.
 */
export function createDynamicSubagentMiddleware(
  options: DynamicSubagentMiddlewareOptions
): AgentMiddleware {
  const dynamicTaskTool = createDynamicTaskTool(options)
  return createMiddleware({
    name: options.name || 'dynamicSubagentMiddleware',
    tools: [dynamicTaskTool]
  })
}
