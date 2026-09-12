import { ModelConfig, ToolConfig, SubAgentConfig, MCPServerConfig } from '../../shared/config/types'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogle } from '@langchain/google'
import { ChatOllama } from '@langchain/ollama'
import { ModelManager } from '../config/ModelManager'
import { SubAgent } from '../../collaragent/index'
import { BaseLanguageModel } from '@langchain/core/language_models/base'
import { toolFactoryMap } from '../tools'
import { loadMCPTools } from './mcpLoader'

const COLLARAGENT_USER_AGENT = 'collaragent/1.0.0'
const DEFAULT_OPENCODE_SESSION = 'collaragent-default-session'

export interface CreateModelOptions {
  threadId?: string
}

export async function createModel(
  modelConfig: ModelConfig,
  apiKey?: string,
  options?: CreateModelOptions
) {
  // Resolve actual model ID (apiModelId) and catalog metadata, including legacy
  // `<id>-<level>` composite ids from the previous thinking-variant catalog.
  const modelManager = new ModelManager()
  const resolved = modelManager.resolveModel(modelConfig.provider, modelConfig.modelId)
  const apiModelId = resolved.apiModelId
  const modelInfo = resolved.modelInfo

  const reasoningEffort = modelConfig.reasoningEffort ?? resolved.legacyReasoningEffort
  const reasoningParams = modelManager.buildReasoningParameters(
    modelConfig.provider,
    modelInfo?.id ?? modelConfig.modelId,
    reasoningEffort
  )
  const effectiveParameters = { ...modelConfig.parameters, ...reasoningParams }

  // Determine if this model/request targets OpenCode Go
  const isOpenCode =
    modelConfig.provider === 'opencode-go' || Boolean(modelConfig.baseUrl?.includes('opencode.ai'))
  const sessionId = options?.threadId || DEFAULT_OPENCODE_SESSION

  const opencodeHeaders: Record<string, string> = {
    'x-opencode-session': sessionId,
    'User-Agent': COLLARAGENT_USER_AGENT
  }

  // Generic factory logic
  switch (modelConfig.provider) {
    case 'opencode-go': {
      // Look up wire protocol from catalog metadata
      const wireProtocol = modelInfo?.api || 'openai-completions'
      const isAnthropic = wireProtocol === 'anthropic-messages'
      const defaultBaseUrl = isAnthropic
        ? 'https://opencode.ai/zen/go'
        : 'https://opencode.ai/zen/go/v1'
      const effectiveBaseUrl = modelConfig.baseUrl || modelInfo?.baseUrl || defaultBaseUrl

      if (isAnthropic) {
        return new ChatAnthropic({
          model: apiModelId,
          apiKey: apiKey,
          streaming: true,
          anthropicApiUrl: effectiveBaseUrl,
          clientOptions: {
            baseURL: effectiveBaseUrl,
            defaultHeaders: opencodeHeaders
          },
          ...effectiveParameters
        })
      }

      return new ChatOpenAI({
        model: apiModelId,
        apiKey: apiKey,
        configuration: {
          baseURL: effectiveBaseUrl,
          defaultHeaders: opencodeHeaders
        },
        streaming: true,
        modelKwargs: {
          parallel_tool_calls: true
        },
        ...effectiveParameters
      })
    }
    case 'openai': {
      const defaultHeaders = isOpenCode ? opencodeHeaders : undefined
      return new ChatOpenAI({
        model: apiModelId,
        apiKey: apiKey,
        configuration:
          modelConfig.baseUrl || defaultHeaders
            ? {
                baseURL: modelConfig.baseUrl,
                defaultHeaders
              }
            : undefined,
        streaming: true,
        modelKwargs: {
          parallel_tool_calls: true
        },
        ...effectiveParameters
      })
    }
    case 'anthropic': {
      const defaultHeaders = isOpenCode ? opencodeHeaders : undefined
      return new ChatAnthropic({
        model: apiModelId,
        apiKey: apiKey,
        streaming: true,
        anthropicApiUrl: modelConfig.baseUrl,
        clientOptions:
          modelConfig.baseUrl || defaultHeaders
            ? {
                baseURL: modelConfig.baseUrl,
                defaultHeaders
              }
            : undefined,
        ...effectiveParameters
      })
    }
    case 'google':
      return new ChatGoogle({
        model: apiModelId,
        apiKey: apiKey,
        maxOutputTokens: modelConfig.parameters?.maxTokens,
        streaming: true,
        streamUsage: true,
        ...effectiveParameters
      })
    case 'ollama':
      return new ChatOllama({
        model: apiModelId,
        baseUrl: modelConfig.baseUrl,
        streaming: true,
        ...effectiveParameters
      })
    default:
      throw new Error(`Unsupported provider: ${modelConfig.provider}`)
  }
}

