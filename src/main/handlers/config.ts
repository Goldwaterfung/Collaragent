import { ipcMain } from 'electron'
import { ConfigManager } from '../config/ConfigManager'
import { ModelManager } from '../config/ModelManager'
import * as Channels from '../../shared/ipc/config/channels'
import * as Types from '../../shared/ipc/config/types'

export function registerConfigHandlers(configManager: ConfigManager, modelManager: ModelManager) {
  // Get Configuration
  ipcMain.handle(Channels.CONFIG_GET, async (): Promise<Types.ConfigGetResponse> => {
    return { config: configManager.getConfig() }
  })

  // Save Configuration
  ipcMain.handle(
    Channels.CONFIG_SAVE,
    async (_, request: Types.ConfigSaveRequest): Promise<Types.ConfigSaveResponse> => {
      const success = await configManager.saveConfig(request.config)
      return { success }
    }
  )

  // Add Subagent
  ipcMain.handle(
    Channels.CONFIG_ADD_SUBAGENT,
    async (
      _,
      request: Types.ConfigAddSubagentRequest
    ): Promise<Types.ConfigAddSubagentResponse> => {
      const success = await configManager.addSubagent(request.subagent)
      return { success }
    }
  )

  // Update Subagent
  ipcMain.handle(
    Channels.CONFIG_UPDATE_SUBAGENT,
    async (
      _,
      request: Types.ConfigUpdateSubagentRequest
    ): Promise<Types.ConfigUpdateSubagentResponse> => {
      const success = await configManager.updateSubagent(request.id, request.updates)
      return { success }
    }
  )

  // Delete Subagent
  ipcMain.handle(
    Channels.CONFIG_DELETE_SUBAGENT,
    async (
      _,
      request: Types.ConfigDeleteSubagentRequest
    ): Promise<Types.ConfigDeleteSubagentResponse> => {
      const success = await configManager.deleteSubagent(request.id)
      return { success }
    }
  )

  // Toggle Tool
  ipcMain.handle(
    Channels.CONFIG_TOGGLE_TOOL,
    async (_, request: Types.ConfigToggleToolRequest): Promise<Types.ConfigToggleToolResponse> => {
      const success = await configManager.toggleTool(request.toolId, request.enabled)
      return { success }
    }
  )

  // Set Tool API Key
  ipcMain.handle(
    Channels.CONFIG_SET_TOOL_API_KEY,
    async (
      _,
      request: Types.ConfigSetToolAPIKeyRequest
    ): Promise<Types.ConfigSetToolAPIKeyResponse> => {
      const success = configManager.setApiKey(request.toolId, request.apiKey)
      return { success }
    }
  )

  // Check if key exists
  ipcMain.handle(
    Channels.CONFIG_CHECK_KEY,
    async (_, request: Types.ConfigCheckKeyRequest): Promise<Types.ConfigCheckKeyResponse> => {
      const exists = !!configManager.getApiKey(request.id)
      return { exists }
    }
  )

  // Set Model
  ipcMain.handle(
    Channels.CONFIG_SET_MODEL,
    async (_, request: Types.ConfigSetModelRequest): Promise<Types.ConfigSetModelResponse> => {
      // 1. Store API Key if provided
      if (request.apiKey) {
        configManager.setApiKey(request.provider, request.apiKey)
      }

      // 2. Update Model Config
      const modelConfig = {
        provider: request.provider,
        modelId: request.modelId,
        name: request.name,
        baseUrl: request.baseUrl,
        parameters: request.parameters
      }

      const success = await configManager.setModel(modelConfig)
      return { success }
    }
  )

  // Add MCP Server
  ipcMain.handle(
    Channels.CONFIG_ADD_MCP_SERVER,
    async (
      _,
      request: Types.ConfigAddMCPServerRequest
    ): Promise<Types.ConfigAddMCPServerResponse> => {
      const success = await configManager.addMCPServer(request.server)
      return { success }
    }
  )

  // Update MCP Server
  ipcMain.handle(
    Channels.CONFIG_UPDATE_MCP_SERVER,
    async (
      _,
      request: Types.ConfigUpdateMCPServerRequest
    ): Promise<Types.ConfigUpdateMCPServerResponse> => {
      const success = await configManager.updateMCPServer(request.id, request.updates)
      return { success }
    }
  )

  // Delete MCP Server
  ipcMain.handle(
    Channels.CONFIG_DELETE_MCP_SERVER,
    async (
      _,
      request: Types.ConfigDeleteMCPServerRequest
    ): Promise<Types.ConfigDeleteMCPServerResponse> => {
      const success = await configManager.deleteMCPServer(request.id)
      return { success }
    }
  )

  // Toggle MCP Server
  ipcMain.handle(
    Channels.CONFIG_TOGGLE_MCP_SERVER,
    async (
      _,
      request: Types.ConfigToggleMCPServerRequest
    ): Promise<Types.ConfigToggleMCPServerResponse> => {
      const success = await configManager.toggleMCPServer(request.id, request.enabled)
      return { success }
    }
  )

  // Get Available Models
  ipcMain.handle(Channels.CONFIG_GET_MODELS, async (): Promise<Types.ConfigGetModelsResponse> => {
    return { models: modelManager.getAvailableModels() }
  })

  // Fetch MCP Tools
  ipcMain.handle(
    Channels.CONFIG_FETCH_MCP_TOOLS,
    async (
      _,
      request: Types.ConfigFetchMCPToolsRequest
    ): Promise<Types.ConfigFetchMCPToolsResponse> => {
      try {
        const config = configManager.getConfig()
        const serverConfig = config.mcpServers.find((s: any) => s.id === request.serverId)

        if (!serverConfig) {
          return { success: false, tools: [], error: `Server ${request.serverId} not found` }
        }

        // Dynamic import to avoid circular dependencies if any
        const { fetchToolsForServer } = await import('../agents/mcpLoader')

        const tools = await fetchToolsForServer(serverConfig, (id: string) =>
          configManager.getApiKey(id)
        )

        return { success: true, tools }
      } catch (err: any) {
        return { success: false, tools: [], error: err.message || 'Failed to fetch tools' }
      }
    }
  )

  // Test Telemetry Connection
  ipcMain.handle(
    Channels.CONFIG_TEST_TELEMETRY,
    async (
      _,
      request: Types.ConfigTestTelemetryRequest
    ): Promise<Types.ConfigTestTelemetryResponse> => {
      const { checkLangfuseHealth } = await import('../../collaragent/telemetry/index')
      const secretKey = request.secretKey || configManager.getApiKey('langfuse')
      const publicKey = request.publicKey || configManager.getConfig().telemetry?.publicKey
      const result = await checkLangfuseHealth(request.baseUrl, { publicKey, secretKey })
      return {
        success: result.ok,
        status: result.status,
        message: result.message,
        error: result.error
      }
    }
  )
}
