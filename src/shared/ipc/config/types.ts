import { AppConfig, SubAgentConfig, ModelInfo, MCPServerConfig } from "../../config/types";

// ============================================================================
// CONFIG IPC REQUEST TYPES
// ============================================================================

/**
 * Get configuration request
 */
export interface ConfigGetRequest {
  // No parameters needed
}

/**
 * Save configuration request
 */
export interface ConfigSaveRequest {
  config: AppConfig;
}

/**
 * Add subagent request
 */
export interface ConfigAddSubagentRequest {
  subagent: SubAgentConfig;
}

/**
 * Update subagent request
 */
export interface ConfigUpdateSubagentRequest {
  id: string;
  updates: Partial<SubAgentConfig>;
}

/**
 * Delete subagent request
 */
export interface ConfigDeleteSubagentRequest {
  id: string;
}

/**
 * Toggle tool request
 */
export interface ConfigToggleToolRequest {
  toolId: string;
  enabled: boolean;
}

/**
 * Set model request
 */
export interface ConfigSetModelRequest {
  provider: "openai" | "anthropic" | "google" | "ollama";
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Add MCP server request
 */
export interface ConfigAddMCPServerRequest {
  server: MCPServerConfig;
}

/**
 * Update MCP server request
 */
export interface ConfigUpdateMCPServerRequest {
  id: string;
  updates: Partial<MCPServerConfig>;
}

/**
 * Delete MCP server request
 */
export interface ConfigDeleteMCPServerRequest {
  id: string;
}

/**
 * Toggle MCP server request
 */
export interface ConfigToggleMCPServerRequest {
  id: string;
  enabled: boolean;
}

/**
 * Fetch tools for an MCP server on demand
 */
export interface ConfigFetchMCPToolsRequest {
  serverId: string;
}

/**
 * Set tool API key request
 */
export interface ConfigSetToolAPIKeyRequest {
  toolId: string;
  apiKey: string;
}

/**
 * Check if a key exists request
 */
export interface ConfigCheckKeyRequest {
  id: string; // provider or toolId/serverId
}

/**
 * Check if a key exists response
 */
export interface ConfigCheckKeyResponse {
  exists: boolean;
}

/**
 * Get available models request
 */
export interface ConfigGetModelsRequest {
  // No parameters needed
}

/**
 * Get available models response
 */
export interface ConfigGetModelsResponse {
  models: ModelInfo[];
}

// ============================================================================
// CONFIG IPC RESPONSE TYPES
// ============================================================================

/**
 * Get configuration response
 */
export interface ConfigGetResponse {
  config: AppConfig;
}

/**
 * Save configuration response
 */
export interface ConfigSaveResponse {
  success: boolean;
  error?: string;
}

/**
 * Add/Update/Delete subagent response
 */
export interface ConfigSubagentResponse {
  success: boolean;
  error?: string;
}

/**
 * Add subagent response (alias for clarity)
 */
export type ConfigAddSubagentResponse = ConfigSubagentResponse;

/**
 * Update subagent response (alias for clarity)
 */
export type ConfigUpdateSubagentResponse = ConfigSubagentResponse;

/**
 * Delete subagent response (alias for clarity)
 */
export type ConfigDeleteSubagentResponse = ConfigSubagentResponse;


/**
 * Toggle tool response
 */
export interface ConfigToggleToolResponse {
  success: boolean;
  error?: string;
}

/**
 * Set model response
 */
export interface ConfigSetModelResponse {
  success: boolean;
  error?: string;
}

/**
 * MCP Server response
 */
export interface ConfigMCPServerResponse {
  success: boolean;
  error?: string;
}

export type ConfigAddMCPServerResponse = ConfigMCPServerResponse;
export type ConfigUpdateMCPServerResponse = ConfigMCPServerResponse;
export type ConfigDeleteMCPServerResponse = ConfigMCPServerResponse;
export type ConfigToggleMCPServerResponse = ConfigMCPServerResponse;
export type ConfigSetToolAPIKeyResponse = { success: boolean; error?: string };

export interface ConfigFetchMCPToolsResponse {
  success: boolean;
  tools: { name: string; description?: string }[];
  error?: string;
}
// ============================================================================
// ERROR RESPONSE TYPE
// ============================================================================

/**
 * IPC error response
 */
export interface IPCErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Type guard for IPC error
 */
export function isIPCError(response: unknown): response is IPCErrorResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    "success" in response &&
    (response as IPCErrorResponse).success === false
  );
}
