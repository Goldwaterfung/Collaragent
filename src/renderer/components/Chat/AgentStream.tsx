import React, { useEffect, useRef, useState, useMemo } from 'react';
import { AgentStreamProps } from '../../types/ui';
import { renderMarkdown } from '../../utils/markdown';
import ToolCallCard from './ToolCallCard';
import ReasoningCard from './ReasoningCard';
import { LoadingIcon } from '../../assets/icons/LoadingIcon';
import ProgressContainer from './ProgressContainer';
import { groupBlocksByTodos } from './groupBlocks';
import { useChatStore } from '../../store/chatStore';

type StreamedMarkdownProps = {
    content: string;
    animate: boolean;
};

const StreamedMarkdown: React.FC<StreamedMarkdownProps> = ({ content, animate }) => {
    const [displayed, setDisplayed] = useState(animate ? '' : content);
    const targetRef = useRef(content);
    const displayedRef = useRef(displayed);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        displayedRef.current = displayed;
    }, [displayed]);

    useEffect(() => {
        targetRef.current = content;

        if (!animate) {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            setDisplayed(content);
            return;
        }

        if (displayedRef.current.length > content.length) {
            setDisplayed(content);
        }

        const tick = () => {
            const current = displayedRef.current;
            const target = targetRef.current;
            if (current.length >= target.length) {
                rafRef.current = null;
                return;
            }
            const next = target.slice(0, current.length + 1);
            displayedRef.current = next;
            setDisplayed(next);
            rafRef.current = requestAnimationFrame(tick);
        };

        if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(tick);
        }

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [content, animate]);

    return (
        <div
            className="chat-markdown prose dark:prose-invert max-w-none text-black wrap-break-word"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayed) }}
        />
    );
};


export const AgentStream: React.FC<AgentStreamProps> = ({ isStreaming, currentNode, interrupt, toolCalls, blocks, onResume, onOpenSubagentTask }) => {
    if (!isStreaming && !blocks?.length && !interrupt) return null;

    const upsertSubagentTask = useChatStore((s) => s.upsertSubagentTask);

    // Sync tool calls that are task/dynamic_task into the subagentTasks store
    // so SubagentTaskCard and SubagentStreamPane can read status/result.
    useMemo(() => {
        if (!toolCalls) return;
        for (const tc of toolCalls) {
            if (tc.name !== 'task' && tc.name !== 'dynamic_task') continue;
            const description = (tc.args as any)?.description ?? '';
            const agentType = (tc.args as any)?.subagent_type ?? 'custom';
            const isCompleted = tc.status === 'completed' || !!tc.result;
            const resultStr = typeof tc.result === 'string'
                ? tc.result
                : tc.result != null ? JSON.stringify(tc.result) : undefined;
            upsertSubagentTask({
                id: tc.id,
                toolName: tc.name as 'task' | 'dynamic_task',
                subagentType: agentType,
                description,
                status: isCompleted ? 'completed' : 'running',
                result: resultStr,
                startedAt: Date.now(),
                completedAt: isCompleted ? Date.now() : undefined,
            });
        }
    }, [toolCalls]);

    const [statusIndex, setStatusIndex] = useState(0);

    useEffect(() => {
        if (!isStreaming) {
            setStatusIndex(0);
            return;
        }

        const intervalId = window.setInterval(() => {
            setStatusIndex((prev) => (prev + 1) % 2);
        }, 5000);

        return () => window.clearInterval(intervalId);
    }, [isStreaming]);

    const groupedBlocks = useMemo(() => groupBlocksByTodos(blocks, toolCalls), [blocks, toolCalls]);

    const streamingStatus = statusIndex === 0 ? 'Working...' : 'Generating...';

    const lastTextIndex = blocks ? [...blocks].map((b, i) => ({ b, i })).filter(({ b }) => b.type === 'text').pop()?.i : undefined;
    const lastReasoningIndex = blocks ? [...blocks].map((b, i) => ({ b, i })).filter(({ b }) => b.type === 'reasoning').pop()?.i : undefined;

    return (
        <div className="agent-stream py-4 space-y-4">
            <div className="flex items-center space-x-2 text-xs font-mono uppercase text-gray-500">
                <div className="w-6 h-6 flex items-center">
                    <LoadingIcon width={20} height={20} isStreaming={isStreaming} className={isStreaming ? '' : (interrupt ? 'opacity-95' : 'opacity-60')} />
                </div>
                <span>{interrupt ? 'Action Required' : (isStreaming ? (currentNode || streamingStatus) : 'Finished')}</span>
            </div>

            {groupedBlocks.map((group, gIdx) => (
                <ProgressContainer key={gIdx} inProgressTodos={group.inProgressTodos}>
                    <div className="space-y-4">
                        {group.blocks.map((block, i) => {
                            // Find absolute index in original blocks for animation logic
                            const absIdx = blocks?.indexOf(block);
                            return block.type === 'text' ? (
                                <StreamedMarkdown
                                    key={i}
                                    content={block.content}
                                    animate={isStreaming && lastTextIndex === absIdx}
                                />
                            ) : block.type === 'reasoning' ? (
                                <ReasoningCard 
                                    key={i} 
                                    content={block.content} 
                                    isStreaming={isStreaming && lastReasoningIndex === absIdx} 
                                />
                            ) : (() => {
                                const tool = toolCalls?.find(t => t.id === block.toolId);
                                return tool ? <ToolCallCard key={i} tool={tool} onOpenSubagentTask={onOpenSubagentTask} /> : null;
                            })()
                        })}
                    </div>
                </ProgressContainer>
            ))}


            {interrupt && onResume && (
                <div className="p-3 bg-yellow-50 rounded border border-yellow-200">
                    <pre className="text-xs overflow-auto max-h-40 mb-3">{JSON.stringify(interrupt, null, 2)}</pre>
                    <div className="flex gap-2">
                        <button onClick={() => onResume({ decisions: [{ type: "approve" }] })} className="px-3 py-1 bg-green-600 text-white rounded text-sm">Approve</button>
                        <button onClick={() => onResume({ decisions: [{ type: "reject", message: "User rejected" }] })} className="px-3 py-1 bg-red-600 text-white rounded text-sm">Reject</button>
                    </div>
                </div>
            )}
        </div>
    );
};
