import {
  createAgent,
  humanInTheLoopMiddleware,
  SystemMessage,
  type AgentMiddleware,
  type ResponseFormat
} from 'langchain'
import type { ClientTool, ServerTool, StructuredTool } from '@langchain/core/tools'
import type { InteropZodObject } from '@langchain/core/utils/types'
import {
  createFilesystemMiddleware,
  createPatchToolCallsMiddleware,
  createSummarizationMiddleware,
  StateBackend,
  type AnyBackendProtocol,
  type BackendFactory,
  type SystemPromptConfig,
  type DeepAgent,
  type DeepAgentTypeConfig,
  type FlattenSubAgentMiddleware,
  type SubAgent,
  type CompiledSubAgent,
  type CreateDeepAgentParams as UpstreamCreateDeepAgentParams
} from 'deepagents'
import {
  createWorkspaceMiddleware,
  dateMiddleware,
  createModelResponseNormalizerMiddleware,
  createSubAgentMiddleware
} from '../middleware/index.js'

export const BASE_PROMPT =
  'In order to complete the objective that the user asks of you, you have access to a number of standard tools.'

function resolveSystemPrompt(
  prompt: string | SystemMessage | SystemPromptConfig | undefined
): string | SystemMessage {
  if (!prompt) return BASE_PROMPT
  if (typeof prompt === 'string') return `${prompt}\n\n${BASE_PROMPT}`
  if (prompt instanceof SystemMessage) {
    const rawContent = prompt.content
    const text = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)
    return new SystemMessage({
      content: `${text}\n\n${BASE_PROMPT}`
    })
  }
  const parts: string[] = []
  if (prompt.prefix) {
    parts.push(typeof prompt.prefix === 'string' ? prompt.prefix : String(prompt.prefix.content))
  }
  const basePrompt =
    prompt.base !== undefined
      ? typeof prompt.base === 'string'
        ? prompt.base
        : prompt.base
          ? String(prompt.base.content)
          : ''
      : BASE_PROMPT
  if (basePrompt) parts.push(basePrompt)
  if (prompt.suffix) {
    parts.push(typeof prompt.suffix === 'string' ? prompt.suffix : String(prompt.suffix.content))
  }
  return parts.join('\n\n')
}

export interface CreateCollarAgentParams<
  TResponse extends ResponseFormat = ResponseFormat,
  ContextSchema extends InteropZodObject = InteropZodObject,
  TMiddleware extends readonly AgentMiddleware[] = readonly AgentMiddleware[],
  TSubagents extends readonly (SubAgent | CompiledSubAgent)[] = readonly (
    SubAgent | CompiledSubAgent
  )[],
  TTools extends readonly (ClientTool | ServerTool)[] = readonly (ClientTool | ServerTool)[]
> extends Omit<
  UpstreamCreateDeepAgentParams<TResponse, ContextSchema>,
  'tools' | 'subagents' | 'middleware'
> {
  tools?: TTools | StructuredTool[]
  allAvailableTools?: StructuredTool[]
  dynamicEnabled?: boolean
  workspaceReadOnly?: boolean
  middleware?: TMiddleware | AgentMiddleware[]
  subagents?: TSubagents
}

export { type CreateCollarAgentParams as CreateDeepAgentParams }

/**
 * Create a Deep Agent with CollarAgent studio extensions and custom subagent wiring.
 *
 * Enforces CollarAgent custom subagent contracts:
 * - Direct execution of custom subagents with custom tool settings
 * - SubagentSessionData artifact extraction for UI rendering
 * - Isolated stream chunk tagging (subagent:${toolCallId})
 * - Elimination of upstream preset general-purpose subagent
 * - Dynamic subagent generation via dynamic_task tool
 * - Visual canvas and document management via createWorkspaceMiddleware
 * - Date and time awareness via dateMiddleware
 * - Non-Anthropic model response normalization via createModelResponseNormalizerMiddleware
 * - Upstream deepagents filesystem, summarization, and tool call patch middleware
 */
