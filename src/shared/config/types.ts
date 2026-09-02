// ============================================================================
// APP CONFIGURATION TYPES
// ============================================================================

/**
 * Application configuration stored in config.json
 */
export interface AppConfig {
  /** Model configuration */
  model: ModelConfig

  /** List of configured subagents */
  subagents: SubAgentConfig[]

  /** List of available tools with enable/disable state */
  tools: ToolConfig[]

  /** Middleware configuration */
  middleware: MiddlewareConfig

  /** MCP Server configurations */
  mcpServers: MCPServerConfig[]

  /** Telemetry and observability configuration */
  telemetry?: TelemetryConfig

  /** Recent files list */
  recentFiles: RecentFile[]
}

/**
 * Telemetry configuration for live Langfuse observability
 */
export interface TelemetryConfig {
  /** Whether telemetry tracing is enabled */
  enabled: boolean

  /** Base URL for the Langfuse server (e.g. http://localhost:3000) */
  baseUrl: string

  /** Public Key for Langfuse authentication */
  publicKey?: string
}

/**
 * Recent file entry
 */
export interface RecentFile {
  path: string
  name: string
  lastOpened: number // timestamp
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Provider selection */
  provider: 'openai' | 'anthropic' | 'google' | 'ollama'

  /** Model identifier (e.g., gpt-4, claude-3-5-sonnet) */
  modelId: string

  /** Display name for manual/custom model */
  name?: string

  /** Base URL (required for Ollama, optional for others) */
  baseUrl?: string

  /** Additional model parameters */
  parameters?: {
    temperature?: number
    maxTokens?: number
    [key: string]: unknown
  }
}

/**
 * Subagent configuration
 */
export interface SubAgentConfig {
  /** Unique identifier */
  id: string

  /** Display name */
  name: string

  /** Description for main agent to decide delegation */
  description: string

  /** System prompt for this subagent */
  systemPrompt: string

  /** List of tool IDs this subagent can use */
  tools: string[]

  /** List of MCP server IDs this subagent can use */
  mcpServers?: string[]

  /** Whether this subagent is enabled */
  enabled: boolean

  /** Override main agent model (optional) */
  model?: {
    provider: 'openai' | 'anthropic' | 'google' | 'ollama'
    modelId: string
  }
}

/**
 * Tool configuration
 */
export interface ToolConfig {
  /** Unique identifier */
  id: string

  /** Display name */
  name: string

  /** Whether this tool is enabled */
  enabled: boolean

  /** Reference to built-in LangChain tool */
  langchainTool: string

  /** Whether this tool requires an API key */
  requireAPI?: boolean
}

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  /** SubAgent middleware settings */
  subAgent: {
    enabled: boolean
    /** Whether dynamic subagents (dynamic_task) are enabled */
    dynamicEnabled: boolean
    /** Build-in recursion limit to prevent infinite loops */
    recursionLimit: number
  }

  /** Skills middleware settings */
  skills: {
    /**
     * Whether the skills middleware is active.
     */
    enabled: boolean

    /**
     * Filesystem directory to scan for skills.
     */
    source: string
  }
}

/**
 * MCP Server Transport types
 */
export type MCPTransportType = 'stdio' | 'sse' | 'http'

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  /** Unique identifier for the server */
  id: string

  /** Display name for the server */
  name: string

  /** Whether this server is enabled */
  enabled: boolean

  /** Whether this server requires an API key in SecureStorage */
  requireAPI?: boolean

  /** The environment variable name to inject the API key as (defaults to API_KEY) */
  apiKeyName?: string

  /** Transport configuration */
  transport: {
    type: MCPTransportType

    /** Required for stdio transport */
    command?: string
    args?: string[]
    env?: Record<string, string>

    /** Required for sse and http transports */
    url?: string
  }

  /** Array of tool names the user turned off */
  disabledTools?: string[]
}

// ============================================================================
// MODEL INFO TYPES
// ============================================================================

/**
 * Available model information
 */
export interface ModelInfo {
  /** Model identifier */
  id: string

  /** Actual API model ID (if different from UI id) */
  apiModelId?: string

  /** Display name */
  name: string

  /** Provider */
  provider: 'openai' | 'anthropic' | 'google' | 'ollama'

  /** Model description */
  description?: string

  /** Context window size */
  contextWindow?: number

  /** Pricing information */
  pricing?: {
    input: number
    output: number
  }

  /** Preset parameters for this model configuration */
  parameters?: {
    temperature?: number
    maxTokens?: number
    [key: string]: unknown
  }
}
