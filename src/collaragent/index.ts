/**
 * Deep Agents TypeScript Implementation
 *
 * CollarAgent Studio Runtime powered by LangChain DeepAgents.
 */

export * from './runtime/index.js'
export * from './checkpoint/index.js'
export * from './telemetry/index.js'
export * from './tools/index.js'

// Export core deepagents runtime, backends, and middleware from official package
export {
  createSettings,
  findProjectRoot,
  type Settings,
  type SettingsOptions,
  // Backends
  StateBackend,
  StoreBackend,
  FilesystemBackend,
  CompositeBackend,
  BaseSandbox,
  isSandboxBackend,
  type BackendProtocol,
  type BackendFactory,
  type FileInfo,
  type GrepMatch,
  type WriteResult,
  type EditResult,
  type ExecuteResponse,
  type FileOperationError,
  type FileDownloadResponse,
  type FileUploadResponse,
  type SandboxBackendProtocol,
  type MaybePromise,
  // Middleware
  createFilesystemMiddleware,
  createPatchToolCallsMiddleware,
  createMemoryMiddleware,
  createSkillsMiddleware,
  createAgentMemoryMiddleware,
  type AgentMemoryMiddlewareOptions,
  type SkillsMiddlewareOptions,
  type SkillMetadata,
  MAX_SKILL_FILE_SIZE,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_DESCRIPTION_LENGTH,
  type FilesystemMiddlewareOptions,
  type MemoryMiddlewareOptions,
  type FileData,
  // Types
  type MergedDeepAgentState,
  type DeepAgent,
  type DeepAgentTypeConfig,
  type DefaultDeepAgentTypeConfig,
  type ResolveDeepAgentTypeConfig,
  type InferDeepAgentType,
  type InferDeepAgentSubagents,
  type InferSubagentByName,
  type InferSubagentReactAgentType,
  type ExtractSubAgentMiddleware,
  type FlattenSubAgentMiddleware,
  type InferSubAgentMiddlewareStates
} from 'deepagents'

// Export CollarAgent local extensions & loader
export {
  createSubAgentMiddleware,
  type SubAgentMiddlewareOptions,
  type SubAgent,
  type CompiledSubAgent,
  createWorkspaceMiddleware,
  dateMiddleware,
  createModelResponseNormalizerMiddleware
} from './middleware/index.js'

export {
  listSkills,
  parseSkillMetadata,
  type SkillMetadata as LoaderSkillMetadata,
  type ListSkillsOptions
} from './skills/index.js'