export async function createTools(
  toolConfigs: ToolConfig[],
  resolveApiKey: (id: string) => string | undefined,
  mcpServers: MCPServerConfig[] = [],
  options: { ignoreEnabled?: boolean } = {}
) {
  const enabledTools = options.ignoreEnabled ? toolConfigs : toolConfigs.filter((t) => t.enabled)
  const initiatedTools: any[] = []

  // 1. Instantiate built-in tools from the centralized registry
  for (const toolConfig of enabledTools) {
    const factory = (toolFactoryMap as any)[toolConfig.id]
    if (!factory) {
      // Unknown tool id — skip
      continue
    }
    const apiKey = toolConfig.requireAPI ? resolveApiKey(toolConfig.id) : undefined
    const instance = await factory(apiKey)
    initiatedTools.push(instance)
  }

  // 2. Fetch and append tools from configured MCP servers
  const mcpTools = await loadMCPTools(
    options.ignoreEnabled ? mcpServers : mcpServers.filter((s) => s.enabled),
    resolveApiKey
  )
  initiatedTools.push(...mcpTools)

  return initiatedTools
}

export async function createSubAgent(
  subAgentConfig: SubAgentConfig,
  allToolConfigs: ToolConfig[],
  allMCPServerConfigs: MCPServerConfig[],
  resolveApiKey: (provider: string) => string | undefined,
  defaultModel?: BaseLanguageModel | string,
  options?: CreateModelOptions
): Promise<SubAgent> {
  // 1. Resolve Model
  let model = defaultModel
  if (subAgentConfig.model) {
    const apiKey = resolveApiKey(subAgentConfig.model.provider)
    model = await createModel(subAgentConfig.model, apiKey, options)
  }

  // 2. Resolve Tools
  const subAgentToolConfigs = allToolConfigs.filter((t) => subAgentConfig.tools.includes(t.id))
  const subAgentMCPServerConfigs = allMCPServerConfigs.filter((s) =>
    subAgentConfig.mcpServers?.includes(s.id)
  )
  const tools = await createTools(subAgentToolConfigs, resolveApiKey, subAgentMCPServerConfigs, {
    ignoreEnabled: true
  })

  return {
    name: subAgentConfig.name,
    description: subAgentConfig.description,
    systemPrompt: subAgentConfig.systemPrompt,
    tools: tools as any, // Type cast for now as createTools returns any[]
    model: model
  }
}

export async function createSubAgents(
  subAgentConfigs: SubAgentConfig[] | undefined,
  allToolConfigs: ToolConfig[],
  allMCPServerConfigs: MCPServerConfig[],
  resolveApiKey: (provider: string) => string | undefined,
  defaultModel?: BaseLanguageModel | string,
  options?: CreateModelOptions
): Promise<SubAgent[]> {
  if (!subAgentConfigs) return []

  const subagents: SubAgent[] = []
  for (const subAgentConfig of subAgentConfigs) {
    if (!subAgentConfig.enabled) continue

    const subAgent = await createSubAgent(
      subAgentConfig,
      allToolConfigs,
      allMCPServerConfigs,
      resolveApiKey,
      defaultModel,
      options
    )
    subagents.push(subAgent)
  }
  return subagents
}
