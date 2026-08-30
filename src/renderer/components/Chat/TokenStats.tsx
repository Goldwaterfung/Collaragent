import React, { useMemo } from 'react';
import { useChatStore } from '../../store/chatStore';
import { TokenUsage } from '../../types/ui';

interface TokenStatsProps {
    onClose: () => void;
}

export const TokenStats: React.FC<TokenStatsProps> = ({ onClose }) => {
    const threadId = useChatStore(state => state.threadId);
    const messages = useChatStore(state => state.messages);
    const streamingParams = useChatStore(state => state.streamingParams);

    // Find usage from the most recent message
    const latestTurnUsage: TokenUsage = useMemo(() => {
        // Look from the end for the first message with usage
        const msgWithUsage = [...messages].reverse().find(m => m.usage);

        if (msgWithUsage?.usage) {
            return msgWithUsage.usage;
        }

        return {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            reasoningTokens: 0,
            cachedInputTokens: 0
        };
    }, [messages]);

    const activeUsage = threadId ? streamingParams[threadId]?.usage : undefined;

    return (
        <>
            {/* Transparent backdrop for click-away closing */}
            <div className="fixed inset-0 z-40" onClick={onClose} />

            <div
                className="absolute bottom-[calc(100%+12px)] right-4 w-80 p-6 bg-surface-50 rounded-2xl border border-surface-300 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-semibold text-(--ev-c-text-1)">Context Status</h3>
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-200 text-(--ev-c-text-3) hover:text-(--ev-c-text-1) transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-4">
                    <StatRow
                        label="Context (History)"
                        value={activeUsage ? activeUsage.inputTokens : latestTurnUsage.inputTokens}
                        color="text-(--ev-c-text-1)"
                    />
                    <StatRow
                        label="Cache Hits"
                        value={activeUsage ? activeUsage.cachedInputTokens || 0 : latestTurnUsage.cachedInputTokens || 0}
                        color="text-green-600"
                    />
                    <StatRow
                        label="Response size"
                        value={activeUsage ? activeUsage.outputTokens : latestTurnUsage.outputTokens}
                        active={activeUsage ? activeUsage.outputTokens : undefined}
                    />

                    {((latestTurnUsage.reasoningTokens || 0) > 0 || (activeUsage?.reasoningTokens || 0) > 0) && (
                        <StatRow
                            label="Reasoning"
                            value={activeUsage ? (activeUsage.reasoningTokens || 0) : (latestTurnUsage.reasoningTokens || 0)}
                            color="text-purple-600"
                        />
                    )}

                    <div className="pt-4 mt-2 border-t border-surface-200">
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-(--ev-c-text-3) uppercase tracking-wider">Total context</span>
                            <span className="text-xl font-bold font-mono text-(--ev-c-text-1)">
                                {activeUsage ? (activeUsage.totalTokens || 0) : (latestTurnUsage.totalTokens || 0)}
                            </span>
                        </div>
                    </div>
                </div>

                <p className="mt-6 text-[10px] text-(--ev-c-text-3) text-center leading-relaxed">
                    Statistics represent the token usage for the most recent model turn, indicating current context window status.
                </p>
            </div>
        </>
    );
};

const StatRow: React.FC<{ label: string; value: number; active?: number; color?: string }> = ({ label, value, active, color }) => (
    <div className="flex justify-between items-baseline group">
        <span className="text-xs text-(--ev-c-text-2)">{label}</span>
        <div className="flex items-baseline gap-2">
            {active !== undefined && (
                <span className={`text-[10px] font-mono font-medium animate-pulse ${color || 'text-(--color-primary)'}`}>
                    +{active}
                </span>
            )}
            <span className={`text-sm font-semibold font-mono ${color || 'text-(--ev-c-text-1)'}`}>
                {value}
            </span>
        </div>
    </div>
);
