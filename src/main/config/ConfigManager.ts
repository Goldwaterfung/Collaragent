import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { AppConfig, SubAgentConfig, ModelConfig, MCPServerConfig } from '../../shared/config/types'
import { AppConfigSchema } from '../../shared/config/schemas'
import { DEFAULT_CONFIG } from '../../shared/config/defaults'
import { SecureStorage } from './SecureStorage'
import { ModelManager } from './ModelManager'
import { ToolManager } from './ToolManager'
import { logger } from '../utils/Logger'

export class ConfigManager {
  private configPath: string
  private currentConfig: AppConfig
  private secureStorage: SecureStorage
  private modelManager: ModelManager

  constructor(secureStorage: SecureStorage, modelManager: ModelManager) {
    this.secureStorage = secureStorage
    this.modelManager = modelManager

    const configDir = path.join(app.getPath('home'), '.collaragent')
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }

    this.configPath = path.join(configDir, 'config.json')
    this.currentConfig = this.loadConfig()
    this.syncTelemetryEnv(this.currentConfig)
  }

  private syncTelemetryEnv(config: AppConfig): void {
    if (config.telemetry?.enabled) {
      if (config.telemetry.baseUrl) {
        process.env.LANGFUSE_BASE_URL = config.telemetry.baseUrl
      }
      if (config.telemetry.publicKey) {
        process.env.LANGFUSE_PUBLIC_KEY = config.telemetry.publicKey
      }
      const secretKey = this.getApiKey('langfuse')
      if (secretKey) {
        process.env.LANGFUSE_SECRET_KEY = secretKey
      }
    }
  }

  // ==========================================================================
  // Core Config Operations
  // ==========================================================================

  getConfig(): AppConfig {
    return this.currentConfig
  }

  private loadConfig(): AppConfig {
    try {
      let config: AppConfig = DEFAULT_CONFIG

      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)

        // Validate against schema
        const result = AppConfigSchema.safeParse(parsed)
        if (result.success) {
          config = result.data
        } else {
          logger.error('Config validation failed, falling back to default', result.error)
          config = DEFAULT_CONFIG
        }
      }

      // Merge with available tools to ensure new tools appear
      // This handles the case where new tools are added to the codebase
      // but aren't yet in the persisted config.json
      const availableTools = new ToolManager().getAllAvailableTools()
      const mergedTools = availableTools.map((availableTool) => {
        const existingConfig = config.tools.find((t) => t.id === availableTool.id)
        return {
          ...availableTool,
          enabled: existingConfig ? existingConfig.enabled : false, // Default to disabled for new tools, or true if preferred
          // Ensure we have the latest metadata (name, langchainTool path) from code
          name: availableTool.name,
          langchainTool: availableTool.langchainTool,
          requireAPI: availableTool.requireAPI
        }
      })

      // Also keep any tools that might be in config but not in available (custom tools? or deprecated)
      // For now, let's strictly sync with available tools to avoid ghosts,
      // but if we supported custom user tools we'd need to keep them.
      // Assuming strictly code-defined tools for now as per ToolManager structure.

      const mergedConfig = {
        ...config,
        tools: mergedTools
      }

      // Create config.json if it doesn't exist
      if (!fs.existsSync(this.configPath)) {
        logger.info('Config file not found, creating default config.json')
        fs.writeFileSync(this.configPath, JSON.stringify(mergedConfig, null, 2))
      }

      return mergedConfig
    } catch (err) {
      logger.error('Failed to load config', err)
    }
    return DEFAULT_CONFIG
  }

  async saveConfig(config: AppConfig): Promise<boolean> {
    try {
      // Validate first
      const result = AppConfigSchema.safeParse(config)
      if (!result.success) {
        logger.error('Cannot save invalid config', result.error)
        return false
      }

      const toSave = result.data
      fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2))
      this.currentConfig = toSave
      this.syncTelemetryEnv(toSave)
      logger.info('Configuration saved successfully')
      return true
    } catch (err) {
      logger.error('Failed to save config', err)
      return false
    }
  }

  // ==========================================================================
  // Subagent Operations
  // ==========================================================================

  async addSubagent(subagent: SubAgentConfig): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    // Check for ID collision
    if (newConfig.subagents.some((s) => s.id === subagent.id)) {
      return false
    }
    newConfig.subagents.push(subagent)
    return this.saveConfig(newConfig)
  }

  async updateSubagent(id: string, updates: Partial<SubAgentConfig>): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    const index = newConfig.subagents.findIndex((s) => s.id === id)
    if (index === -1) return false

    newConfig.subagents[index] = { ...newConfig.subagents[index], ...updates }
    return this.saveConfig(newConfig)
  }

  async deleteSubagent(id: string): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    const initialLength = newConfig.subagents.length
    newConfig.subagents = newConfig.subagents.filter((s) => s.id !== id)

    if (newConfig.subagents.length === initialLength) return false
    return this.saveConfig(newConfig)
  }

  // ==========================================================================
  // Tool Operations
  // ==========================================================================

  async toggleTool(toolId: string, enabled: boolean): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    const tool = newConfig.tools.find((t) => t.id === toolId)
    if (tool) {
      tool.enabled = enabled
      return this.saveConfig(newConfig)
    }
    return false
  }

  // ==========================================================================
  // MCP Server Operations
  // ==========================================================================

  async addMCPServer(server: MCPServerConfig): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    if (!newConfig.mcpServers) newConfig.mcpServers = []

    // Check for ID collision
    if (newConfig.mcpServers.some((s) => s.id === server.id)) {
      return false
    }

    newConfig.mcpServers.push(server)
    return this.saveConfig(newConfig)
  }

  async updateMCPServer(id: string, updates: Partial<MCPServerConfig>): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    if (!newConfig.mcpServers) return false

    const index = newConfig.mcpServers.findIndex((s) => s.id === id)
    if (index === -1) return false

    newConfig.mcpServers[index] = { ...newConfig.mcpServers[index], ...updates }
    return this.saveConfig(newConfig)
  }

  async deleteMCPServer(id: string): Promise<boolean> {
    const newConfig = { ...this.currentConfig }
    if (!newConfig.mcpServers) return false

    const initialLength = newConfig.mcpServers.length
    newConfig.mcpServers = newConfig.mcpServers.filter((s) => s.id !== id)

    if (newConfig.mcpServers.length === initialLength) return false
    return this.saveConfig(newConfig)
  }

  async toggleMCPServer(id: string, enabled: boolean): Promise<boolean> {
    return this.updateMCPServer(id, { enabled })
  }

  // ==========================================================================
  // Model Operations
  // ==========================================================================

  async setModel(modelConfig: ModelConfig): Promise<boolean> {
    if (!modelConfig.modelId || modelConfig.modelId.trim() === '') {
      logger.error('Attempted to set model with empty modelId')
      return false
    }

    const availableModels = this.modelManager.getAvailableModels()
    const catalogModel = availableModels.find(
      (m) => m.id === modelConfig.modelId && m.provider === modelConfig.provider
    )

    const newConfig = { ...this.currentConfig }
    newConfig.model = {
      ...modelConfig,
      parameters: catalogModel?.parameters ?? modelConfig.parameters ?? { temperature: 0.7 }
    }
    return this.saveConfig(newConfig)
  }

  // ==========================================================================
  // Key Management Operations (Delegated to SecureStorage)
  // ==========================================================================

  setApiKey(provider: string, apiKey: string): boolean {
    const success = this.secureStorage.setApiKey(provider, apiKey)
    if (success && provider === 'langfuse') {
      process.env.LANGFUSE_SECRET_KEY = apiKey
    }
    return success
  }

  getApiKey(provider: string): string | undefined {
    return this.secureStorage.getApiKey(provider)
  }

  getTelemetryConfig(): {
    enabled: boolean
    baseUrl: string
    publicKey?: string
    secretKey?: string
  } {
    const telemetry = this.currentConfig.telemetry
    const enabled = telemetry?.enabled ?? false
    const baseUrl = telemetry?.baseUrl || 'http://localhost:3000'
    const publicKey = telemetry?.publicKey || process.env.LANGFUSE_PUBLIC_KEY
    const secretKey = this.getApiKey('langfuse') || process.env.LANGFUSE_SECRET_KEY

    return {
      enabled,
      baseUrl,
      publicKey: publicKey || undefined,
      secretKey: secretKey || undefined
    }
  }

  // ==========================================================================
  // Recent Files Operations
  // ==========================================================================

  async addRecentFile(filePath: string): Promise<boolean> {
    const config = { ...this.currentConfig }
    const name = path.basename(filePath)

    // Remove if exists
    config.recentFiles = (config.recentFiles || []).filter((f) => f.path !== filePath)

    // Add to top
    config.recentFiles.unshift({
      path: filePath,
      name,
      lastOpened: Date.now()
    })

    // Limit to 5
    if (config.recentFiles.length > 3) {
      config.recentFiles = config.recentFiles.slice(0, 3)
    }

    return this.saveConfig(config)
  }

  async removeRecentFile(filePath: string): Promise<boolean> {
    const config = { ...this.currentConfig }
    const originalLength = (config.recentFiles || []).length

    config.recentFiles = (config.recentFiles || []).filter((f) => f.path !== filePath)

    if (config.recentFiles.length === originalLength) {
      return false
    }

    return this.saveConfig(config)
  }
}
