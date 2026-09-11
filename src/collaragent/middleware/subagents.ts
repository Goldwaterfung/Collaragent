import { z } from 'zod/v3'
import {
  createMiddleware,
  createAgent,
  AgentMiddleware,
  tool,
  ToolMessage,
  humanInTheLoopMiddleware,
  SystemMessage,
  toolRetryMiddleware,
  type InterruptOnConfig,
  type ReactAgent,
  StructuredTool
} from 'langchain'
import { Command, getCurrentTaskInput } from '@langchain/langgraph'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { Runnable } from '@langchain/core/runnables'
import { HumanMessage } from '@langchain/core/messages'
import type {
  ChatMessage,
  ToolCall,
  MessageRole,
  MessageBlock,
  SubagentSessionData
} from '@shared/agents/types'
import { createDynamicTaskTool } from '../tools/DynamicTaskTool.js'
import { createModelResponseNormalizerMiddleware } from './model_response_normalizer.js'

export type { AgentMiddleware }

// Constants
const DEFAULT_SUBAGENT_PROMPT =
  'In order to complete the objective that the user asks of you, you have access to a number of standard tools.'

// State keys that are excluded when passing state to subagents and when returning
// updates from subagents.
// When returning updates:
// 1. The messages key is handled explicitly to ensure only the final message is included
// 2. The todos and structuredResponse keys are excluded as they do not have a defined reducer
//    and no clear meaning for returning them from a subagent to the main agent.
// 3. The files key is excluded to prevent concurrent subagents from writing to the files
//    channel simultaneously (which causes LastValue errors in LangGraph).
const EXCLUDED_STATE_KEYS = ['messages', 'todos', 'structuredResponse', 'files'] as const

const DEFAULT_GENERAL_PURPOSE_DESCRIPTION =
  'General-purpose agent for researching complex questions, searching for files and content, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. This agent has access to all tools as the main agent.'

function getTaskToolDescription(subagentDescriptions: string[]): string {
  return `Launch an ephemeral subagent to execute an independent, multi-step task in an isolated context window.

Available subagent types:
${subagentDescriptions.join('\n')}

Rules:
1. Concurrency: Launch independent subagents in parallel within a single turn whenever possible.
2. Stateless: Subagents execute autonomously and return only a final summary. Include all necessary background context, clear objectives, and the exact expected output format in your prompt.
3. Selective Delegation: Use subagents for context-heavy research, deep file investigations, or isolated complex operations. Complete trivial 1-step lookups or direct workspace edits yourself.
4. Visibility: Subagent intermediate reasoning and tool calls are isolated; synthesize the returned result when responding to the user.`.trim()
}

const TASK_SYSTEM_PROMPT = `## Subagent Delegation (\`task\` tool)

Use the \`task\` tool to delegate independent, complex, or context-heavy tasks to ephemeral subagents.

- When to delegate:
  - Independent tasks that can run in parallel (e.g., cross-referencing multiple files or external sources).
  - Heavy research or multi-step discovery that would bloat the main context window.
  - Autonomous workflows where only the final synthesized conclusion is needed.

- When NOT to delegate:
  - Trivial single-step actions (simple reads, single edits, or quick status checks).
  - Tasks requiring step-by-step conversational steering or intermediate user confirmation.

- Delegation Protocol:
  - Provide a self-contained objective, explicit constraints, and expected output structure.
  - Parallelize independent subagent calls in a single turn to maximize throughput.`

/**
 * Type definitions for pre-compiled agents.
 *
 * @typeParam TRunnable - The type of the runnable (ReactAgent or Runnable).
 *   When using `createAgent`, this preserves the middleware types for type inference.
 */
export interface CompiledSubAgent<TRunnable extends ReactAgent | Runnable = ReactAgent | Runnable> {
  /** The name of the agent */
  name: string
  /** The description of the agent */
  description: string
  /** The agent instance */
  runnable: TRunnable
}

/**
 * Type definitions for subagents
 */
