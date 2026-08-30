import { create } from 'zustand';
import { ChatMessage, StreamingState, MessageBlock, TokenUsage, SubagentTask } from '../types/ui';

interface ChatState {
  messages: ChatMessage[];
  streamingParams: Record<string, StreamingState>; // Keyed by threadId
  threadId: string | undefined;
  draftInput?: string | null;
  subagentTasks: Record<string, SubagentTask>; // Keyed by toolCallId
  
  // Actions
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (updates: Partial<ChatMessage>) => void;
  
  // All streaming actions now require a threadId
  setStreaming: (threadId: string, isStreaming: boolean, node?: string) => void;
  updateStreamingContent: (threadId: string, content: string, node?: string, toolCalls?: any[], blocks?: MessageBlock[], usage?: TokenUsage) => void;
  setInterrupt: (threadId: string, interrupt: any) => void;
  clearInterrupt: (threadId: string) => void;
  
  setThreadId: (id: string) => void;
  clearMessages: () => void;
  setMessages: (messages: ChatMessage[]) => void;
  setDraftInput: (value: string | null) => void;
  resetStreaming: (threadId?: string) => void; // Optional threadId to clear specific or all

  // Subagent task actions
  upsertSubagentTask: (task: SubagentTask) => void;
}

const initialStreamingState: StreamingState = {
  currentMessage: '',
  accumulatedContent: '',
  isStreaming: false,
  currentNode: undefined,
  tokensReceived: 0,
  startTime: null,
  blocks: []
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  streamingParams: {}, // New: Dictionary keyed by threadId
  threadId: undefined,
  draftInput: null,
  subagentTasks: {},

  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),

  updateLastMessage: (updates) => set((state) => {
    const messages = [...state.messages];
    if (messages.length > 0) {
      messages[messages.length - 1] = { ...messages[messages.length - 1], ...updates };
    }
    return { messages };
  }),

  // Refactored: setStreaming now takes threadId
  setStreaming: (threadId, isStreaming, node) => set((state) => {
    const currentParam = state.streamingParams[threadId] || initialStreamingState;
    return {
      streamingParams: {
        ...state.streamingParams,
        [threadId]: {
            ...currentParam,
            isStreaming,
            currentNode: node,
            startTime: isStreaming ? new Date() : currentParam.startTime
        }
      }
    };
  }),

  // Refactored: updateStreamingContent now takes threadId
  updateStreamingContent: (threadId, content, node, toolCalls, blocks, usage) => set((state) => {
    const currentParam = state.streamingParams[threadId] || initialStreamingState;
    return {
      streamingParams: {
        ...state.streamingParams,
        [threadId]: {
            ...currentParam,
            accumulatedContent: content,
            currentNode: node,
            tokensReceived: currentParam.tokensReceived + 1,
            toolCalls: toolCalls || currentParam.toolCalls,
            blocks: blocks || currentParam.blocks,
            usage: usage || currentParam.usage
        }
      }
    };
  }),

  setInterrupt: (threadId, interrupt) => set((state) => {
    const currentParam = state.streamingParams[threadId] || initialStreamingState;
    return {
      streamingParams: {
        ...state.streamingParams,
        [threadId]: {
            ...currentParam,
            currentInterrupt: interrupt
        }
      }
    };
  }),
  
  clearInterrupt: (threadId) => set((state) => {
    const currentParam = state.streamingParams[threadId] || initialStreamingState;
    return {
      streamingParams: {
        ...state.streamingParams,
         [threadId]: {
             ...currentParam,
             currentInterrupt: undefined
         }
      }
    };
  }),

  setThreadId: (id) => set({ threadId: id }),
  
  clearMessages: () => set({ messages: [] }),
  
  setMessages: (messages) => set({ messages }),

  setDraftInput: (value) => set({ draftInput: value }),
  
  resetStreaming: (threadId) => set((state) => {
    // If threadId is provided, remove only that entry to clean up memory
    if (threadId) {
        const { [threadId]: _, ...rest } = state.streamingParams;
        return { streamingParams: rest };
    }
    return { streamingParams: {} };
  }),

  upsertSubagentTask: (task) => set((state) => ({
    subagentTasks: {
      ...state.subagentTasks,
      [task.id]: task
    }
  }))
}));
