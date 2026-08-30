import React, { useEffect, useRef } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import { ToolCall } from './types';
import { useChatStore } from '../../store/chatStore';

interface SubagentStreamPaneProps {
    toolCallId: string;
    /** Raw tool object from the active stream or message history */
    tool: ToolCall;
    onBack: () => void;
}

export const SubagentStreamPane: React.FC<SubagentStreamPaneProps> = ({ toolCallId, tool, onBack }) => {
    const task = useChatStore((s) => s.subagentTasks[toolCallId]);
    const resultRef = useRef<HTMLDivElement>(null);

    const agentType: string =
        tool.name === 'task'
            ? (tool.args as any)?.subagent_type || 'general-purpose'
            : (tool.args as any)?.subagent_config?.systemPrompt
                ? 'custom'
                : 'dynamic';

    const description: string =
        (tool.args as any)?.description || task?.description || '';

    const result: string | undefined =
        task?.result ?? (typeof tool.result === 'string' ? tool.result : undefined);

    const status = task?.status ?? (tool.result ? 'completed' : 'pending');

    // Auto-scroll to result when it arrives
    useEffect(() => {
        if (result) {
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [result]);

    const statusDot = {
        pending: 'bg-amber-400 animate-pulse',
        running: 'bg-blue-400 animate-pulse',
        completed: 'bg-emerald-400',
        error: 'bg-red-400',
    }[status] ?? 'bg-gray-400';

    const statusLabel = {
        pending: 'Queued',
        running: 'Running…',
        completed: 'Completed',
        error: 'Error',
    }[status] ?? 'Unknown';

    return (
        <div
            id={`subagent-pane-${toolCallId}`}
            className="flex flex-col h-full bg-surface-50 animate-in slide-in-from-right duration-200"
        >
            {/* ── Header bar ── */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-200 bg-white/80 backdrop-blur-sm shrink-0">
                <button
                    id="subagent-back-btn"
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors group"
                >
                    <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="group-hover:-translate-x-0.5 transition-transform"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back
                </button>

                <div className="w-px h-4 bg-surface-200" />

                {/* Agent identity */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-violet-500/15 text-violet-600 shrink-0">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                        </svg>
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-violet-500 leading-none">
                            {tool.name === 'dynamic_task' ? 'Dynamic Task' : 'Subagent Task'}
                        </span>
                        <span className="text-sm font-semibold text-gray-800 leading-tight truncate">
                            {agentType}
                        </span>
                    </div>
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Status pill */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-100 border border-surface-200">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                    <span className="text-[11px] font-semibold text-gray-600">{statusLabel}</span>
                </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-6">

                    {/* Task prompt bubble */}
                    {description && (
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Task Prompt</p>
                            <div className="bg-surface-100/50 border border-surface-200/50 rounded-xl px-4 py-3">
                                <div
                                    className="chat-markdown prose dark:prose-invert max-w-none text-sm wrap-break-word"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Result section */}
                    <div ref={resultRef}>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                            {status === 'completed' ? 'Result' : 'Result (pending…)'}
                        </p>

                        {result ? (
                            <div className="py-2 border-b border-surface-100/50">
                                {/* Agent avatar row */}
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-600">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="3" />
                                            <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                                        </svg>
                                    </div>
                                    <span className="text-xs font-semibold text-gray-500 capitalize">{agentType}</span>
                                    {task?.completedAt && (
                                        <span className="text-[10px] text-gray-400 ml-auto">
                                            {new Date(task.completedAt).toLocaleTimeString()}
                                        </span>
                                    )}
                                </div>
                                <div
                                    className="chat-markdown prose dark:prose-invert max-w-none text-sm sm:text-base wrap-break-word"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }}
                                />
                            </div>
                        ) : (
                            /* Skeleton placeholder while waiting */
                            <div className="space-y-2 py-4 animate-pulse">
                                <div className="h-3 bg-surface-200 rounded w-3/4" />
                                <div className="h-3 bg-surface-200 rounded w-5/6" />
                                <div className="h-3 bg-surface-200 rounded w-2/3" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SubagentStreamPane;