export function createDeepAgent<
  TResponse extends ResponseFormat = ResponseFormat,
  ContextSchema extends InteropZodObject = InteropZodObject,
  const TMiddleware extends readonly AgentMiddleware[] = readonly [],
  const TSubagents extends readonly (SubAgent | CompiledSubAgent)[] = readonly [],
  const TTools extends readonly (ClientTool | ServerTool)[] = readonly []
>(
  params: CreateCollarAgentParams<
    TResponse,
    ContextSchema,
    TMiddleware,
    TSubagents,
    TTools
  > = {} as CreateCollarAgentParams<TResponse, ContextSchema, TMiddleware, TSubagents, TTools>
): DeepAgent<
  DeepAgentTypeConfig<
    TResponse,
    undefined,
    ContextSchema,
    readonly [...AgentMiddleware[], ...TMiddleware, ...FlattenSubAgentMiddleware<TSubagents>],
    TTools,
    TSubagents
  >
> {
  const {
    model = 'claude-sonnet-4-5-20250929',
    tools = [],
    allAvailableTools = [],
    systemPrompt,
    dynamicEnabled = true,
    workspaceReadOnly = false,
    middleware: customMiddleware = [],
    subagents = [] as unknown as TSubagents,
    responseFormat,
    contextSchema,
    checkpointer,
    backend,
    interruptOn,
    name,
    store
  } = params

  const effectiveTools: StructuredTool[] = [...(tools as StructuredTool[])]
  const effectiveAllAvailableTools: StructuredTool[] =
    allAvailableTools.length > 0 ? (allAvailableTools as StructuredTool[]) : effectiveTools

  const finalSystemPrompt = resolveSystemPrompt(systemPrompt)

  const filesystemBackend: AnyBackendProtocol | BackendFactory =
    backend || (() => new StateBackend())

  // Wire CollarAgent custom subagents and eliminate upstream preset general-purpose subagent
  const subagentMiddleware =
    (subagents != null && subagents.length > 0) || dynamicEnabled
      ? [
          createSubAgentMiddleware({
            defaultModel: model,
            defaultTools: effectiveTools,
            allAvailableTools: effectiveAllAvailableTools,
            defaultMiddleware: [
              dateMiddleware(),
              createWorkspaceMiddleware({ readOnly: workspaceReadOnly }),
              createFilesystemMiddleware({ backend: filesystemBackend }),
              createPatchToolCallsMiddleware()
            ],
            defaultInterruptOn: interruptOn,
            subagents: subagents as readonly (SubAgent | CompiledSubAgent)[],
            generalPurposeAgent: false, // Strictly eliminate preset subagents
            dynamicEnabled
          })
        ]
      : []

  const builtInMiddleware: AgentMiddleware[] = [
    dateMiddleware(),
    createWorkspaceMiddleware({ readOnly: workspaceReadOnly }),
    createFilesystemMiddleware({ backend: filesystemBackend }),
    createSummarizationMiddleware({ backend: filesystemBackend }),
    createPatchToolCallsMiddleware(),
    ...subagentMiddleware
  ]

  if (interruptOn) {
    builtInMiddleware.push(humanInTheLoopMiddleware({ interruptOn }))
  }

  // Ensure createModelResponseNormalizerMiddleware is always placed at the very end (innermost layer)
  // so it intercepts and normalizes raw model responses before any other middleware's wrapModelCall sees it.
  const filteredCustomMiddleware = (customMiddleware as AgentMiddleware[]).filter(
    (m) => m.name !== 'modelResponseNormalizerMiddleware'
  )

  const allMiddleware: AgentMiddleware[] = [
    ...builtInMiddleware,
    ...filteredCustomMiddleware,
    createModelResponseNormalizerMiddleware()
  ]

  const agent = createAgent({
    model,
    systemPrompt: finalSystemPrompt,
    tools: effectiveTools,
    middleware: allMiddleware,
    ...(responseFormat ? { responseFormat: responseFormat as ResponseFormat } : {}),
    contextSchema,
    checkpointer,
    store,
    name
  })

  return agent as unknown as DeepAgent<
    DeepAgentTypeConfig<
      TResponse,
      undefined,
      ContextSchema,
      readonly [...AgentMiddleware[], ...TMiddleware, ...FlattenSubAgentMiddleware<TSubagents>],
      TTools,
      TSubagents
    >
  >
}
