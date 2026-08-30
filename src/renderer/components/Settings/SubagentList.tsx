import React, { useState } from 'react';
import { SubAgentConfig, ToolConfig, MCPServerConfig } from '@shared/config/types';
import { SubagentForm } from './SubagentForm';

interface SubagentListProps {
    subagents: SubAgentConfig[];
    dynamicEnabled: boolean;
    availableTools: ToolConfig[];
    availableMCPServers: MCPServerConfig[];
    onAdd: (subagent: SubAgentConfig) => Promise<void>;
    onUpdate: (id: string, updates: Partial<SubAgentConfig>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onToggleDynamic: (enabled: boolean) => Promise<void>;
}

export const SubagentList: React.FC<SubagentListProps> = ({ 
    subagents, 
    dynamicEnabled,
    availableTools, 
    availableMCPServers, 
    onAdd, 
    onUpdate, 
    onDelete,
    onToggleDynamic
}) => {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingAgent, setEditingAgent] = useState<SubAgentConfig | undefined>(undefined);

    const handleEdit = (agent: SubAgentConfig) => {
        setEditingAgent(agent);
        setIsFormOpen(true);
    };

    const handleAddNew = () => {
        setEditingAgent(undefined);
        setIsFormOpen(true);
    };

    const handleSave = async (data: SubAgentConfig) => {
        if (editingAgent) {
            await onUpdate(editingAgent.id, data);
        } else {
            await onAdd(data);
        }
        setIsFormOpen(false);
        setEditingAgent(undefined);
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this subagent?')) {
            await onDelete(id);
        }
    }

    return (
        <div className="subagent-list">
            {/* Responsive header - stack on mobile */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-6 sm:mb-8 lg:mb-10">
                <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-black">Subagents</h3>
                <button
                    onClick={handleAddNew}
                    className="
                        w-full sm:w-auto
                        bg-primary text-black 
                        px-4 sm:px-5 py-2.5 sm:py-3
                        rounded-xl text-sm sm:text-base font-medium
                        hover:bg-surface-300 active:scale-95
                        transition-all duration-200 shadow-sm
                        focus-visible:outline-none
                    "
                >
                    + Add Subagent
                </button>
            </div>
            
            {/* Dynamic Subagents Toggle Card - Styled to match the subagent list cards */}
            <div className="mb-10 p-4 sm:p-5 lg:p-6 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm hover:border-surface-300 hover:shadow-md transition-all duration-200 flex items-center justify-between gap-4">
                <div className="flex-1">
                    <h4 className="font-medium text-black text-base sm:text-lg">Dynamic Subagents</h4>
                    <p className="text-sm text-black/60 mt-1">
                        Allow the agent to spawn specialized, ad-hoc subagents on-the-fly for unique tasks.
                    </p>
                </div>
                <div className="shrink-0">
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            className="sr-only peer"
                            checked={dynamicEnabled}
                            onChange={(e) => onToggleDynamic(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                </div>
            </div>

            <div className="mb-6">
                <h4 className="text-sm font-bold text-black uppercase tracking-wider opacity-60">Configured Subagents</h4>
            </div>

            {/* Responsive card grid */}
            <div className="grid grid-cols-1 gap-3 sm:gap-4">
                {subagents.map(agent => (
                    <div
                        key={agent.id}
                        className="
                            p-4 sm:p-5 lg:p-6
                            border border-surface-200 rounded-xl sm:rounded-2xl 
                            bg-white shadow-sm 
                            hover:border-surface-300 hover:shadow-md
                            transition-all duration-200
                        "
                    >
                        <div className="flex flex-col sm:flex-row justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium flex flex-wrap items-center gap-2 text-black text-base sm:text-lg">
                                    <span className="truncate">{agent.name}</span>
                                    {!agent.enabled && (
                                        <span className="text-xs bg-surface-200 text-black/60 px-2.5 py-1 rounded-lg shrink-0">
                                            Disabled
                                        </span>
                                    )}
                                </h4>
                                <p className="text-sm sm:text-base text-black/60 mt-1.5 sm:mt-2 line-clamp-2">
                                    {agent.description}
                                </p>

                                {/* Tool badges - responsive wrapping */}
                                <div className="mt-3 sm:mt-4 flex gap-2 flex-wrap">
                                    {agent.tools.map(tid => {
                                        const tool = availableTools.find(t => t.id === tid);
                                        return (
                                            <span
                                                key={tid}
                                                className="text-xs sm:text-sm bg-surface-200 text-black px-2.5 py-1 rounded-lg font-medium"
                                                title={tool ? tool.langchainTool : tid}
                                            >
                                                {tool ? tool.name : tid}
                                            </span>
                                        )
                                    })}
                                    {(agent.mcpServers || []).map(sid => {
                                        const server = availableMCPServers.find(s => s.id === sid);
                                        return (
                                            <span
                                                key={sid}
                                                className="text-xs sm:text-sm bg-primary/20 text-black px-2.5 py-1 rounded-lg font-medium border border-primary/30"
                                                title={`MCP Server: ${server?.name || sid}`}
                                            >
                                                {server ? server.name : sid} (MCP)
                                            </span>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Action buttons - stack on mobile */}
                            <div className="flex sm:flex-col gap-2 sm:gap-2 sm:ml-4 shrink-0">
                                <button
                                    onClick={() => handleEdit(agent)}
                                    className="
                                        flex-1 sm:flex-none
                                        text-black/60 hover:text-black hover:bg-surface-100 
                                        px-4 py-2 sm:px-3 sm:py-1.5
                                        rounded-lg transition-colors 
                                        font-medium text-sm
                                        focus-visible:outline-none
                                    "
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(agent.id)}
                                    className="
                                        flex-1 sm:flex-none
                                        text-black/60 hover:text-black hover:bg-surface-200 
                                        px-4 py-2 sm:px-3 sm:py-1.5
                                        rounded-lg transition-colors 
                                        font-medium text-sm
                                        focus-visible:outline-none
                                    "
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {subagents.length === 0 && (
                    <div className="text-center p-8 sm:p-12 border-2 border-dashed border-surface-200 rounded-xl sm:rounded-2xl text-black/40">
                        <p className="text-sm sm:text-base">No subagents configured. Add one to get started.</p>
                    </div>
                )}
            </div>

            {isFormOpen && (
                <SubagentForm
                    initialData={editingAgent}
                    availableTools={availableTools}
                    availableMCPServers={availableMCPServers}
                    onSave={handleSave}
                    onCancel={() => setIsFormOpen(false)}
                />
            )}
        </div>
    );
};
