import {
  ChatMessage,
  MessageRole,
  ToolCall,
  MessageBlock,
  TokenUsage,
  SubagentSessionData
} from '@shared/agents/types'

export type { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage, SubagentSessionData }

// ============================================================================
// SUBAGENT TASKS
// ============================================================================

export interface SubagentTask {
  /** The tool call id — used as the unique key */
  id: string
  /** 'task' or 'dynamic_task' */
  toolName: 'task' | 'dynamic_task'
  /** Subagent type name (e.g. 'general-purpose') */
  subagentType: string
  /** The full task description passed to the subagent */
  description: string
  /** Current lifecycle status */
  status: 'pending' | 'running' | 'completed' | 'error'
  /** Final text result once the tool completes */
  result?: string
  /** Nested session execution data */
  session?: SubagentSessionData
  /** Timestamp when the task was spawned */
  startedAt: number
  /** Timestamp when the task completed */
  completedAt?: number
  /** Real-time execution blocks while the subagent is streaming */
  liveBlocks?: MessageBlock[]
  /** Real-time tool calls while the subagent is streaming */
  liveToolCalls?: ToolCall[]
}

// ============================================================================
// STREAMING UI STATE
// ============================================================================

export interface StreamingState {
  currentMessage: string
  accumulatedContent: string
  isStreaming: boolean
  currentNode?: string
  tokensReceived: number
  startTime: Date | null
  currentInterrupt?: unknown
  toolCalls?: ToolCall[]
  blocks: MessageBlock[]
  usage?: TokenUsage
}

// ============================================================================
// UI COMPONENT PROPS
// ============================================================================

export interface ChatProps {
  messages: ChatMessage[]
  onSendMessage: (message: string) => Promise<void>
  onStopStreaming: () => void
  isStreaming: boolean
}

export interface AgentStreamProps {
  isStreaming: boolean
  currentNode?: string
  interrupt?: unknown
  toolCalls?: ToolCall[]
  blocks?: MessageBlock[]
  onResume?: (decision: unknown) => Promise<void>
  onComplete?: (finalContent: string) => void
  onOpenSubagentTask?: (toolCallId: string) => void
}
