# Implementing Token Statistics in CollarAgent

This guide provides a step-by-step walkthrough to extract, stream, store, and display token usage statistics (input tokens, output tokens, and reasoning tokens) across the full CollarAgent stack.

## Step 1: Define Shared Types

First, we need to create a unified `TokenUsage` interface that can be shared between the Main (Backend) and Renderer (Frontend) processes.

**File: `src/shared/agents/types.ts`**
1. Export a new `TokenUsage` interface.
2. Add an optional `usage` property to `ChatMessage`.

```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  actions?: MessageAction[];
  metadata?: {
    node?: string;
    runId?: string;
    threadId?: string;
  };
  blocks?: MessageBlock[];
  usage?: TokenUsage; // <-- Add this
}
```

## Step 2: Update IPC Definitions

Extend the IPC chunk format so the backend can send token data precisely when it arrives from the LLM.

**File: `src/shared/ipc/agent/types.ts`**
1. Make sure `TokenUsage` is imported from `@shared/agents/types`.
2. Add it to `AgentStreamChunk`.

```typescript
import { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage } from "@shared/agents/types";

export type { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage };

export interface AgentStreamChunk {
  chunk: string;
  threadId: string;
  streamId: string;
  toolCalls?: any[];
  blocks?: MessageBlock[];
  usage?: TokenUsage;  // <-- Add this
}
```

## Step 3: Update React UI State Types

Make sure the frontend stream tracking accurately tracks the new usage field.

**File: `src/renderer/types/ui.ts`**
1. Make sure `TokenUsage` is exported.
2. Add it to `StreamingState`.

```typescript
import { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage } from "@shared/agents/types";

export type { ChatMessage, MessageRole, ToolCall, MessageBlock, TokenUsage };

export interface StreamingState {
  currentMessage: string;
  accumulatedContent: string;
  isStreaming: boolean;
  currentNode?: string;
  tokensReceived: number;
  startTime: Date | null;
  currentInterrupt?: any; 
  toolCalls?: ToolCall[];
  blocks: MessageBlock[];
  usage?: TokenUsage; // <-- Add this
}
```

## Step 4: Update the Chat Store

Enhance the Zustand chat store so we can persist stream data into React state.

**File: `src/renderer/store/chatStore.ts`**
Modify the `updateStreamingContent` signature and logic.

```typescript
// 1. Update the signature in ChatState interface
updateStreamingContent: (threadId: string, content: string, node?: string, toolCalls?: any[], blocks?: MessageBlock[], usage?: TokenUsage) => void;

// 2. Update the implementation
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
          usage: usage || currentParam.usage // <-- Update this
      }
    }
  };
}),
```

## Step 5: Capture Usage Metadata from the LLM

Intercept LangChain's `usage_metadata` from the stream chunk and forward it.

**File: `src/main/handlers/streaming.ts`**

1. Define a `usage` variable outside the flush closure.
```typescript
  let fullResponse = ''
  let activeToolCalls: any[] = []
  let blocks: Types.MessageBlock[] = []
  let usage: Types.TokenUsage | undefined; // <-- Add this
```

2. Update `flushText` and `emitToolUpdate` to include it in the `Types.AgentStreamChunk` payload:
```typescript
  const flushText = (force?: boolean) => {
    // ... logic ...
    const payload: Types.AgentStreamChunk = {
      chunk: textBuffer,
      threadId,
      streamId,
      usage // <-- Add this
    }
    sender.send(Channels.agentStreamChannel(streamId), payload)
    // ... logic ...
  }
```

3. Deep inside the `for await (const [chunk] of stream)` loop, capture the usage metadata:
```typescript
    // Under 3. Handle Regular Content
    if (chunk && chunk.content && type !== 'tool') {
      content = chunk.content.toString()
      fullResponse += content

      // Extract token usage metadata from the chunk (usually present on the final chunk)
      if (chunk.usage_metadata) {
        usage = {
          inputTokens: chunk.usage_metadata.input_tokens || 0,
          outputTokens: chunk.usage_metadata.output_tokens || 0,
          totalTokens: chunk.usage_metadata.total_tokens || 0,
          reasoningTokens: chunk.usage_metadata.output_token_details?.reasoning,
          cachedInputTokens: chunk.usage_metadata.input_token_details?.cache_read,
        };
      }
      
      // Update blocks ...
```

4. **Persistence**: Finally, pass this `usage` object to the `saveMessageToProject` function call at the end of the file. You will need to add it to the `metadata` record:
```typescript
    await saveMessageToProject(
      ports.apiPort,
      threadId,
      'assistant',
      fullResponse,
      activeToolCalls,
      blocks,
      undefined, // actions
      usage ? { usage } : undefined, // <-- Pass usage as metadata!
      clientIds?.clientAssistantMessageId
    ).catch(() => {})
```

## Step 6: Handle Tokens in UI Subscriptions

Catch the token usage in React and finalize the message block.

**File: `src/renderer/components/Chat/Chat.tsx`**

1. In the `onStreamChunk` handler, extract and pass it to the store.
```typescript
const onStreamChunk = (_event: any, data: Types.AgentStreamChunk) => {
   // ... existing logic
   
   state.updateStreamingContent(
       data.threadId,
       nextContent,
       undefined,
       data.toolCalls || currentToolCalls,
       nextBlocks,
       data.usage // <-- Pass as 6th parameter
   );
};
```

2. In the `onStreamEnd` handlers (and `onStreamError`), make sure the `assistantMessage` object captures it:
```typescript
const onStreamEnd = (_event: any, data: { threadId: string; streamId: string }) => {
    // ...
    const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: finalContent,
        toolCalls: finalToolCalls,
        blocks: finalBlocks,
        usage: threadStream.usage, // <-- Add this
        timestamp: new Date(),
        metadata: { threadId: data.threadId }
    };
    // ...
```

## Step 7: Display Token Stats

Now render a minimal badge UI below your chat messages. Update the component responsible for rendering individual chat bubbles (e.g. `MessageList` or `MessageItem`).

Example snippet to render inside the Assistant bubble:

```tsx
{message.usage && (
  <div className="flex gap-3 text-[10px] text-surface-400 mt-2 border-t border-surface-200/50 pt-1.5 font-mono">
    <span title="Prompt Input Tokens">
      In: {message.usage.inputTokens}
      {message.usage.cachedInputTokens ? ` (C: ${message.usage.cachedInputTokens})` : ''}
    </span>
    <span title="Generated Output Tokens">
      Out: {message.usage.outputTokens}
    </span>
    {message.usage.reasoningTokens && message.usage.reasoningTokens > 0 && (
      <span title="Hidden Reasoning Tokens" className="text-purple-400/80">
        Reasoning: {message.usage.reasoningTokens}
      </span>
    )}
  </div>
)}
```

This completes the full lifecycle: Definition > Collection > IPC Transport > React State > Persistence > Rendering.
