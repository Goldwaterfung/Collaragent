import { ConfigManager } from "../config/ConfigManager";
import { PersistenceManager } from "../storage/Persistence";
import { AgentConfigLoader } from "./config";
import { createDeepAgent, DeepAgent } from "../../collaragent/index"; 
import { createModel, createTools, createSubAgents } from "./utils";
import { createSkillsMiddleware } from "../../collaragent/middleware/skills";
import { toolRetryMiddleware } from "langchain";
import { FilesystemBackend } from "../../collaragent/backends/filesystem";
import crypto from "crypto";
import path from "node:path";
import os from "node:os";

export class AgentFactory {
  private configLoader: AgentConfigLoader;
  private persistenceManager: PersistenceManager;
  private sharedCache: Map<string, { model: any; tools: any[]; allAvailableTools: any[]; subagents: any[] }> = new Map();

  constructor(
    configManager: ConfigManager, 
    persistenceManager: PersistenceManager
  ) {
    this.configLoader = new AgentConfigLoader(configManager);
    this.persistenceManager = persistenceManager;
  }

  private buildCacheKey(config: any, apiKey?: string): string {
    const enabledTools = (config.tools || [])
      .filter((t: any) => t.enabled)
      .map((t: any) => ({ id: t.id }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));

    const enabledSubagents = (config.subagents || [])
      .filter((s: any) => s.enabled)
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        systemPrompt: s.systemPrompt,
        tools: [...(s.tools || [])].sort(),
        model: s.model ? { provider: s.model.provider, modelId: s.model.modelId } : undefined
      }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));

    const keyPayload = {
      model: config.model,
      tools: enabledTools,
      subagents: enabledSubagents,
      middleware: config.middleware,
      mcpServers: (config.mcpServers ?? [])
        .filter((s: any) => s.enabled)
        .map((s: any) => ({ id: s.id, transport: s.transport }))
        .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      apiKeyHash: apiKey ? crypto.createHash("sha256").update(apiKey).digest("hex") : ""
    };

    return crypto.createHash("sha256").update(JSON.stringify(keyPayload)).digest("hex");
  }

  async createAgent(runConfig?: { threadId?: string; apiPort?: number }): Promise<DeepAgent<any>> {
    const config = await this.configLoader.loadConfig();
    
    // 1. Create LLM
    const resolveApiKey = (provider: string) => this.configLoader.getApiKey(provider);
    const apiKey = resolveApiKey(config.model.provider);
    const cacheKey = this.buildCacheKey(config, apiKey);
    let cached = this.sharedCache.get(cacheKey);

    if (!cached) {
      const model = await createModel(config.model, apiKey);
      const tools = await createTools(config.tools, resolveApiKey, config.mcpServers ?? []);
      //For dynamic subagents, we need to pass all available tools
      const allAvailableTools = await createTools(config.tools, resolveApiKey, config.mcpServers ?? [], { ignoreEnabled: true });
      const subagents = await createSubAgents(
        config.subagents,
        config.tools,
        config.mcpServers ?? [],
        resolveApiKey,
        model
      );
      cached = { model, tools, allAvailableTools, subagents };
      this.sharedCache.set(cacheKey, cached);
    }
    
    // 3. Get Checkpointer
    const checkpointer = this.persistenceManager.getCheckpointer(
        runConfig?.threadId, 
        runConfig?.apiPort ? { apiPort: runConfig.apiPort } : undefined
    );

    // 5. Create Deep Agent using factory function
    // Note: subagents are typically spawned via the 'task' tool in deepagents.
    // We pass the configured model, tools, and system prompt.
    // If deepagents supports passing specific subagent configs or checkpointer, we pass them here.
    const skillsConfig = config.middleware?.skills;
    const skillsSource = skillsConfig?.enabled && skillsConfig.source
      ? (skillsConfig.source.startsWith('~') ? path.join(os.homedir(), skillsConfig.source.slice(1)) : skillsConfig.source)
      : null;

    const fsBackend = new FilesystemBackend({ rootDir: '/' }); // rootDir '/' for absolute paths
    
    const skillsMiddleware = skillsSource
      ? createSkillsMiddleware({
          backend: fsBackend,
          source: skillsSource,
        })
      : null;

    const agent: any = createDeepAgent({
        model: cached.model,
        backend: fsBackend,
        tools: cached.tools,
        allAvailableTools: cached.allAvailableTools,
        dynamicEnabled: config.middleware?.subAgent?.dynamicEnabled ?? true,
        subagents: cached.subagents,
        checkpointer, 
        // New: inject the composed skills middleware if configured
        middleware: [
            toolRetryMiddleware({ maxRetries: 2, onFailure: "continue" }),
            ...(skillsMiddleware ? [skillsMiddleware] : []),
        ],
        // We can pass a custom system prompt if defined in config, 
        // otherwise deepagents uses its default.
        // We might want to construct a prompt that includes info about available subagents 
        // if we were managing them explicitly, but 'task' tool handles creation.
    });
    return agent;
  }


  getPersistenceManager(): PersistenceManager {
    return this.persistenceManager;
  }
}
