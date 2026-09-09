import React, { useCallback } from 'react'
import { instanceService } from '@shared/services/InstanceService'

import { ToolCall } from './types'

interface Props {
  tool: ToolCall
}

import { isWorkspaceTool } from '@shared/constants'
export { isWorkspaceTool }

export const WorkspaceCard: React.FC<Props> = ({ tool }) => {
  if (tool.name === 'write_todos') {
    return null
  }

  const res =
    tool.result && typeof tool.result === 'object' ? (tool.result as Record<string, unknown>) : null

  if (!res) {
    return null
  }

  const isError = res.status === 'error' || tool.status === 'error'
  const action = typeof res.action === 'string' ? res.action : undefined
  const instanceName =
    typeof res.instanceName === 'string'
      ? res.instanceName
      : typeof res.targetEntity === 'string'
        ? res.targetEntity
        : typeof res.sourceTitle === 'string'
          ? res.sourceTitle
          : undefined
  const count = typeof res.count === 'number' ? res.count : undefined
  const nodeCount = typeof res.nodeCount === 'number' ? res.nodeCount : undefined
  const edgeCount = typeof res.edgeCount === 'number' ? res.edgeCount : undefined
  const errorCount = typeof res.errorCount === 'number' ? res.errorCount : undefined
  const warningCount = typeof res.warningCount === 'number' ? res.warningCount : undefined
  const code = typeof res.code === 'string' ? res.code : undefined
  const message = typeof res.message === 'string' ? res.message : undefined
  const recommendFix = typeof res.recommendFix === 'string' ? res.recommendFix : undefined

  if (isError) {
    return (
      <div className="text-xs bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-lg">
        <div className="text-[11px] font-semibold flex items-center flex-wrap gap-2">
          {action && <span>{action}</span>}
          {code && (
            <span className="px-1.5 py-0.5 bg-red-100 border border-red-200 text-red-800 rounded text-[10px] font-mono">
              [{code}]
            </span>
          )}
          {instanceName && <InstanceLink tool={tool} />}
        </div>
        {message && <div className="mt-1 text-[11px] text-red-600">{message}</div>}
        {recommendFix && (
          <div className="mt-1 text-[10px] text-red-500 italic">Recommendation: {recommendFix}</div>
        )}
      </div>
    )
  }

  return (
    <div className="text-xs bg-white/50 border border-surface-200 p-2.5 rounded-lg">
      <div className="mt-2">
        {isWorkspaceTool(tool.name) && (
          <div className="text-[11px] font-semibold text-gray-800 mb-1 flex items-center flex-wrap gap-2">
            {action && <span>{action}</span>}
            {instanceName && <InstanceLink tool={tool} />}
            {count !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 text-gray-600 rounded text-[10px] font-medium leading-none">
                  {count}
                </span>
                <span className="text-gray-500 font-normal">items</span>
              </div>
            )}
            {nodeCount !== undefined && (
              <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded text-[10px] font-medium leading-none">
                {nodeCount} nodes
              </span>
            )}
            {edgeCount !== undefined && (
              <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded text-[10px] font-medium leading-none">
                {edgeCount} relations
              </span>
            )}
            {errorCount !== undefined && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none border ${
                  errorCount === 0
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {errorCount} errors
              </span>
            )}
            {warningCount !== undefined && (
              <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded text-[10px] font-medium leading-none">
                {warningCount} warnings
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkspaceCard

function InstanceLink({ tool }: { tool: ToolCall }) {
  const res =
    tool.result && typeof tool.result === 'object' ? (tool.result as Record<string, unknown>) : null

  const instanceId = typeof res?.instanceId === 'string' ? res.instanceId : undefined
  const instanceName =
    typeof res?.instanceName === 'string'
      ? res.instanceName
      : typeof res?.targetEntity === 'string'
        ? res.targetEntity
        : typeof res?.sourceTitle === 'string'
          ? res.sourceTitle
          : undefined
  const projectName = typeof res?.projectName === 'string' ? res.projectName : undefined

  const openInstance = useCallback(() => {
    const payload: Record<string, unknown> = {}
    if (instanceId) payload.instanceId = instanceId
    if (instanceName) payload.instanceName = instanceName
    if (projectName) payload.projectName = projectName

    instanceService.emitOpen(payload)
  }, [instanceId, instanceName, projectName])

  if (!instanceName) return null

  return (
    <button
      onClick={openInstance}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-surface-100 hover:text-gray-900 hover:border-surface-300 focus:outline-none transition-colors shadow-sm group"
    >
      <span className="truncate max-w-[200px]">{instanceName}</span>
      {projectName ? (
        <span className="text-[10px] text-gray-400 group-hover:text-gray-500 border-l border-gray-200 pl-1.5 ml-0.5">
          {projectName}
        </span>
      ) : null}
    </button>
  )
}
