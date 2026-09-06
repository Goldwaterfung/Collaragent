import React from 'react'
import { ToolCall } from './types'
import WorkspaceCard, { isWorkspaceTool } from './WorkspaceCard'
import FilesystemCard, { isFSTool } from './FilesystemCard'
import GenericToolCard from './GenericToolCard'
import SubagentTaskCard, { isSubagentTaskTool } from './SubagentTaskCard'
import { ChatErrorBoundary } from './ChatErrorBoundary'

interface Props {
  tool: ToolCall
  onOpenSubagentTask?: (toolCallId: string) => void
}

export const ToolCallCard: React.FC<Props> = ({ tool, onOpenSubagentTask }) => {
  const renderCard = () => {
    if (isSubagentTaskTool(tool.name)) {
      return <SubagentTaskCard tool={tool} onOpen={onOpenSubagentTask ?? (() => {})} />
    }

    if (isFSTool(tool.name)) {
      return <FilesystemCard tool={tool} />
    }

    if (isWorkspaceTool(tool.name)) {
      return <WorkspaceCard tool={tool} />
    }

    return <GenericToolCard tool={tool} />
  }

  const fallbackText =
    typeof tool.args === 'string'
      ? tool.args
      : (() => {
          try {
            return JSON.stringify(tool.args, null, 2)
          } catch {
            return tool.name
          }
        })()

  return (
    <div className="py-2">
      <ChatErrorBoundary fallbackContent={fallbackText}>{renderCard()}</ChatErrorBoundary>
    </div>
  )
}

export default ToolCallCard
