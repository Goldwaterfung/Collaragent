import { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage } from "@shared/agents/types";

export type { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage };


export interface AgentChatRequest {
  message: string;
  threadId?: string;
  wsPort?: number;
  apiPort?: number;
  clientMessageId?: string;
  clientAssistantMessageId?: string;
}

export interface AgentChatResponse {
  output: string;
  threadId: string;
}

export interface AgentStreamRequest {
    message: string;
    threadId?: string;
  streamId?: string;
  clientSentAt?: number;
    wsPort?: number;
    apiPort?: number;
  clientMessageId?: string;
  clientAssistantMessageId?: string;
}

// Events emitted from main to renderer for streaming
export interface AgentStreamChunk {
    chunk: string;
    reasoning?: string;
    threadId: string;
  streamId: string;
    toolCalls?: any[];
    blocks?: MessageBlock[];
    usage?: TokenUsage;
}

// Aliases for cleaner API usage in preload/renderer
export type AgentInvokeRequest = AgentChatRequest;
export type AgentInvokeResponse = AgentChatResponse;

export type AgentStopRequest = string;
export type AgentStopResponse = boolean;

export type AgentStreamResponse = AgentStreamChunk;
