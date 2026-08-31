import { z } from 'zod'

/**
 * Zod schema for ModelConfig
 */
export const ModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'ollama']),
  modelId: z.string().min(1),
  name: z.string().optional(),
  baseUrl: z.string().optional(),
  parameters: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().positive().optional()
    })
    .catchall(z.unknown())
    .optional()
})

/**
 * Zod schema for SubAgentConfig
 */
export const SubAgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  tools: z.array(z.string()),
  mcpServers: z.array(z.string()).optional(),
  enabled: z.boolean(),
  model: z
    .object({
      provider: z.enum(['openai', 'anthropic', 'google', 'ollama']),
      modelId: z.string().min(1)
    })
    .optional()
})

/**
 * Zod schema for ToolConfig
 */
export const ToolConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  langchainTool: z.string().min(1),
  requireAPI: z.boolean().optional()
})

/**
 * Zod schema for RecentFile
 */
export const RecentFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  lastOpened: z.number()
})

/**
 * Zod schema for MiddlewareConfig
 */
export const MiddlewareConfigSchema = z.object({
  subAgent: z.object({
    enabled: z.boolean(),
    dynamicEnabled: z.boolean().default(true),
    recursionLimit: z.number().int().min(1).max(200).default(20)
  }),

  skills: z
    .object({
      enabled: z.boolean().default(false),
      source: z.string().default('')
    })
    .default({ enabled: false, source: '' })
})

/**
 * Zod schema for MCP Server configuration
 */
export const MCPServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  requireAPI: z.boolean().optional(),
  apiKeyName: z.string().optional(),
  transport: z
    .object({
      type: z.enum(['stdio', 'sse', 'http']),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      url: z.string().url().optional()
    })
    .refine(
      (data) => {
        if (data.type === 'stdio') {
          return !!data.command
        }
        return !!data.url
      },
      {
        message:
          'Transport configuration must match the type (stdio needs command, others need url)',
        path: ['command', 'url']
      }
    ),
  disabledTools: z.array(z.string()).optional()
})

/**
 * Zod schema for AppConfig
 */
export const AppConfigSchema = z.object({
  model: ModelConfigSchema,
  subagents: z.array(SubAgentConfigSchema),
  tools: z.array(ToolConfigSchema),
  middleware: MiddlewareConfigSchema,
  mcpServers: z.array(MCPServerConfigSchema).optional().default([]),
  recentFiles: z.array(RecentFileSchema).optional().default([])
})

export type AppConfigInput = z.infer<typeof AppConfigSchema>
