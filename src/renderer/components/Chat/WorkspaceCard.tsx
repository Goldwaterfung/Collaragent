import React, { useCallback } from 'react'
import { instanceService } from '@shared/services/InstanceService'

import { ToolCall } from './types'

interface Props {
    tool: ToolCall
}

const WORKSPACE_TOOL_NAMES = new Set([
    'readDocument',
    'createDocument',
    'editDocument',
    'listWorkspaceItems',
    'readGraph',
    'writeGraph'
])

export function isWorkspaceTool(name?: string) {
    return !!name && WORKSPACE_TOOL_NAMES.has(name)
}

export const WorkspaceCard: React.FC<Props> = ({ tool }) => {
    if (tool.name === 'write_todos') {
        return null
    }

    return (
        <div className="text-xs bg-white/50 border border-surface-200 p-2.5 rounded-lg">
            {!!tool.result && (
                <div className="mt-2">
                    {isWorkspaceTool(tool.name) && (
                        <div className="text-[11px] font-semibold text-gray-800 mb-1 flex items-center gap-2">
                            {tool.result.action && <span>{tool.result.action}</span>}
                            {tool.result.instanceName && <InstanceLink tool={tool} />}
                            {tool.result.count !== undefined && (
                                <div className="flex items-center gap-1.5">
                                    <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 rounded text-[10px] font-medium leading-none">
                                        {tool.result.count}
                                    </span>
                                    <span className="text-gray-500 font-normal">items</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default WorkspaceCard

function InstanceLink({ tool }: { tool: ToolCall }) {
    const openInstance = useCallback(() => {
        const instanceId = tool.result?.instanceId as string | undefined
        const payload: Record<string, any> = {}
        if (instanceId) payload.instanceId = instanceId
        if (tool.result?.instanceName) payload.instanceName = tool.result.instanceName
        if (tool.result?.projectName) payload.projectName = tool.result.projectName

        instanceService.emitOpen(payload)
    }, [tool])

    return (
        <button
            onClick={openInstance}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-surface-100 hover:text-gray-900 hover:border-surface-300 transition-colors shadow-sm group"
        >
            <span className="truncate max-w-[200px]">{tool.result.instanceName}</span>
            {tool.result.projectName ? (
                <span className="text-[10px] text-gray-400 group-hover:text-gray-500 border-l border-gray-200 pl-1.5 ml-0.5">
                    {tool.result.projectName}
                </span>
            ) : null}
        </button>
    )
}
