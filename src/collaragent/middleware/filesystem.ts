import {
  createFilesystemMiddleware as upstreamCreateFilesystemMiddleware,
  type FilesystemMiddlewareOptions
} from 'deepagents'
import { isWorkspaceTool } from '@shared/constants'
import { SystemMessage } from 'langchain'

export const COLLARAGENT_FILESYSTEM_TOOL_DESCRIPTIONS: Partial<
  Record<
    'ls' | 'read_file' | 'write_file' | 'edit_file' | 'delete' | 'glob' | 'grep' | 'execute',
    string
  >
> = {
  ls: `Lists files and directories on the external host filesystem or repository codebase.
Use this for exploring project directories, code files, and external assets on disk.
DO NOT use this tool to discover workspace documents or concept canvases; use listWorkspaceItems instead.`,

  read_file: `Reads an external file from the host filesystem or project repository.
Use this for source code, configuration files, and raw data files on disk.
DO NOT use this tool to read studio workspace documents or concept canvases; use readDocument or readGraph instead.`,

  write_file: `Writes content to an external file on the host filesystem or project repository.
Use this for writing source code, configuration files, and scripts to disk.
DO NOT use this tool to create or overwrite studio workspace documents, notes, or canvases; use createDocument or writeGraph instead.`,

  edit_file: `Performs exact string replacements in external files on the host filesystem or repository.
Use this for editing code files, configs, and scripts on disk.
DO NOT use this tool to modify studio workspace documents; use editDocument instead.`,

  delete: `Permanently deletes an external file or directory from the host filesystem.
Use this for cleaning up disk files and code artifacts.
DO NOT use this tool to delete studio workspace documents or canvases; use removeProject or editDocument instead.`
}

export const FILESYSTEM_SYSTEM_PROMPT = `
## Filesystem System (Host OS / Codebase Only)

### Tool Precedence & Operational Boundaries
- **SECONDARY: Filesystem Tools (Host OS / Codebase Only)**
  - Surfaces: External host operating system, repository source files, configuration files, scripts, and raw external assets on disk.
  - Tools: \`ls\`, \`read_file\`, \`write_file\`, \`edit_file\`, \`delete\`, \`glob\`, \`grep\`, \`execute\`.
  - Scope & Invariant: Filesystem tools operate strictly on physical disk / repository files. They are SECONDARY to Workspace Tools.
  - Strict Prohibitions: NEVER use filesystem tools (\`write_file\`, \`edit_file\`, \`read_file\`, \`delete\`) on studio documents, research notes, papers, or concept canvases. Studio documents and canvases do NOT live as plain text files on disk paths; they are managed exclusively by Workspace Tools (\`createDocument\`, \`editDocument\`, \`readDocument\`, \`writeGraph\`, \`listWorkspaceItems\`).`.trim()

/**
 * Enhanced FilesystemMiddleware that wraps upstream deepagents's createFilesystemMiddleware.
 *
 * 1. Overrides default tool descriptions for \`ls\`, \`read_file\`, \`write_file\`, \`edit_file\`, and \`delete\`
 *    to prevent LLM tool decision errors between host filesystem files and live studio workspace entities.
 * 2. Injects SECONDARY filesystem operational boundaries into the model call prompt.
 * 3. Excludes workspace tools (e.g. readDocument, readGraph) from tool output eviction.
 *    This prevents workspace payloads from being redirected to /large_tool_results/ on disk,
 *    allowing workspace tools to manage their own pagination while avoiding root filesystem
 *    permission/ENOENT errors on host systems.
 */
export function createFilesystemMiddleware(
  options?: FilesystemMiddlewareOptions
): ReturnType<typeof upstreamCreateFilesystemMiddleware> {
  const mergedToolDescriptions = {
    ...COLLARAGENT_FILESYSTEM_TOOL_DESCRIPTIONS,
    ...(options?.customToolDescriptions || {})
  }

  const baseMiddleware = upstreamCreateFilesystemMiddleware({
    ...options,
    systemPrompt: null,
    customToolDescriptions: mergedToolDescriptions
  })
  const originalWrapToolCall = baseMiddleware.wrapToolCall
  const originalWrapModelCall = baseMiddleware.wrapModelCall

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

  const appendFilesystemPrompt = (
    promptTarget: { systemPrompt?: string; systemMessage?: unknown },
    effectivePrompt: string
  ) => {
    if (promptTarget.systemPrompt !== undefined) {
      const currentPrompt = promptTarget.systemPrompt || ''
      const newSystemPrompt = currentPrompt
        ? `${currentPrompt}\n\n${effectivePrompt}`
        : effectivePrompt
      return { systemPrompt: newSystemPrompt }
    }

    if (promptTarget.systemMessage !== undefined) {
      const sysMsg = promptTarget.systemMessage as SystemMessage & {
        concat?: (text: string) => SystemMessage
      }
      let newSysMsg = sysMsg
      if (typeof sysMsg.concat === 'function') {
        newSysMsg = sysMsg.concat(`\n\n${effectivePrompt}`)
      } else if (typeof sysMsg.content === 'string') {
        newSysMsg = new SystemMessage({
          content: `${sysMsg.content}\n\n${effectivePrompt}`
        })
      }
      return { systemMessage: newSysMsg }
    }

    return { systemPrompt: effectivePrompt }
  }

  if (originalWrapModelCall) {
    baseMiddleware.wrapModelCall = async (request, handler) => {
      const safeRequest = request.tools !== undefined ? request : { ...request, tools: [] }
      return originalWrapModelCall(safeRequest, async (modelRequest) => {
        const customPrompt = options?.systemPrompt?.trim()
        const effectivePrompt = customPrompt
          ? `${FILESYSTEM_SYSTEM_PROMPT}\n\n${customPrompt}`
          : FILESYSTEM_SYSTEM_PROMPT

        const updated = appendFilesystemPrompt(modelRequest, effectivePrompt)
        return handler({ ...modelRequest, ...updated })
      })
    }
  } else {
    baseMiddleware.wrapModelCall = async (request, handler) => {
      const customPrompt = options?.systemPrompt?.trim()
      const effectivePrompt = customPrompt
        ? `${FILESYSTEM_SYSTEM_PROMPT}\n\n${customPrompt}`
        : FILESYSTEM_SYSTEM_PROMPT

      const updated = appendFilesystemPrompt(request, effectivePrompt)
      return handler({ ...request, ...updated })
    }
  }

  return baseMiddleware
}
