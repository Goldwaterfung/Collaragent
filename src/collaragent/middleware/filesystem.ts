import {
  createFilesystemMiddleware as upstreamCreateFilesystemMiddleware,
  type FilesystemMiddlewareOptions
} from 'deepagents'
import { isWorkspaceTool } from '@shared/constants'

/**
 * Enhanced FilesystemMiddleware that wraps upstream deepagents's createFilesystemMiddleware.
 *
 * Excludes workspace tools (e.g. readDocument, readGraph) from tool output eviction.
 * This prevents workspace payloads from being redirected to /large_tool_results/ on disk,
 * allowing workspace tools to manage their own pagination while avoiding root filesystem
 * permission/ENOENT errors on host systems.
 */
export function createFilesystemMiddleware(
  options?: FilesystemMiddlewareOptions
): ReturnType<typeof upstreamCreateFilesystemMiddleware> {
  const baseMiddleware = upstreamCreateFilesystemMiddleware(options)
  const originalWrapToolCall = baseMiddleware.wrapToolCall

  if (originalWrapToolCall) {
    baseMiddleware.wrapToolCall = async (request, handler) => {
      const toolName = request.toolCall?.name
      if (toolName && isWorkspaceTool(toolName)) {
        // Workspace tools manage their own boundaries and bypass eviction
        return handler(request)
      }
      return originalWrapToolCall(request, handler)
    }
  }

  return baseMiddleware
}
