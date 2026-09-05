import { createMiddleware, AIMessage, type AgentMiddleware } from 'langchain'
import { isCommand, Command } from '@langchain/langgraph'
import type {
  MessageContent,
  UsageMetadata,
  InvalidToolCall,
  ToolCall
} from '@langchain/core/messages'

interface RawMessageLike {
  content?: MessageContent
  text?: string
  name?: string
  additional_kwargs?: Record<string, unknown>
  response_metadata?: Record<string, unknown>
  usage_metadata?: UsageMetadata
  tool_calls?: ToolCall[]
  invalid_tool_calls?: InvalidToolCall[]
}

function isRawMessageLike(val: unknown): val is RawMessageLike {
  return typeof val === 'object' && val !== null
}

/**
 * Middleware that normalizes LLM responses into standard LangChain AIMessage instances.
 *
 * Some OpenAI-compatible model providers (such as GLM / Zhipu AI or local proxy endpoints)
 * omit `role: "assistant"` on initial streaming chunks or send non-standard delta events.
 * This causes LangChain's chunk aggregator to produce generic `ChatMessage` instances
 * (`type: "chat"`) instead of `AIMessage` instances (`type: "ai"`).
 *
 * This middleware intercepts the model response at the innermost hook level and safely
 * coerces generic messages into standard `AIMessage` instances so that LangGraph's
 * `isInternalModelResponse` validation passes reliably.
 */
export function createModelResponseNormalizerMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: 'modelResponseNormalizerMiddleware',
    wrapModelCall: async (request, handler) => {
      const rawResponse: unknown = await handler(request)

      // 1. If already a valid AIMessage or LangGraph Command, pass through directly
      if (AIMessage.isInstance(rawResponse) || isCommand(rawResponse)) {
        return rawResponse
      }

      // 2. If it is a structured response object { structuredResponse, messages }, pass through directly
      if (
        typeof rawResponse === 'object' &&
        rawResponse !== null &&
        'structuredResponse' in rawResponse &&
        'messages' in rawResponse
      ) {
        return rawResponse as unknown as AIMessage | Command
      }

      // 3. Coerce ChatMessage or generic message from OpenAI-compatible models into AIMessage
      if (isRawMessageLike(rawResponse)) {
        const rawContent = rawResponse.content ?? rawResponse.text ?? ''
        return new AIMessage({
          content: rawContent,
          name: rawResponse.name,
          additional_kwargs: rawResponse.additional_kwargs ?? {},
          response_metadata: rawResponse.response_metadata ?? {},
          usage_metadata: rawResponse.usage_metadata,
          tool_calls: rawResponse.tool_calls ?? [],
          invalid_tool_calls: rawResponse.invalid_tool_calls ?? []
        })
      }

      // 4. Primitive or unexpected fallback
      return new AIMessage({ content: String(rawResponse ?? '') })
    }
  })
}
