export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageBlock =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolId: string }
  | { type: 'reasoning'; content: string }
export type MessageAction = {
  id: string
  label: string
  input: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'completed' | 'error'
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
  actions?: MessageAction[]
  metadata?: {
    node?: string
    runId?: string
    threadId?: string
  }
  blocks?: MessageBlock[]
  usage?: TokenUsage
}

export interface SubagentSessionData {
  summary: string
  messages: ChatMessage[]
  toolCalls?: ToolCall[]
  blocks?: MessageBlock[]
  usage?: TokenUsage
  totalTurns?: number
  agentType?: string
  description?: string
}
