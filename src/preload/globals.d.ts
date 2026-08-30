import { ElectronAPI } from '@electron-toolkit/preload'
import { RecentFile } from '../shared/config/types'
import {
  ConfigGetRequest,
  ConfigGetResponse,
  ConfigSaveRequest,
  ConfigSaveResponse,
  ConfigAddSubagentRequest,
  ConfigAddSubagentResponse,
  ConfigUpdateSubagentRequest,
  ConfigUpdateSubagentResponse,
  ConfigDeleteSubagentRequest,
  ConfigDeleteSubagentResponse,
  ConfigToggleToolRequest,
  ConfigToggleToolResponse,
  ConfigSetModelRequest,
  ConfigSetModelResponse,
  ConfigGetModelsRequest,
  ConfigGetModelsResponse,
  ConfigAddMCPServerRequest,
  ConfigAddMCPServerResponse,
  ConfigUpdateMCPServerRequest,
  ConfigUpdateMCPServerResponse,
  ConfigDeleteMCPServerRequest,
  ConfigDeleteMCPServerResponse,
  ConfigToggleMCPServerRequest,
  ConfigToggleMCPServerResponse,
  ConfigSetToolAPIKeyRequest,
  ConfigSetToolAPIKeyResponse,
  ConfigCheckKeyRequest,
  ConfigCheckKeyResponse,
  ConfigFetchMCPToolsRequest,
  ConfigFetchMCPToolsResponse
} from '../shared/ipc/config/types'
import {
  AgentStreamRequest,
  AgentStreamResponse,
  AgentInvokeRequest,
  AgentInvokeResponse,
  AgentStopRequest,
  AgentStopResponse
} from '../shared/ipc/agent/types'
import { ChatSession } from '../shared/ipc/history/types'
import { ChatMessage } from '../shared/types/chat'
import {
  CheckpointCreateRequest,
  CheckpointCreateResponse,
  CheckpointListRequest,
  CheckpointListResponse,
  CheckpointRestoreRequest,
  CheckpointRestoreResponse,
  CheckpointCancelRequest,
  CheckpointCancelResponse,
} from '../shared/ipc/checkpoints/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    configIPC: {
      get: (request: ConfigGetRequest) => Promise<ConfigGetResponse>
      save: (request: ConfigSaveRequest) => Promise<ConfigSaveResponse>
      addSubagent: (request: ConfigAddSubagentRequest) => Promise<ConfigAddSubagentResponse>
      updateSubagent: (request: ConfigUpdateSubagentRequest) => Promise<ConfigUpdateSubagentResponse>
      deleteSubagent: (request: ConfigDeleteSubagentRequest) => Promise<ConfigDeleteSubagentResponse>
      toggleTool: (request: ConfigToggleToolRequest) => Promise<ConfigToggleToolResponse>
      setModel: (request: ConfigSetModelRequest) => Promise<ConfigSetModelResponse>
      getModels: (request: ConfigGetModelsRequest) => Promise<ConfigGetModelsResponse>
      addMCPServer: (request: ConfigAddMCPServerRequest) => Promise<ConfigAddMCPServerResponse>
      updateMCPServer: (request: ConfigUpdateMCPServerRequest) => Promise<ConfigUpdateMCPServerResponse>
      deleteMCPServer: (request: ConfigDeleteMCPServerRequest) => Promise<ConfigDeleteMCPServerResponse>
      toggleMCPServer: (request: ConfigToggleMCPServerRequest) => Promise<ConfigToggleMCPServerResponse>
      setToolApiKey: (request: ConfigSetToolAPIKeyRequest) => Promise<ConfigSetToolAPIKeyResponse>
      checkKey: (request: ConfigCheckKeyRequest) => Promise<ConfigCheckKeyResponse>
      fetchMCPTools: (request: ConfigFetchMCPToolsRequest) => Promise<ConfigFetchMCPToolsResponse>
    }
    agentIPC: {
      stream: (request: AgentStreamRequest) => AsyncGenerator<AgentStreamResponse>
      invoke: (request: AgentInvokeRequest) => Promise<AgentInvokeResponse>
      stop: (request: AgentStopRequest) => Promise<AgentStopResponse>
    }
    checkpointIPC: {
      create: (request: CheckpointCreateRequest) => Promise<CheckpointCreateResponse>
      restore: (request: CheckpointRestoreRequest) => Promise<CheckpointRestoreResponse>
      list: (request: CheckpointListRequest) => Promise<CheckpointListResponse>
      cancel: (request?: CheckpointCancelRequest) => Promise<CheckpointCancelResponse>
      onQuiesce: (handler: () => void) => () => void
      onResume: (handler: () => void) => () => void
    }
    historyIPC: {
      getSessions: () => Promise<ChatSession[]>
      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      deleteSession: (sessionId: string) => Promise<boolean>
      clearAll: () => Promise<boolean>
    }
    fileIPC: {
      openFile: () => Promise<any>
      createFile: () => Promise<any>
      getRecentFiles: () => Promise<RecentFile[]>
      openWorkspace: (path: string) => Promise<any>
      exportWorkspace: () => Promise<any>
      onExportStarted: (handler: () => void) => () => void
      onExportEnded: (handler: () => void) => () => void
      onImportStarted: (handler: () => void) => () => void
      onImportEnded: (handler: () => void) => () => void
    }
    skillsIPC: {
      list: (req: import('../shared/ipc/skills/types').SkillsListRequest) => Promise<import('../shared/ipc/skills/types').SkillsListResponse>
      readFile: (req: import('../shared/ipc/skills/types').SkillsReadFileRequest) => Promise<import('../shared/ipc/skills/types').SkillsReadFileResponse>
      writeFile: (req: import('../shared/ipc/skills/types').SkillsWriteFileRequest) => Promise<import('../shared/ipc/skills/types').SkillsWriteFileResponse>
      create: (req: import('../shared/ipc/skills/types').SkillsCreateRequest) => Promise<import('../shared/ipc/skills/types').SkillsCreateResponse>
      delete: (req: import('../shared/ipc/skills/types').SkillsDeleteRequest) => Promise<import('../shared/ipc/skills/types').SkillsDeleteResponse>
      pickDirectory: () => Promise<import('../shared/ipc/skills/types').SkillsPickDirectoryResponse>
    }
  }
}
