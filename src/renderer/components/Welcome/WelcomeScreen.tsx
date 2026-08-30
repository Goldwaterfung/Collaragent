import { useState, useEffect } from 'react';
import { PlusIcon } from '../../assets/icons/PlusIcon';
import { FolderOpenIcon } from '../../assets/icons/FolderOpenIcon';
import { LogoIcon } from '../../assets/icons/LogoIcon';
import type { RecentFile } from '@shared/config/types';


export function WelcomeScreen() {
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

    useEffect(() => {
        window.fileIPC.getRecentFiles().then(setRecentFiles).catch(console.error);
    }, []);

    const handleCreateFile = async () => {
        try {
            await window.fileIPC.createFile();
        } catch (e) {
            console.error('Failed to create workspace', e);
        }
    };

    const handleOpenFile = async () => {
        try {
            await window.fileIPC.openFile();
        } catch (e) {
            console.error('Failed to open workspace', e);
        }
    };

    const handleOpenRecent = async (path: string) => {
        try {
            const result = await window.fileIPC.openWorkspace(path);
            if (result && !result.success) {
                // Refresh list if it might have changed (e.g. removed from list)
                window.fileIPC.getRecentFiles().then(setRecentFiles).catch(console.error);
            }
        } catch (e) {
            console.error('Failed to open recent workspace', e);
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-[var(--color-surface-50)] text-[var(--ev-c-text-1)] select-none overflow-hidden">
            {/* Header / Brand */}
            <div className="flex-none pt-16 pb-8 text-center animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="inline-block mb-4">
                    <LogoIcon className="w-16 h-16" />
                </div>
                <h1 className="text-4xl font-extrabold tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-[var(--ev-c-text-1)] to-[var(--ev-c-text-2)]">
                    CollarAgent
                </h1>
                <p className="text-[var(--ev-c-text-2)] text-lg">Your Local-first Agent Workspace</p>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col items-center justify-start w-full max-w-4xl mx-auto px-6 gap-12">

                {/* Action Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl animate-in fade-in zoom-in-95 duration-500 delay-150">
                    <button
                        onClick={handleCreateFile}
                        className="group relative flex flex-col items-center justify-center p-8 rounded-2xl border border-[var(--color-surface-200)] bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-50)] hover:border-[var(--color-primary)] hover:shadow-lg hover:shadow-[var(--color-primary)]/10 transition-all duration-300 cursor-pointer text-left overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="bg-[var(--color-primary)]/10 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
                            <PlusIcon className="w-8 h-8 text-[var(--color-primary)]" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Create New Workspace</h3>
                        <p className="text-[var(--ev-c-text-3)] text-center text-sm">Start a fresh workspace for your agentic workflows.</p>
                    </button>

                    <button
                        onClick={handleOpenFile}
                        className="group relative flex flex-col items-center justify-center p-8 rounded-2xl border border-[var(--color-surface-200)] bg-[var(--color-surface-100)] hover:bg-[var(--color-surface-50)] hover:border-[var(--color-accent)] hover:shadow-lg hover:shadow-[var(--color-accent)]/10 transition-all duration-300 cursor-pointer text-left overflow-hidden"
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="bg-[var(--color-surface-300)] p-4 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
                            <FolderOpenIcon className="w-8 h-8 text-[var(--ev-c-text-1)]" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Open Workspace</h3>
                        <p className="text-[var(--ev-c-text-3)] text-center text-sm">Continue working on your stored <code className="bg-[var(--color-surface-200)] px-1 rounded text-xs select-text">.cagent</code> workspaces.</p>
                    </button>
                </div>

                {/* Recent Projects Placeholder */}
                <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold text-[var(--ev-c-text-2)] uppercase tracking-wider">Recent Workspaces</h2>
                        {recentFiles.length > 0 && (
                            <span className="text-xs text-[var(--ev-c-text-3)]">{recentFiles.length} found</span>
                        )}
                    </div>

                    <div className="flex flex-col gap-2 opacity-90">
                        {recentFiles.length === 0 ? (
                            <div className="w-full p-4 rounded-lg border border-dashed border-[var(--color-surface-300)] bg-[var(--color-surface-50)] text-center">
                                <p className="text-[var(--ev-c-text-3)] text-sm opacity-60">No recent workspaces found</p>
                            </div>
                        ) : (
                            recentFiles.map((file) => (
                                <div
                                    key={file.path}
                                    onClick={() => handleOpenRecent(file.path)}
                                    className="group flex items-center justify-between p-3 rounded-lg border border-[var(--color-surface-200)] bg-[var(--color-surface-100)] hover:border-[var(--color-primary)] cursor-pointer transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm text-[var(--ev-c-text-1)]">{file.name}</span>
                                            <span className="text-xs text-[var(--ev-c-text-3)] truncate max-w-[300px]" title={file.path}>{file.path}</span>
                                        </div>
                                    </div>
                                    <div className="text-xs text-[var(--ev-c-text-3)]">
                                        {new Date(file.lastOpened).toLocaleDateString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="flex-none pb-4 text-center">
                <p className="text-xs text-[var(--ev-c-text-3)] opacity-50">CollarAgent v1.0.0</p>
            </div>
        </div>
    );
}
