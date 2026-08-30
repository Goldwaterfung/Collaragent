import React, { useState } from 'react';
import { SubAgentConfig, ToolConfig, MCPServerConfig } from '@shared/config/types';

interface SubagentFormProps {
    initialData?: Partial<SubAgentConfig>;
    availableTools: ToolConfig[];
    availableMCPServers: MCPServerConfig[];
    onSave: (data: SubAgentConfig) => Promise<void>;
    onCancel: () => void;
}

export const SubagentForm: React.FC<SubagentFormProps> = ({ initialData, availableTools, availableMCPServers, onSave, onCancel }) => {
    const [formData, setFormData] = useState<Partial<SubAgentConfig>>({
        id: initialData?.id || crypto.randomUUID(),
        name: initialData?.name || '',
        description: initialData?.description || '',
        systemPrompt: initialData?.systemPrompt || '',
        tools: initialData?.tools || [],
        mcpServers: initialData?.mcpServers || [],
        enabled: initialData?.enabled ?? true,
        model: initialData?.model // Optional model override
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.description || !formData.systemPrompt) {
            setError("Name, Description and System Prompt are required.");
            return;
        }

        setError(null);
        setLoading(true);
        try {
            await onSave(formData as SubAgentConfig);
        } catch (err: any) {
            setError(err.message || 'Failed to save subagent');
        } finally {
            setLoading(false);
        }
    };

    const toggleTool = (toolId: string) => {
        const currentTools = formData.tools || [];
        if (currentTools.includes(toolId)) {
            setFormData({ ...formData, tools: currentTools.filter(t => t !== toolId) });
        } else {
            setFormData({ ...formData, tools: [...currentTools, toolId] });
        }
    };

    const toggleMCPServer = (serverId: string) => {
        const currentServers = formData.mcpServers || [];
        if (currentServers.includes(serverId)) {
            setFormData({ ...formData, mcpServers: currentServers.filter(s => s !== serverId) });
        } else {
            setFormData({ ...formData, mcpServers: [...currentServers, serverId] });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
            <div className="
                bg-white rounded-2xl shadow-2xl 
                w-full max-w-2xl 
                max-h-[90vh] overflow-y-auto 
                border border-surface-200
            ">
                <form onSubmit={handleSubmit} className="p-5 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
                    <h3 className="text-lg sm:text-xl font-bold text-black">
                        {initialData?.id ? 'Edit Subagent' : 'Add Subagent'}
                    </h3>

                    {/* Responsive grid layout */}
                    <div className="space-y-4 sm:space-y-5">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-black">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="
                                    w-full p-3 sm:p-3.5
                                    border border-surface-200 rounded-xl 
                                    bg-surface-50 text-black text-sm sm:text-base
                                    placeholder:text-black/40 
                                    focus:outline-none
                                    transition-shadow
                                "
                                placeholder="e.g. researcher"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-black">Description</label>
                            <input
                                type="text"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                className="
                                    w-full p-3 sm:p-3.5
                                    border border-surface-200 rounded-xl 
                                    bg-surface-50 text-black text-sm sm:text-base
                                    placeholder:text-black/40 
                                    focus:outline-none
                                    transition-shadow
                                "
                                placeholder="Used by main agent to decide when to call this subagent"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-black">System Prompt</label>
                            <textarea
                                value={formData.systemPrompt}
                                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                                className="
                                    w-full p-3 sm:p-3.5
                                    border border-surface-200 rounded-xl 
                                    bg-surface-50 text-black text-sm sm:text-base
                                    placeholder:text-black/40 
                                    h-28 sm:h-32 font-mono
                                    focus:outline-none
                                    transition-shadow resize-none
                                "
                                placeholder="You are a specialist agent..."
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-black">Allowed Tools</label>
                            <div className="
                                grid grid-cols-1 sm:grid-cols-2 
                                gap-2 
                                max-h-40 sm:max-h-48 overflow-y-auto 
                                border border-surface-200 p-3 rounded-xl 
                                bg-surface-50
                            ">
                                {availableTools.map(tool => (
                                    <label
                                        key={tool.id}
                                        className="
                                            flex items-center space-x-2 sm:space-x-2.5
                                            p-2 sm:p-2.5
                                            hover:bg-surface-100 rounded-lg 
                                            cursor-pointer transition-colors
                                        "
                                    >
                                        <input
                                            type="checkbox"
                                            checked={formData.tools?.includes(tool.id)}
                                            onChange={() => toggleTool(tool.id)}
                                            className="
                                                w-4 h-4 sm:w-4 sm:h-4
                                                rounded border-surface-300 
                                                text-primary 
                                            "
                                        />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm truncate text-black">
                                                {tool.name}
                                            </span>
                                            <span className="text-[10px] text-black/40 font-mono truncate">{tool.langchainTool}</span>
                                        </div>
                                    </label>
                                ))}
                                {availableTools.length === 0 && (
                                    <p className="text-black/40 text-sm col-span-full text-center py-4">
                                        No tools available.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-black">Allowed MCP Servers</label>
                            <div className="
                                grid grid-cols-1 sm:grid-cols-2 
                                gap-2 
                                max-h-40 sm:max-h-48 overflow-y-auto 
                                border border-surface-200 p-3 rounded-xl 
                                bg-surface-50
                            ">
                                {availableMCPServers.map(server => (
                                    <label
                                        key={server.id}
                                        className="
                                            flex items-center space-x-2 sm:space-x-2.5
                                            p-2 sm:p-2.5
                                            hover:bg-surface-100 rounded-lg 
                                            cursor-pointer transition-colors
                                        "
                                    >
                                        <input
                                            type="checkbox"
                                            checked={formData.mcpServers?.includes(server.id)}
                                            onChange={() => toggleMCPServer(server.id)}
                                            className="
                                                w-4 h-4 sm:w-4 sm:h-4
                                                rounded border-surface-300 
                                                text-primary 
                                            "
                                        />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm truncate text-black">
                                                {server.name}
                                            </span>
                                            <span className="text-[10px] text-black/40 uppercase font-bold">{server.transport.type} (MCP)</span>
                                        </div>
                                    </label>
                                ))}
                                {availableMCPServers.length === 0 && (
                                    <p className="text-black/40 text-sm col-span-full text-center py-4">
                                        No MCP servers configured.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center space-x-2.5">
                            <input
                                type="checkbox"
                                id="enabled"
                                checked={formData.enabled}
                                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                                className="
                                    w-4 h-4 rounded border-surface-300 
                                    text-primary 
                                "
                            />
                            <label htmlFor="enabled" className="text-sm font-medium text-black">
                                Enabled
                            </label>
                        </div>

                        {error && (
                            <div className="text-black bg-surface-300 border border-primary p-3 rounded-xl text-sm font-medium">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Responsive button layout */}
                    <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-5 border-t border-surface-200">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="
                                w-full sm:w-auto
                                px-5 py-2.5 sm:py-3
                                text-black/60 hover:text-black hover:bg-surface-100 
                                rounded-xl transition-colors font-medium
                                text-sm sm:text-base
                                focus-visible:outline-none
                            "
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="
                                w-full sm:w-auto
                                px-5 py-2.5 sm:py-3
                                bg-primary text-black rounded-xl 
                                hover:bg-surface-300 active:scale-95
                                disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
                                transition-all duration-200 font-medium shadow-sm
                                text-sm sm:text-base
                                focus-visible:outline-none
                            "
                        >
                            {loading ? 'Saving...' : 'Save Subagent'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
