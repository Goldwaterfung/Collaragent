import React, { useState, useEffect } from 'react';
import type { MCPServerConfig, MCPTransportType } from '@shared/config/types';

interface MCPServerSettingsProps {
    mcpServers: MCPServerConfig[];
    onRefresh: () => Promise<void>;
}

export const MCPServerSettings: React.FC<MCPServerSettingsProps> = ({ mcpServers, onRefresh }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newServer, setNewServer] = useState<Partial<MCPServerConfig>>({
        name: '',
        enabled: true,
        transport: {
            type: 'stdio',
            command: '',
            args: [],
            env: {}
        }
    });
    const [argsInput, setArgsInput] = useState<string>(newServer.transport?.args?.join(', ') || '');

    const [serverTools, setServerTools] = useState<Record<string, { name: string, description?: string }[]>>({});
    const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});
    const [toolErrors, setToolErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (isAdding) {
            setArgsInput(newServer.transport?.args?.join(', ') || '');
        } else {
            setArgsInput('');
        }
    }, [isAdding, newServer.transport?.args, newServer.transport?.type]);

    const handleToggleServer = async (serverId: string, enabled: boolean) => {
        try {
            await window.configIPC.toggleMCPServer({ id: serverId, enabled });
            await onRefresh();
        } catch (err) {
            console.error("Failed to toggle MCP server", err);
        }
    };

    const handleDeleteServer = async (serverId: string) => {
        try {
            await window.configIPC.deleteMCPServer({ id: serverId });
            await onRefresh();
        } catch (err) {
            console.error("Failed to delete MCP server", err);
        }
    };

    const handleFetchTools = async (serverId: string) => {
        setLoadingTools(prev => ({ ...prev, [serverId]: true }));
        setToolErrors(prev => ({ ...prev, [serverId]: '' }));
        try {
            const res = await window.configIPC.fetchMCPTools({ serverId });
            if (res.success) {
                setServerTools(prev => ({ ...prev, [serverId]: res.tools }));
            } else {
                setToolErrors(prev => ({ ...prev, [serverId]: res.error || 'Unknown error' }));
            }
        } catch (err: any) {
            setToolErrors(prev => ({ ...prev, [serverId]: err.message }));
        } finally {
            setLoadingTools(prev => ({ ...prev, [serverId]: false }));
        }
    };

    const handleToggleServerTool = async (server: MCPServerConfig, toolName: string, enabled: boolean) => {
        try {
            const currentDisabled = server.disabledTools || [];
            let newDisabled: string[];

            if (enabled) {
                newDisabled = currentDisabled.filter(t => t !== toolName);
            } else {
                if (!currentDisabled.includes(toolName)) {
                    newDisabled = [...currentDisabled, toolName];
                } else {
                    newDisabled = currentDisabled;
                }
            }

            await window.configIPC.updateMCPServer({
                id: server.id,
                updates: { disabledTools: newDisabled }
            });
            await onRefresh();
        } catch (err) {
            console.error("Failed to toggle MCP server tool", err);
        }
    };

    const handleAddServer = async () => {
        if (!newServer.name || !newServer.transport?.type) return;

        try {
            const serverId = `mcp-${Date.now()}`;
            const parsedArgs = argsInput.split(',').map(s => s.trim()).filter(s => s !== '');
            const transport = { ...newServer.transport } as any;
            if (transport.type === 'stdio') transport.args = parsedArgs;

            const serverToAdd: MCPServerConfig = {
                id: serverId,
                name: newServer.name,
                enabled: newServer.enabled ?? true,
                transport
            };

            await window.configIPC.addMCPServer({ server: serverToAdd });
            setIsAdding(false);
            setNewServer({
                name: '',
                enabled: true,
                transport: {
                    type: 'stdio',
                    command: '',
                    args: [],
                    env: {}
                }
            });
            setArgsInput('');
            await onRefresh();
        } catch (err) {
            console.error("Failed to add MCP server", err);
        }
    };

    const renderTransportFields = () => {
        if (!newServer.transport) return null;

        if (newServer.transport.type === 'stdio') {
            return (
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-black/60 uppercase tracking-wider mb-1">Command</label>
                        <input
                            type="text"
                            className="w-full p-2 bg-surface-50 border border-surface-200 rounded-lg text-sm font-mono"
                            placeholder="e.g. npx, node, python"
                            value={newServer.transport.command || ''}
                            onChange={e => setNewServer({
                                ...newServer,
                                transport: { ...newServer.transport!, command: e.target.value }
                            })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-black/60 uppercase tracking-wider mb-1">Arguments (comma separated)</label>
                        <input
                            type="text"
                            className="w-full p-2 bg-surface-50 border border-surface-200 rounded-lg text-sm font-mono"
                            placeholder="e.g. -y, @modelcontextprotocol/server-everything, arg1"
                            value={argsInput}
                            onChange={e => setArgsInput(e.target.value)}
                        />
                    </div>
                </div>
            );
        } else {
            return (
                <div>
                    <label className="block text-xs font-semibold text-black/60 uppercase tracking-wider mb-1">Server URL</label>
                    <input
                        type="text"
                        className="w-full p-2 bg-surface-50 border border-surface-200 rounded-lg text-sm font-mono"
                        placeholder="e.g. http://localhost:8000/mcp"
                        value={newServer.transport.url || ''}
                        onChange={e => setNewServer({
                            ...newServer,
                            transport: { ...newServer.transport!, url: e.target.value }
                        })}
                    />
                </div>
            );
        }
    };

    return (
        <div className="mcp-settings mt-6 p-4 sm:p-6 lg:p-8 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-black">MCP Servers</h3>
                    <p className="text-xs sm:text-sm text-black/50 mt-1">Connect to external tool servers via Model Context Protocol</p>
                </div>
                <button
                    onClick={() => setIsAdding(true)}
                    className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-all active:scale-95"
                >
                    Add Server
                </button>
            </div>

            <div className="space-y-4">
                {mcpServers.map(server => (
                    <div
                        key={server.id}
                        className="flex flex-col p-4 bg-surface-50 rounded-xl border border-surface-200 hover:border-surface-300 transition-all"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-green-500' : 'bg-surface-300'}`} />
                                <div className="font-medium text-black">{server.name}</div>
                                <div className="px-2 py-0.5 bg-surface-200 rounded text-[10px] uppercase font-bold text-black/60">
                                    {server.transport.type}
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={server.enabled}
                                        onChange={(e) => handleToggleServer(server.id, e.target.checked)}
                                    />
                                    <div className="w-9 h-5 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                                <button
                                    onClick={() => handleDeleteServer(server.id)}
                                    className="text-black/30 hover:text-red-500 transition-colors p-1"
                                    title="Delete"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div className="text-xs font-mono text-black/50 break-all mb-2">
                            {server.transport.type === 'stdio'
                                ? `${server.transport.command} ${server.transport.args?.join(' ')}`
                                : server.transport.url
                            }
                        </div>

                        {server.enabled && server.requireAPI && (
                            <div className="mt-2 pt-2 border-t border-surface-200">
                                <ToolApiKeyInput
                                    toolId={server.id}
                                    label={`API Key (${server.apiKeyName || 'API_KEY'})`}
                                />
                            </div>
                        )}

                        {server.enabled && (
                            <div className="mt-4 pt-4 border-t border-surface-200">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-black/60 uppercase tracking-wider">Available Tools</span>
                                    <button
                                        onClick={() => handleFetchTools(server.id)}
                                        disabled={loadingTools[server.id] || !server.enabled}
                                        className="px-3 py-1 bg-surface-200 text-black/70 text-xs font-medium rounded hover:bg-surface-300 disabled:opacity-50 transition-colors"
                                    >
                                        {loadingTools[server.id] ? 'Fetching...' : 'Refresh Tools'}
                                    </button>
                                </div>

                                {toolErrors[server.id] && (
                                    <div className="text-xs text-red-500 mb-2 p-2 bg-red-50 border border-red-100 rounded">
                                        {toolErrors[server.id]}
                                    </div>
                                )}

                                {serverTools[server.id] && serverTools[server.id].length > 0 && (
                                    <div className="space-y-2 mt-2 max-h-64 overflow-y-auto pr-1 stylish-scrollbar">
                                        {serverTools[server.id].map((tool: { name: string, description?: string }) => {
                                            const isDisabled = server.disabledTools?.includes(tool.name);
                                            return (
                                                <div key={tool.name} className="flex flex-row items-center justify-between p-2.5 bg-white rounded-lg border border-surface-100 hover:border-surface-200 transition-colors">
                                                    <div className="flex-1 min-w-0 pr-4">
                                                        <div className="text-sm font-medium text-black truncate">{tool.name}</div>
                                                        {tool.description && (
                                                            <div className="text-xs text-black/50 line-clamp-2 mt-0.5">{tool.description}</div>
                                                        )}
                                                    </div>
                                                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={!isDisabled}
                                                            onChange={(e) => handleToggleServerTool(server, tool.name, e.target.checked)}
                                                        />
                                                        <div className="w-8 h-4.5 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-primary"></div>
                                                    </label>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {serverTools[server.id] && serverTools[server.id].length === 0 && (
                                    <div className="text-xs text-black/40 italic p-2 bg-white rounded border border-surface-100">No tools found on this server.</div>
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {mcpServers.length === 0 && !isAdding && (
                    <div className="text-center py-8 bg-surface-50 rounded-xl border border-dashed border-surface-200">
                        <p className="text-black/40 text-sm italic">No MCP servers configured.</p>
                    </div>
                )}

                {isAdding && (
                    <div className="p-5 bg-white border-2 border-primary/30 rounded-xl shadow-lg space-y-4 animate-in fade-in slide-in-from-top-2">
                        <h4 className="font-semibold text-black">New MCP Server</h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-black/60 uppercase tracking-wider mb-1">Server Name</label>
                                <input
                                    type="text"
                                    className="w-full p-2 border border-surface-200 rounded-lg text-sm"
                                    placeholder="e.g. Math Tools"
                                    value={newServer.name || ''}
                                    onChange={e => setNewServer({ ...newServer, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-black/60 uppercase tracking-wider mb-1">Transport</label>
                                <select
                                    className="w-full p-2 border border-surface-200 rounded-lg text-sm bg-white"
                                    value={newServer.transport?.type}
                                    onChange={e => {
                                        const type = e.target.value as MCPTransportType;
                                        setNewServer({
                                            ...newServer,
                                            transport: type === 'stdio'
                                                ? { type, command: '', args: [], env: {} }
                                                : { type, url: '' }
                                        });
                                        setArgsInput('');
                                    }}
                                >
                                    <option value="stdio">stdio (Local process)</option>
                                    <option value="sse">sse (HTTP SSE)</option>
                                    <option value="http">http (Streamable HTTP)</option>
                                </select>
                            </div>
                        </div>

                        {renderTransportFields()}

                        <div className="flex items-center gap-6 p-3 bg-surface-50 rounded-lg border border-surface-100">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="requireAPI-new"
                                    className="w-4 h-4 rounded border-surface-300 text-primary focus:ring-primary"
                                    checked={newServer.requireAPI || false}
                                    onChange={e => setNewServer({ ...newServer, requireAPI: e.target.checked })}
                                />
                                <label htmlFor="requireAPI-new" className="text-xs font-medium text-black/70">Secure API Key</label>
                            </div>

                            {newServer.requireAPI && (
                                <div className="flex-1 flex items-center gap-2">
                                    <label className="text-[10px] font-bold text-black/40 uppercase whitespace-nowrap">Env Var</label>
                                    <input
                                        type="text"
                                        className="flex-1 p-1.5 border border-surface-200 rounded text-xs font-mono"
                                        placeholder="API_KEY"
                                        value={newServer.apiKeyName || ''}
                                        onChange={e => setNewServer({ ...newServer, apiKeyName: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                onClick={() => {
                                    setIsAdding(false);
                                    setArgsInput('');
                                    setNewServer({
                                        name: '',
                                        enabled: true,
                                        transport: {
                                            type: 'stdio',
                                            command: '',
                                            args: [],
                                            env: {}
                                        }
                                    });
                                }}
                                className="px-4 py-2 text-sm font-medium text-black/60 hover:text-black transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddServer}
                                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-all"
                            >
                                Save Server
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ToolApiKeyInput: React.FC<{ toolId: string, label?: string }> = ({ toolId, label = "API Key Required" }) => {
    const [hasKey, setHasKey] = React.useState(false);
    const [tempValue, setTempValue] = React.useState('');
    const [isSaved, setIsSaved] = React.useState(false);

    React.useEffect(() => {
        const check = async () => {
            const res = await window.configIPC.checkKey({ id: toolId });
            setHasKey(res.exists);
        };
        check();
    }, [toolId]);

    const handleBlur = async () => {
        if (tempValue) {
            const res = await window.configIPC.setToolApiKey({ toolId, apiKey: tempValue });
            if (res.success) {
                setHasKey(true);
                setTempValue('');
                setIsSaved(true);
                setTimeout(() => setIsSaved(false), 2000);
            }
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-black/60 block">
                    {label}
                </label>
                {isSaved && <span className="text-[10px] text-green-600 font-bold animate-pulse">SAVED</span>}
                {!isSaved && hasKey && <span className="text-[10px] text-primary font-bold opacity-60">STORED</span>}
            </div>
            <div className="flex gap-2">
                <input
                    type="password"
                    placeholder={hasKey ? "••••••••" : "Enter secure API Key"}
                    className="flex-1 text-xs p-1.5 border border-surface-300 rounded bg-white focus:outline-none focus:border-primary transition-colors"
                    value={tempValue}
                    onChange={(e) => setTempValue(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                />
            </div>
        </div>
    );
};
