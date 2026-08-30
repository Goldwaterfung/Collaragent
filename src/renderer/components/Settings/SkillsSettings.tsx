import { useState } from 'react';
import type { AppConfig } from '@shared/config/types';

type Props = {
    config: AppConfig;
    onSave: (config: AppConfig) => Promise<void>;
};

export function SkillsSettings({ config, onSave }: Props) {
    const [source, setSource] = useState(
        config.middleware?.skills?.source ?? ''
    );
    const [enabled, setEnabled] = useState(
        config.middleware?.skills?.enabled ?? false
    );

    const handlePickDirectory = async () => {
        const res = await window.skillsIPC.pickDirectory();
        if (!res.path) return;
        setSource(res.path);
        await saveConfig(enabled, res.path);
    };

    const handleClearDirectory = async () => {
        setSource('');
        await saveConfig(enabled, '');
    };

    const handleToggle = async (newEnabled: boolean) => {
        setEnabled(newEnabled);
        await saveConfig(newEnabled, source);
    };

    const saveConfig = async (en: boolean, src: string) => {
        const newConfig = {
            ...config,
            middleware: {
                ...config.middleware,
                skills: { enabled: en, source: src },
            },
        };
        await onSave(newConfig);
    };

    return (
        <div className="p-4 sm:p-5 bg-white rounded-xl sm:rounded-2xl border border-surface-200 shadow-sm transition-all hover:border-primary/20">
            {/* Header with toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex-1">
                    <h3 className="font-semibold text-base sm:text-lg">Skills Middleware</h3>
                    <p className="text-xs sm:text-sm text-black/50 mt-1">
                        Load SKILL.md files from a directory to extend agent capabilities
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 self-start sm:self-auto">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={enabled}
                        onChange={(e) => handleToggle(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                </label>
            </div>

            {/* Source Directory (shown when enabled) */}
            {enabled && (
                <div className="mt-4 pt-4 border-t border-surface-100 space-y-2">
                    <p className="text-[10px] sm:text-xs font-semibold text-black/60 uppercase tracking-wider mb-2">
                        Source Directory
                    </p>
                    <p className="text-xs text-black/40 mb-3">
                        The agent scans this directory for subdirectories containing SKILL.md files.
                    </p>

                    {/* Current directory */}
                    {source ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg font-mono text-[10px] sm:text-xs group hover:border-primary/30 transition-colors">
                            <span className="truncate text-black/70 flex-1">{source}</span>
                            <button
                                onClick={handleClearDirectory}
                                className="text-black/30 hover:text-red-500 transition-colors p-1"
                                title="Remove"
                            >
                                ✕
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs italic text-black/40 bg-surface-50 p-3 rounded-lg border border-dashed border-surface-200">
                            No directory configured. Pick one below to start using skills.
                        </p>
                    )}

                    {/* Pick Directory button */}
                    <button
                        onClick={handlePickDirectory}
                        className="mt-3 w-full sm:w-auto px-4 py-2 text-xs font-medium bg-surface-100 hover:bg-surface-200 border border-surface-200 rounded-lg transition-all text-black/60 hover:text-black active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span className="text-lg leading-none">📁</span>
                        {source ? 'Change Directory' : 'Pick Directory'}
                    </button>
                </div>
            )}
        </div>
    );
}
