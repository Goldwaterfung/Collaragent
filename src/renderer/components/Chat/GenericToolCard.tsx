import React, { useState } from 'react';
import { ToolCall } from './types';
import { ChevronDownIcon } from '../../assets/icons/ChevronDownIcon';

interface Props {
    tool: ToolCall;
}

export const GenericToolCard: React.FC<Props> = ({ tool }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (tool.name === 'write_todos') return null;

    let hasArgs = false;
    try {
        hasArgs = tool.args && Object.keys(tool.args).length > 0;
    } catch (e) {
        hasArgs = true;
    }


    return (
        <div className="group relative bg-white/50 border border-surface-200 rounded-xl overflow-hidden transition-all hover:shadow-md hover:border-primary">
            <div 
                className="flex items-center justify-between p-3 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary/20 text-primary">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-gray-500 leading-none mb-1">
                            Tool Call
                        </span>
                        <span className="text-sm font-semibold text-gray-800 leading-none">
                            {tool.name}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {!isExpanded && hasArgs && (
                        <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-surface-100 rounded-full border border-surface-200 max-w-[150px]">
                             <span className="text-[10px] text-gray-500 truncate">
                                {typeof tool.args === 'string' ? tool.args : (() => {
                                    try { return JSON.stringify(tool.args); } catch { return "Invalid args"; }
                                })()}
                             </span>
                        </div>
                    )}
                    <div className={`transform transition-transform duration-200 text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}>
                         <ChevronDownIcon width={16} height={16} />
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200 border-t border-surface-100 pt-3 mt-1">
                    {hasArgs && (
                        <div className="space-y-1">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Parameters</h4>
                            <div className="p-2.5 bg-surface-100/30 rounded-lg border border-surface-200/50 max-h-60 overflow-y-auto">
                                <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap">
                                    {JSON.stringify(tool.args, null, 2)}
                                </pre>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default GenericToolCard;
