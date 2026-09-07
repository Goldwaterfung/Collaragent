import React from 'react'
import { ToolCall } from './types'

interface ExecuteArgs {
  command: string
}
interface ReadFileArgs {
  file_path?: string
  path?: string
  offset?: number
  limit?: number
}
interface WriteFileArgs {
  file_path?: string
  path?: string
  content?: string
}
interface EditFileArgs {
  file_path?: string
  path?: string
  old_string?: string
  new_string?: string
}
interface DeleteArgs {
  file_path?: string
  path?: string
}
interface ListArgs {
  path?: string
}
interface GlobArgs {
  pattern: string
  path?: string
}
interface GrepArgs {
  pattern: string
  path?: string
  glob?: string | null
}
interface SkillArgs {
  name?: string
  skill?: string
  skill_name?: string
  file_path?: string
  path?: string
}

type FSToolCall =
  | { id: string; name: 'execute'; args: ExecuteArgs; result?: unknown }
  | { id: string; name: 'read_file'; args: ReadFileArgs; result?: unknown }
  | { id: string; name: 'write_file'; args: WriteFileArgs; result?: unknown }
  | { id: string; name: 'edit_file'; args: EditFileArgs; result?: unknown }
  | { id: string; name: 'delete'; args: DeleteArgs; result?: unknown }
  | { id: string; name: 'ls'; args: ListArgs; result?: unknown }
  | { id: string; name: 'glob'; args: GlobArgs; result?: unknown }
  | { id: string; name: 'grep'; args: GrepArgs; result?: unknown }
  | {
      id: string
      name: 'read_skill' | 'load_skill' | 'skill' | 'skills'
      args: SkillArgs
      result?: unknown
    }

interface Props {
  tool: ToolCall
}

export const FS_TOOL_NAMES = new Set([
  'execute',
  'read_file',
  'write_file',
  'edit_file',
  'delete',
  'ls',
  'glob',
  'grep',
  'read_skill',
  'load_skill',
  'skill',
  'skills'
])

export function isFSTool(name?: string): boolean {
  return !!name && FS_TOOL_NAMES.has(name)
}

export function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) {
    return ''
  }
  if (typeof result === 'string') {
    return result
  }
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result)
  }
  if (Array.isArray(result)) {
    return result
      .map((item) => {
        if (typeof item === 'string') return item
        if (
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          item.type === 'text' &&
          'text' in item &&
          typeof item.text === 'string'
        ) {
          return item.text
        }
        if (typeof item === 'object' && item !== null && 'type' in item && item.type === 'image') {
          return '[Image]'
        }
        try {
          return JSON.stringify(item, null, 2)
        } catch {
          return String(item)
        }
      })
      .join('\n')
  }
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      return record.text
    }
    if (typeof record.error === 'string') {
      return record.error
    }
    if (typeof record.message === 'string') {
      return record.message
    }
    if (typeof record.output === 'string') {
      return record.output
    }
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }
  return String(result)
}

export const FilesystemCard: React.FC<Props> = ({ tool }) => {
  if (!isFSTool(tool.name)) return null

  const fsTool = tool as unknown as FSToolCall
  const displayResult = formatToolResult(fsTool.result)
  const isError =
    tool.status === 'error' ||
    (typeof fsTool.result === 'object' && fsTool.result !== null && 'error' in fsTool.result)

  if (!fsTool.result && !tool.result && tool.status !== 'completed' && tool.status !== 'error') {
    return null
  }

  if (isError) {
    return (
      <div className="text-xs bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-lg flex items-start gap-2">
        <span className="font-mono whitespace-pre-wrap wrap-break-word text-[11px]">
          {displayResult || 'Operation failed'}
        </span>
      </div>
    )
  }

  switch (fsTool.name) {
    case 'execute':
      return (
        <div className="text-[11px] p-2 bg-gray-900 border border-gray-700 text-gray-300 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-mono text-gray-400 select-none">$</span>
          <span className="font-mono text-gray-200 truncate">{fsTool.args.command}</span>
        </div>
      )

    case 'read_file': {
      const targetPath = fsTool.args.file_path || fsTool.args.path || ''
      return (
        <div className="text-[11px] p-2 bg-surface-50/80 border border-surface-200 text-gray-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-gray-600 whitespace-nowrap">Read:</span>
          <span className="font-mono bg-surface-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {targetPath}
          </span>
        </div>
      )
    }

    case 'read_skill':
    case 'load_skill':
    case 'skill':
    case 'skills': {
      const targetPath =
        fsTool.args.file_path ||
        fsTool.args.path ||
        fsTool.args.name ||
        fsTool.args.skill ||
        fsTool.args.skill_name ||
        ''
      return (
        <div className="text-[11px] p-2 bg-surface-50/80 border border-surface-200 text-gray-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-gray-600 whitespace-nowrap">Read:</span>
          <span className="font-mono bg-surface-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {targetPath}
          </span>
        </div>
      )
    }

    case 'grep':
      return (
        <div className="text-[11px] p-2 bg-surface-50/80 border border-surface-200 text-gray-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-gray-600 whitespace-nowrap">Search:</span>
          <span className="font-mono bg-surface-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {fsTool.args.pattern}
          </span>
          {fsTool.args.path && fsTool.args.path !== '/' && (
            <span className="text-[10px] text-gray-500 font-normal truncate">
              in {fsTool.args.path}
            </span>
          )}
        </div>
      )

    case 'ls':
      return (
        <div className="text-[11px] p-2 bg-surface-50/80 border border-surface-200 text-gray-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-gray-600 whitespace-nowrap">List:</span>
          <span className="font-mono bg-surface-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {fsTool.args.path || '/'}
          </span>
        </div>
      )

    case 'glob':
      return (
        <div className="text-[11px] p-2 bg-surface-50/80 border border-surface-200 text-gray-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium text-gray-600 whitespace-nowrap">Glob:</span>
          <span className="font-mono bg-surface-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {fsTool.args.pattern}
          </span>
          {fsTool.args.path && (
            <span className="text-[10px] text-gray-500 font-normal truncate">
              in {fsTool.args.path}
            </span>
          )}
        </div>
      )

    case 'edit_file':
    case 'write_file': {
      const targetPath = fsTool.args.file_path || fsTool.args.path || ''
      return (
        <div className="text-[11px] p-2 bg-green-50 border border-green-200 text-green-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium whitespace-nowrap">
            {fsTool.name === 'edit_file' ? 'Edited:' : 'Created:'}
          </span>
          <span className="font-mono bg-green-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {targetPath}
          </span>
        </div>
      )
    }

    case 'delete': {
      const targetPath = fsTool.args.file_path || fsTool.args.path || ''
      return (
        <div className="text-[11px] p-2 bg-red-50 border border-red-200 text-red-800 rounded-lg flex items-center gap-2 overflow-hidden">
          <span className="font-medium whitespace-nowrap">Deleted:</span>
          <span className="font-mono bg-red-100 px-1.5 py-0.5 rounded truncate text-gray-800">
            {targetPath}
          </span>
        </div>
      )
    }

    default:
      return null
  }
}

export default FilesystemCard