export interface SubAgent {
  /** The name of the agent */
  name: string
  /** The description of the agent */
  description: string
  /** The system prompt to use for the agent */
  systemPrompt?: string | SystemMessage
  /** The tools to use for the agent (tool instances, not names). Defaults to defaultTools */
  tools?: StructuredTool[]
  /** The model for the agent. Defaults to default_model */
  model?: LanguageModelLike | string
  /** Additional middleware to append after default_middleware */
  middleware?: readonly AgentMiddleware[]
  /** The tool configs to use for the agent */
  interruptOn?: Record<string, boolean | InterruptOnConfig>
}

/**
 * Filter state to exclude certain keys when passing to subagents
 */
function filterStateForSubagent(state: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!EXCLUDED_STATE_KEYS.includes(key as never)) {
      filtered[key] = value
    }
  }
  return filtered
}

/**
 * Extract structured subagent session execution history from subagent result
 */
function extractSubagentSessionData(
  result: Record<string, unknown>,
  context?: { subagentType?: string; description?: string }
): SubagentSessionData {
  const rawMessages = Array.isArray(result.messages) ? result.messages : []
  const chatMessages: ChatMessage[] = []
  const toolCallsMap = new Map<string, ToolCall>()

  let lastContent = ''

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i]
    if (!msg || typeof msg !== 'object') continue

    const msgObj = msg as Record<string, unknown>
    const type =
      typeof msgObj._getType === 'function'
        ? (msgObj._getType as () => string)()
        : typeof msgObj.type === 'string'
          ? msgObj.type
          : ''

    const rawContent = msgObj.content
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
        } else if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            textContent += b.text
            blocks.push({ type: 'text', content: b.text })
          } else if (
            (b.type === 'reasoning' || b.type === 'thinking') &&
            typeof (b.reasoning || b.thinking) === 'string'
          ) {
            const reasoningText = String(b.reasoning || b.thinking)
            blocks.push({ type: 'reasoning', content: reasoningText })
          }
        }
      }
    }

    const additionalKwargs = msgObj.additional_kwargs as Record<string, unknown> | undefined
    if (additionalKwargs) {
      const reasoning = additionalKwargs.reasoning_content || additionalKwargs.thinking
      if (typeof reasoning === 'string' && reasoning.trim()) {
        blocks.unshift({ type: 'reasoning', content: reasoning })
      }
    }

    const msgToolCalls: ToolCall[] = []
    if (Array.isArray(msgObj.tool_calls)) {
      for (const tc of msgObj.tool_calls) {
        if (tc && typeof tc === 'object') {
          const tcObj = tc as Record<string, unknown>
          const id = typeof tcObj.id === 'string' ? tcObj.id : `sub_tc_${i}_${msgToolCalls.length}`
          const name = typeof tcObj.name === 'string' ? tcObj.name : 'unknown_tool'
          const args =
            tcObj.args && typeof tcObj.args === 'object'
              ? (tcObj.args as Record<string, unknown>)
              : {}
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
      const toolCallId = typeof msgObj.tool_call_id === 'string' ? msgObj.tool_call_id : ''
      if (toolCallId && toolCallsMap.has(toolCallId)) {
        const tc = toolCallsMap.get(toolCallId)
        if (tc) {
          tc.status = msgObj.status === 'error' ? 'error' : 'completed'
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
      id: typeof msgObj.id === 'string' ? msgObj.id : `sub_msg_${i}`,
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
function returnCommandWithStateUpdate(
  result: Record<string, unknown>,
  toolCallId: string,
  toolName = 'task',
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

/**
 * Create subagent instances from specifications
 */
function getSubagents(options: {
  defaultModel: LanguageModelLike | string
  defaultTools: StructuredTool[]
  defaultMiddleware: AgentMiddleware[] | null
  defaultInterruptOn: Record<string, boolean | InterruptOnConfig> | null
  subagents: readonly (SubAgent | CompiledSubAgent)[]
  generalPurposeAgent: boolean
}): {
  agents: Record<string, ReactAgent | Runnable>
  descriptions: string[]
} {
  const {
    defaultModel,
    defaultTools,
    defaultMiddleware,
    defaultInterruptOn,
    subagents,
    generalPurposeAgent
  } = options

  const hasToolRetry = (defaultMiddleware || []).some(
    (m) => m.name === 'toolRetryMiddleware' || m.name === 'ToolRetryMiddleware'
  )
  const defaultSubagentMiddleware = [
    ...(defaultMiddleware || []),
    ...(hasToolRetry ? [] : [toolRetryMiddleware({ maxRetries: 2, onFailure: 'continue' })])
  ]
  const agents: Record<string, ReactAgent | Runnable> = {}
  const subagentDescriptions: string[] = []

  // Create general-purpose agent if enabled
  if (generalPurposeAgent) {
    const generalPurposeMiddleware = [
      ...defaultSubagentMiddleware.filter((m) => m.name !== 'modelResponseNormalizerMiddleware'),
      ...(defaultInterruptOn
        ? [humanInTheLoopMiddleware({ interruptOn: defaultInterruptOn })]
        : []),
      createModelResponseNormalizerMiddleware()
    ]

    const generalPurposeSubagent = createAgent({
      model: defaultModel,
      systemPrompt: DEFAULT_SUBAGENT_PROMPT,
      tools: defaultTools,
      middleware: generalPurposeMiddleware
    })

    agents['general-purpose'] = generalPurposeSubagent
    subagentDescriptions.push(`- general-purpose: ${DEFAULT_GENERAL_PURPOSE_DESCRIPTION}`)
  }

  // Process custom subagents
  for (const agentParams of subagents) {
    subagentDescriptions.push(`- ${agentParams.name}: ${agentParams.description}`)

    if ('runnable' in agentParams) {
      agents[agentParams.name] = agentParams.runnable
    } else {
      const customMw = agentParams.middleware ?? []
      const combined = [...defaultSubagentMiddleware, ...customMw]
      const withoutNormalizer = combined.filter(
        (m) => m.name !== 'modelResponseNormalizerMiddleware'
      )
      const interruptOn = agentParams.interruptOn || defaultInterruptOn
      const middleware = [
        ...withoutNormalizer,
        ...(interruptOn ? [humanInTheLoopMiddleware({ interruptOn })] : []),
        createModelResponseNormalizerMiddleware()
      ]

      agents[agentParams.name] = createAgent({
        model: agentParams.model ?? defaultModel,
        systemPrompt: agentParams.systemPrompt,
        tools: agentParams.tools ?? defaultTools,
        middleware
      })
    }
  }

  return { agents, descriptions: subagentDescriptions }
}

/**
 * Create the task tool for invoking subagents
 */
function createTaskTool(options: {
  defaultModel: LanguageModelLike | string
  defaultTools: StructuredTool[]
  defaultMiddleware: AgentMiddleware[] | null
  defaultInterruptOn: Record<string, boolean | InterruptOnConfig> | null
  subagents: readonly (SubAgent | CompiledSubAgent)[]
  generalPurposeAgent: boolean
  taskDescription: string | null
}) {
  const {
    defaultModel,
    defaultTools,
    defaultMiddleware,
    defaultInterruptOn,
    subagents,
    generalPurposeAgent,
    taskDescription
  } = options

  const { agents: subagentGraphs, descriptions: subagentDescriptions } = getSubagents({
    defaultModel,
    defaultTools,
    defaultMiddleware,
    defaultInterruptOn,
    subagents,
    generalPurposeAgent
  })

  const finalTaskDescription = taskDescription
    ? taskDescription
    : getTaskToolDescription(subagentDescriptions)

  return tool(
    async (
      input: { description: string; subagent_type: string },
      config
    ): Promise<Command | string> => {
      const { description, subagent_type } = input

      // Validate subagent type
      if (!(subagent_type in subagentGraphs)) {
        const allowedTypes = Object.keys(subagentGraphs)
          .map((k) => `\`${k}\``)
          .join(', ')
        throw new Error(
          `Error: invoked agent of type ${subagent_type}, the only allowed types are ${allowedTypes}`
        )
      }

      const subagent = subagentGraphs[subagent_type]

      // Get current state and filter it for subagent
      const currentState = getCurrentTaskInput<Record<string, unknown>>()
      const subagentState = filterStateForSubagent(currentState)
      subagentState.messages = [new HumanMessage({ content: description })]

      const toolCallId = config.toolCall?.id
      if (!toolCallId) {
        throw new Error('Tool call ID is required for subagent invocation')
      }

      const subagentTags = [...(config.tags || []), `subagent:${toolCallId}`]
      const subagentMetadata = {
        ...(config.metadata || {}),
        subagentToolCallId: toolCallId
      }

      // Invoke the subagent
      const result = (await subagent.invoke(
        subagentState as Parameters<typeof subagent.invoke>[0],
        {
          ...config,
          tags: subagentTags,
          metadata: subagentMetadata,
          recursionLimit: 200
        }
      )) as Record<string, unknown>

      // Return command with filtered state update
      return returnCommandWithStateUpdate(result, toolCallId, 'task', {
        subagentType: subagent_type,
        description
      })
    },
    {
      name: 'task',
      description: finalTaskDescription,
      schema: z.object({
        description: z.string().describe('The task to execute with the selected agent'),
        subagent_type: z
          .string()
          .describe(
            `Name of the agent to use. Available: ${Object.keys(subagentGraphs).join(', ')}`
          )
      })
    }
  )
}

/**
 * Options for creating subagent middleware
 */
export interface SubAgentMiddlewareOptions {
  /** The model to use for subagents */
  defaultModel: LanguageModelLike | string
  /** The tools to use for the default general-purpose subagent */
  defaultTools?: StructuredTool[]
  /** Unfiltered list of all tools, used by the dynamic_task tool to generate its full schema */
  allAvailableTools?: StructuredTool[]
  /** Default middleware to apply to all subagents */
  defaultMiddleware?: AgentMiddleware[] | null
  /** The tool configs for the default general-purpose subagent */
  defaultInterruptOn?: Record<string, boolean | InterruptOnConfig> | null
  /** A list of additional subagents to provide to the agent */
  subagents?: readonly (SubAgent | CompiledSubAgent)[]
  /** Full system prompt override */
  systemPrompt?: string | null
  /** Whether to include the general-purpose agent */
  generalPurposeAgent?: boolean
  /** Custom description for the task tool */
  taskDescription?: string | null
  /** Whether dynamic subagents (dynamic_task) are enabled */
  dynamicEnabled?: boolean
}

/**
 * Create subagent middleware with task tool
 */
export function createSubAgentMiddleware(options: SubAgentMiddlewareOptions) {
  const {
    defaultModel,
    defaultTools = [],
    allAvailableTools = [],
    defaultMiddleware = null,
    defaultInterruptOn = null,
    subagents = [],
    systemPrompt = TASK_SYSTEM_PROMPT,
    generalPurposeAgent = true,
    taskDescription = null,
    dynamicEnabled = true
  } = options

  const tools: StructuredTool[] = []

  if (subagents.length > 0 || generalPurposeAgent) {
    const taskTool = createTaskTool({
      defaultModel,
      defaultTools,
      defaultMiddleware,
      defaultInterruptOn,
      subagents,
      generalPurposeAgent,
      taskDescription
    })
    tools.push(taskTool)
  }

  if (dynamicEnabled) {
    const toolsForDynamicTask = allAvailableTools.length > 0 ? allAvailableTools : defaultTools
    if (toolsForDynamicTask.length > 0) {
      const dynamicTaskTool = createDynamicTaskTool({
        availableTools: toolsForDynamicTask,
        defaultModel,
        defaultMiddleware
      })
      tools.push(dynamicTaskTool)
    }
  }

  return createMiddleware({
    name: 'subAgentMiddleware',
    tools,
    wrapModelCall: async (request, handler) => {
      if (systemPrompt !== null) {
        return handler({
          ...request,
          systemMessage: request.systemMessage.concat(new SystemMessage({ content: systemPrompt }))
        })
      }
      return handler(request)
    }
  })
}
