import React from 'react';
import { ToolCall } from './types';
import WorkspaceCard, { isWorkspaceTool } from './WorkspaceCard';
import FilesystemCard, { isFSTool } from './FilesystemCard';
import GenericToolCard from './GenericToolCard';
import SubagentTaskCard, { isSubagentTaskTool } from './SubagentTaskCard';

interface Props {
    tool: ToolCall;
    onOpenSubagentTask?: (toolCallId: string) => void;
}

export const ToolCallCard: React.FC<Props> = ({ tool, onOpenSubagentTask }) => {
    if (isSubagentTaskTool(tool.name)) {
        return (
            <div className="py-2">
                <SubagentTaskCard tool={tool} onOpen={onOpenSubagentTask ?? (() => {})} />
            </div>
        );
    }

    if (isFSTool(tool.name)) {
        return (
            <div className="py-2">
                <FilesystemCard tool={tool} />
            </div>
        );
    }

    if (isWorkspaceTool(tool.name)) {
        return (
            <div className="py-2">
                <WorkspaceCard tool={tool} />
            </div>
        );
    }

    return (
        <div className="py-2">
            <GenericToolCard tool={tool} />
        </div>
    );
};

export default ToolCallCard;
