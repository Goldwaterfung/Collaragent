import { ModelConfig, ToolConfig, SubAgentConfig, MCPServerConfig } from "../../shared/config/types";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogle } from "@langchain/google";
import { ChatOllama } from "@langchain/ollama";
import { ModelManager } from "../config/ModelManager";
import { SubAgent } from "../../collaragent/index";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { toolFactoryMap } from "../tools";
import { loadMCPTools } from "./mcpLoader";

export async function createModel(modelConfig: ModelConfig, apiKey?: string) {
    // Resolve actual model ID (apiModelId) if the ID is a UI-specific one
    const availableModels = new ModelManager().getAvailableModels();
    const modelInfo = availableModels.find(m => m.id === modelConfig.modelId && m.provider === modelConfig.provider);
    const apiModelId = modelInfo?.apiModelId || modelConfig.modelId;
    
    // Generic factory logic
    switch (modelConfig.provider) {
      case "openai":
         return new ChatOpenAI({
           model: apiModelId,
           apiKey: apiKey,
           configuration: modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : undefined,
           streaming: true,
           // @ts-ignore - parallel_tool_calls is a valid option but might be missing in these specific type definitions
           parallel_tool_calls: true,
           ...modelConfig.parameters
         });
      case "anthropic":
        return new ChatAnthropic({
          model: apiModelId,
          apiKey: apiKey,
          streaming: true,
          ...modelConfig.parameters
        });
      case "google":
        return new ChatGoogle({
          model: apiModelId,
          apiKey: apiKey,
          maxOutputTokens: modelConfig.parameters?.maxTokens,
          streaming: true,
          streamUsage: true,
          ...modelConfig.parameters
        });
      case "ollama":
        return new ChatOllama({
          model: apiModelId,
          baseUrl: modelConfig.baseUrl,
          streaming: true,
          ...modelConfig.parameters
        });
      default:
        throw new Error(`Unsupported provider: ${modelConfig.provider}`);
    }
}

export async function createTools(
    toolConfigs: ToolConfig[],
    resolveApiKey: (id: string) => string | undefined,
    mcpServers: MCPServerConfig[] = [],
    options: { ignoreEnabled?: boolean } = {}
) {
    const enabledTools = options.ignoreEnabled ? toolConfigs : toolConfigs.filter(t => t.enabled);
    const initiatedTools: any[] = [];

    // 1. Instantiate built-in tools from the centralized registry
    for (const toolConfig of enabledTools) {
        const factory = (toolFactoryMap as any)[toolConfig.id];
        if (!factory) {
            // Unknown tool id — skip
            continue;
        }
        const apiKey = toolConfig.requireAPI ? resolveApiKey(toolConfig.id) : undefined;
        const instance = await factory(apiKey);
        initiatedTools.push(instance);
    }

    // 2. Fetch and append tools from configured MCP servers
    const mcpTools = await loadMCPTools(
        options.ignoreEnabled ? mcpServers : mcpServers.filter(s => s.enabled), 
        resolveApiKey
    );
    initiatedTools.push(...mcpTools);

    return initiatedTools;
}

export async function createSubAgent(
    subAgentConfig: SubAgentConfig,
    allToolConfigs: ToolConfig[],
    allMCPServerConfigs: MCPServerConfig[],
    resolveApiKey: (provider: string) => string | undefined,
    defaultModel?: BaseLanguageModel | string
): Promise<SubAgent> {
    // 1. Resolve Model
    let model = defaultModel;
    if (subAgentConfig.model) {
        const apiKey = resolveApiKey(subAgentConfig.model.provider);
        model = await createModel(subAgentConfig.model, apiKey);
    }

    // 2. Resolve Tools
    const subAgentToolConfigs = allToolConfigs.filter((t) =>
        subAgentConfig.tools.includes(t.id)
    );
    const subAgentMCPServerConfigs = allMCPServerConfigs.filter((s) =>
        subAgentConfig.mcpServers?.includes(s.id)
    );
    const tools = await createTools(
        subAgentToolConfigs, 
        resolveApiKey, 
        subAgentMCPServerConfigs,
        { ignoreEnabled: true }
    );

    return {
        name: subAgentConfig.name,
        description: subAgentConfig.description,
        systemPrompt: subAgentConfig.systemPrompt,
        tools: (tools as any), // Type cast for now as createTools returns any[]
        model: model,
    };
}

export async function createSubAgents(
    subAgentConfigs: SubAgentConfig[] | undefined,
    allToolConfigs: ToolConfig[],
    allMCPServerConfigs: MCPServerConfig[],
    resolveApiKey: (provider: string) => string | undefined,
    defaultModel?: BaseLanguageModel | string
): Promise<SubAgent[]> {
    if (!subAgentConfigs) return [];

    const subagents: SubAgent[] = [];
    for (const subAgentConfig of subAgentConfigs) {
        if (!subAgentConfig.enabled) continue;

        const subAgent = await createSubAgent(
            subAgentConfig,
            allToolConfigs,
            allMCPServerConfigs,
            resolveApiKey,
            defaultModel
        );
        subagents.push(subAgent);
    }
    return subagents;
}
