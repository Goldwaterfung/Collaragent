import React from 'react';
import { ToolConfig } from '@shared/config/types';

interface ToolListProps {
    tools: ToolConfig[];
    onToggle: (toolId: string, enabled: boolean) => Promise<void>;
}

export const ToolList: React.FC<ToolListProps> = ({ tools, onToggle }) => {
    return (
        <div className="tool-list p-4 sm:p-6 lg:p-8 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm">
            <div className="mb-4 sm:mb-5 lg:mb-6">
                <h3 className="text-base sm:text-lg lg:text-xl font-semibold text-black">Main Agent Tools</h3>
                <p className="text-xs sm:text-sm text-black/50 mt-1">Select tools available directly to the main agent</p>
            </div>

            {/* Responsive grid layout on larger screens */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                {tools.map(tool => (
                    <div
                        key={tool.id}
                        className="
                            flex flex-col
                            p-3 sm:p-4 
                            bg-surface-50 rounded-xl border border-surface-200 
                            hover:border-surface-300 hover:shadow-sm
                            transition-all duration-200
                        "
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex-1 min-w-0 mr-3">
                                <div className="font-medium text-black text-sm sm:text-base truncate">{tool.name}</div>
                                <div className="text-xs sm:text-sm text-black/50 font-mono mt-0.5 truncate">{tool.langchainTool}</div>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={tool.enabled}
                                    onChange={(e) => onToggle(tool.id, e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                            </label>
                        </div>

                        {tool.enabled && tool.requireAPI && (
                            <ToolApiKeyInput toolId={tool.id} />
                        )}
                    </div>
                ))}
                {tools.length === 0 && (
                    <div className="md:col-span-2">
                        <p className="text-black/50 text-sm sm:text-base text-center py-6 sm:py-8">No tools available.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const ToolApiKeyInput: React.FC<{ toolId: string }> = ({ toolId }) => {
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
        <div className="mt-2 pt-2 border-t border-surface-200">
            <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-black/60 block">
                    API Key Required
                </label>
                {isSaved && <span className="text-[10px] text-green-600 font-bold animate-pulse">SAVED</span>}
                {!isSaved && hasKey && <span className="text-[10px] text-primary font-bold opacity-60">STORED</span>}
            </div>
            <div className="flex gap-2">
                <input
                    type="password"
                    placeholder={hasKey ? "••••••••" : "Enter API Key"}
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
