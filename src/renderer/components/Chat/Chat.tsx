import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useChatStore } from '../../store/chatStore';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { AgentStream } from './AgentStream';
import { TodoCard } from './TodoCard';
import { ChatMessage } from '../../types/ui';
import { SubagentStreamPane } from './SubagentStreamPane';
import type { ToolCall } from './types';
import * as Channels from '@shared/ipc/agent/channels';
import * as Types from '@shared/ipc/agent/types';
import { useProjectSession } from '@workspace/contexts/project/ProjectSession';
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext';
import * as ChatService from '@shared/services/ChatService';
import type { CheckpointBundleSummary } from '@shared/ipc/checkpoints/types';
import { getStreamErrorPresentation } from '../../utils/streamErrors';

export const Chat: React.FC = () => {

    const {
        messages,
        streamingParams,
        addMessage,
        setStreaming,
        resetStreaming,
        threadId,
        setThreadId,
        setMessages,
        setDraftInput,
        upsertSubagentTask
    } = useChatStore();

    const { activeProjectId, instanceId, openInstanceIds } = useInstanceContext();

    // Derive active streaming state for current view
    const activeStreaming = threadId && streamingParams[threadId]
        ? streamingParams[threadId]
        : { isStreaming: false, accumulatedContent: '', blocks: [], tokensReceived: 0, startTime: null, currentMessage: '' };

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const streamMessageIdsRef = useRef<Map<string, { assistantId: string }>>(new Map());
    const [checkpointBundles, setCheckpointBundles] = useState<CheckpointBundleSummary[]>([]);
    const [checkpointBusy, setCheckpointBusy] = useState(false);
    const [, setCheckpointError] = useState<string | null>(null);

    // ── Subagent pane navigation ──
    // Stores the { toolCallId, tool } that the user last clicked "View Task" on.
    const [activeSubagentTask, setActiveSubagentTask] = useState<{ toolCallId: string; tool: ToolCall } | null>(null);

    const handleOpenSubagentTask = useCallback((toolCallId: string) => {
        // Find the tool object from active stream or message history
        const activeTCs = activeStreaming.toolCalls || [];
        let tool: ToolCall | undefined = activeTCs.find((tc) => tc.id === toolCallId);
        if (!tool) {
            for (const msg of messages) {
                tool = msg.toolCalls?.find((tc: any) => tc.id === toolCallId) as ToolCall | undefined;
                if (tool) break;
            }
        }
        if (tool) setActiveSubagentTask({ toolCallId, tool });
    }, [activeStreaming.toolCalls, messages]);

    const handleCloseSubagentTask = useCallback(() => {
        setActiveSubagentTask(null);
    }, []);

    // Seed subagentTasks store from historical messages on mount / message change
    useEffect(() => {
        for (const msg of messages) {
            if (!msg.toolCalls) continue;
            for (const tc of msg.toolCalls) {
                if (tc.name !== 'task' && tc.name !== 'dynamic_task') continue;
                const resultStr = typeof tc.result === 'string'
                    ? tc.result
                    : tc.result != null ? JSON.stringify(tc.result) : undefined;
                upsertSubagentTask({
                    id: tc.id,
                    toolName: tc.name as 'task' | 'dynamic_task',
                    subagentType: (tc.args as any)?.subagent_type ?? 'custom',
                    description: (tc.args as any)?.description ?? '',
                    status: tc.status === 'completed' || resultStr ? 'completed' : 'pending',
                    result: resultStr,
                    startedAt: 0,
                    completedAt: resultStr ? Date.now() : undefined,
                });
            }
        }
    }, [messages]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, activeStreaming.accumulatedContent, activeStreaming.isStreaming]);

    const refreshBundles = useCallback(async (targetThreadId?: string) => {
        const activeThreadId = targetThreadId || threadId;
        if (!activeThreadId || !window.checkpointIPC) return;
        setCheckpointError(null);
        try {
            const res = await window.checkpointIPC.list({ threadId: activeThreadId });
            const sorted = [...(res.bundles || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setCheckpointBundles(sorted);
        } catch (err: any) {
            setCheckpointError(err?.message || 'Failed to load checkpoints');
        }
    }, [threadId]);

    useEffect(() => {
        void refreshBundles();
    }, [refreshBundles]);

    const { wsPort, apiPort } = useProjectSession();

    const startStream = useCallback((request: Types.AgentStreamRequest) => {
        const streamId = request.streamId || crypto.randomUUID();
        request.streamId = streamId;
        if (!request.clientSentAt) request.clientSentAt = Date.now();

        const onStreamChunk = (_event: any, data: Types.AgentStreamChunk) => {
            const state = useChatStore.getState();
            if (data.threadId) {
                const currentParam = state.streamingParams[data.threadId] || {
                    accumulatedContent: '',
                    blocks: [],
                    toolCalls: [],
                    currentMessage: '',
                    isStreaming: true,
                    currentNode: undefined,
                    tokensReceived: 0,
                    startTime: null,
                    currentInterrupt: undefined
                };
                const delta = data.chunk || '';
                const deltaReasoning = data.reasoning || '';
                const nextContent = (currentParam.accumulatedContent || '') + delta;

                let nextBlocks = currentParam.blocks ? [...currentParam.blocks] : [];
                const currentToolCalls = currentParam.toolCalls || [];

                if (data.toolCalls && data.toolCalls.length > 0) {
                    const existingIds = new Set(currentToolCalls.map((tc: any) => tc.id));
                    for (const tc of data.toolCalls) {
                        if (!existingIds.has(tc.id)) {
                            nextBlocks.push({ type: 'tool', toolId: tc.id });
                        }
                    }
                }

                if (delta) {
                    const lastBlock = nextBlocks[nextBlocks.length - 1];
                    if (lastBlock && lastBlock.type === 'text') {
                        lastBlock.content += delta;
                    } else {
                        nextBlocks.push({ type: 'text', content: delta });
                    }
                }

                if (deltaReasoning) {
                    const lastBlock = nextBlocks[nextBlocks.length - 1];
                    if (lastBlock && lastBlock.type === 'reasoning') {
                        lastBlock.content += deltaReasoning;
                    } else {
                        nextBlocks.push({ type: 'reasoning', content: deltaReasoning });
                    }
                }

                state.updateStreamingContent(
                    data.threadId,
                    nextContent,
                    undefined,
                    data.toolCalls || currentToolCalls,
                    nextBlocks,
                    data.usage
                );
            }
        };

        const cleanup = () => {
            removeChunkListener();
            removeEndListener();
            removeErrorListener();
        };

        const onStreamEnd = (_event: any, data: { threadId: string; streamId: string }) => {
            const state = useChatStore.getState();
            const threadStream = state.streamingParams[data.threadId];

            if (threadStream) {
                const finalContent = threadStream.accumulatedContent;
                const finalToolCalls = threadStream.toolCalls;
                const finalBlocks = threadStream.blocks;

                const assistantId = streamMessageIdsRef.current.get(data.streamId)?.assistantId || crypto.randomUUID();
                const assistantMessage: ChatMessage = {
                    id: assistantId,
                    role: 'assistant',
                    content: finalContent,
                    toolCalls: finalToolCalls,
                    blocks: finalBlocks,
                    usage: threadStream.usage,
                    timestamp: new Date(),
                    metadata: { threadId: data.threadId }
                };

                if (state.threadId === data.threadId) {
                    addMessage(assistantMessage);
                }

                resetStreaming(data.threadId);
            }

            streamMessageIdsRef.current.delete(data.streamId);
            cleanup();
        };

        const onStreamError = (_event: any, data: { error: string; threadId?: string; streamId?: string }) => {
            console.error("Stream error:", data.error);
            const state = useChatStore.getState();

            if (state.threadId === data.threadId) {
                const threadStream = data.threadId ? state.streamingParams[data.threadId] : undefined;
                if (threadStream) {
                    const finalContent = threadStream.accumulatedContent;
                    const finalToolCalls = threadStream.toolCalls;
                    const finalBlocks = threadStream.blocks;
                    const hasRenderableContent = Boolean(
                        (finalContent && finalContent.trim().length > 0) ||
                        (finalBlocks && finalBlocks.length > 0) ||
                        (finalToolCalls && finalToolCalls.length > 0)
                    );

                    if (hasRenderableContent) {
                        const assistantId = data.streamId
                            ? streamMessageIdsRef.current.get(data.streamId)?.assistantId || crypto.randomUUID()
                            : crypto.randomUUID();
                        const assistantMessage: ChatMessage = {
                            id: assistantId,
                            role: 'assistant',
                            content: finalContent,
                            toolCalls: finalToolCalls,
                            blocks: finalBlocks,
                            usage: threadStream.usage,
                            timestamp: new Date(),
                            metadata: { threadId: data.threadId }
                        };
                        addMessage(assistantMessage);
                        if (data.threadId && apiPort) {
                            void ChatService.postMessage(data.threadId, {
                                id: assistantId,
                                role: 'assistant',
                                content: finalContent,
                                toolCalls: finalToolCalls,
                                blocks: finalBlocks,
                                usage: threadStream.usage,
                                timestamp: Date.now(),
                                metadata: { threadId: data.threadId }
                            });
                        }
                    }
                }

                const presentation = getStreamErrorPresentation(data.error || 'Stream failed');
                const errorId = crypto.randomUUID();
                const errorMessage: ChatMessage = {
                    id: errorId,
                    role: 'system',
                    content: presentation.content,
                    actions: presentation.actions,
                    blocks: [{ type: 'text', content: presentation.content }],
                    timestamp: new Date(),
                    metadata: { threadId: data.threadId }
                };
                addMessage(errorMessage);
                if (data.threadId && apiPort) {
                    void ChatService.postMessage(data.threadId, {
                        id: errorId,
                        role: 'system',
                        content: presentation.content,
                        actions: presentation.actions,
                        blocks: [{ type: 'text', content: presentation.content }],
                        timestamp: Date.now(),
                        metadata: { threadId: data.threadId }
                    });
                }
            }

            if (data.threadId) {
                resetStreaming(data.threadId);
            }

            if (data.streamId) {
                streamMessageIdsRef.current.delete(data.streamId);
            }
            cleanup();
        };

        const removeChunkListener = window.electron.ipcRenderer.on(Channels.agentStreamChannel(streamId), onStreamChunk);
        const removeEndListener = window.electron.ipcRenderer.on(Channels.agentStreamEndChannel(streamId), onStreamEnd);
        const removeErrorListener = window.electron.ipcRenderer.on(Channels.agentStreamErrorChannel(streamId), onStreamError);

        window.electron.ipcRenderer.send(Channels.AGENT_STREAM, request);
    }, [streamMessageIdsRef, resetStreaming, addMessage, apiPort]);


    const handleSendMessage = useCallback(async (content: string) => {
        if (!content.trim() || activeStreaming.isStreaming) return;

        const isFirstMessage = messages.length === 0;
        const userMessageId = crypto.randomUUID();
        const assistantMessageId = crypto.randomUUID();
        const userMessage: ChatMessage = {
            id: userMessageId,
            role: 'user',
            content: content,
            timestamp: new Date()
        };

        addMessage(userMessage);

        // Ensure we have a thread id for persistence and agent
        let sid = threadId;
        if (!sid) {
            sid = crypto.randomUUID();
            setThreadId(sid);
        }

        if (isFirstMessage && activeProjectId && window.checkpointIPC) {
            try {
                await window.checkpointIPC.create({
                    threadId: sid,
                    projectId: activeProjectId,
                    includeInstances: 'all',
                    activeInstanceId: instanceId,
                    openInstanceIds,
                    reason: 'auto',
                    label: 'Initial checkpoint'
                });
                await refreshBundles(sid);
            } catch (err) {
                console.error("Failed to create initial checkpoint:", err);
            }
        }

        if (!isFirstMessage && activeProjectId && window.checkpointIPC) {
            try {
                await window.checkpointIPC.create({
                    threadId: sid,
                    projectId: activeProjectId,
                    includeInstances: 'all',
                    activeInstanceId: instanceId,
                    openInstanceIds,
                    reason: 'auto',
                    label: 'Auto-save before turn'
                });
                await refreshBundles(sid);
            } catch (err) {
                console.error("Failed to auto-create checkpoint:", err);
            }
        }

        // Note: We used to explicitly persist the user message here via ChatService.postMessage.
        // That is now removed because the backend Agent automatically persists the input message
        // when processing AGENT_STREAM. Keeping addMessage above ensures immediate UI feedback (Optimistic Update).

        const request: Types.AgentStreamRequest = {
            message: userMessage.content,
            threadId: sid || undefined,
            wsPort: wsPort || undefined,
            apiPort: apiPort || undefined,
            clientMessageId: userMessageId,
            clientAssistantMessageId: assistantMessageId
        };

        setStreaming(sid, true);
        const streamId = request.streamId || crypto.randomUUID();
        request.streamId = streamId;
        streamMessageIdsRef.current.set(streamId, { assistantId: assistantMessageId });
        startStream(request);
    }, [messages.length, activeProjectId, instanceId, openInstanceIds, threadId, window.checkpointIPC, wsPort, apiPort, setThreadId, refreshBundles, setStreaming, startStream, activeStreaming.isStreaming]);

    const handleSystemAction = useCallback((input: string) => {
        void handleSendMessage(input);
    }, [handleSendMessage]);

    const handleCancelMessage = useCallback(async () => {
        if (!threadId) return;
        // Mark as no longer streaming immediately to stop the typing indicator,
        // but keep the content in streamingParams so it can be moved to history
        // by the final onStreamEnd signal.
        setStreaming(threadId, false);
        try {
            await window.electron.ipcRenderer.invoke(Channels.AGENT_ABORT, threadId);
        } catch (e) {
            console.error("Failed to abort stream:", e);
            // Fallback: if abort failed, we still need to clear state
            resetStreaming(threadId);
        }
    }, [threadId, setStreaming, resetStreaming]);

    const handleResume = useCallback(async (decision: any) => {
        console.log("Resuming with decision:", decision);
        const message = `[Resumed with decision: ${JSON.stringify(decision)}]`;
        const userMessageId = crypto.randomUUID();
        const assistantMessageId = crypto.randomUUID();
        const userMessage: ChatMessage = {
            id: userMessageId,
            role: 'user',
            content: message,
            timestamp: new Date()
        };
        addMessage(userMessage);

        // Ensure threadId exists
        let sid = threadId;
        if (!sid) {
            sid = crypto.randomUUID();
            setThreadId(sid);
        }

        if (activeProjectId && window.checkpointIPC) {
            try {
                await window.checkpointIPC.create({
                    threadId: sid,
                    projectId: activeProjectId,
                    includeInstances: 'all',
                    activeInstanceId: instanceId,
                    openInstanceIds,
                    reason: 'auto',
                    label: 'Auto-save before turn'
                });
                await refreshBundles(sid);
            } catch (err) {
                console.error("Failed to auto-create checkpoint:", err);
            }
        }

        // Note: Persistence is handled by backend Agent

        setStreaming(sid, true);
        const streamId = crypto.randomUUID();
        streamMessageIdsRef.current.set(streamId, { assistantId: assistantMessageId });
        startStream({
            message: message,
            threadId: sid,
            streamId,
            wsPort: wsPort || undefined,
            apiPort: apiPort || undefined,
            clientMessageId: userMessageId,
            clientAssistantMessageId: assistantMessageId
        });
    }, [threadId, activeProjectId, instanceId, openInstanceIds, wsPort, apiPort, startStream]);

    const handleRestoreCheckpoint = useCallback(async (bundleId: string, restoreContent?: string) => {
        if (!threadId || !window.checkpointIPC) return;
        setCheckpointBusy(true);
        setCheckpointError(null);
        try {
            await window.checkpointIPC.restore({
                threadId,
                bundleId,
                createAutoCheckpoint: true,
                reason: 'restore'
            });

            const history = await ChatService.getMessages(threadId);
            setMessages(history as any);
            resetStreaming(threadId);

            if (restoreContent) {
                setDraftInput(restoreContent);
            }

            await refreshBundles();
        } catch (err: any) {
            const message = err?.message || 'Failed to restore checkpoint';
            setCheckpointError(message);
            addMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: `Error: ${message}`,
                timestamp: new Date()
            });
        } finally {
            setCheckpointBusy(false);
        }
    }, [threadId, window.checkpointIPC, resetStreaming, setMessages, setDraftInput, refreshBundles, setCheckpointBusy, setCheckpointError, addMessage]);

    const historyTodos = useMemo(() => {
        // Check message history in reverse
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const tools = msg.toolCalls || [];
            // Check tools in reverse to get latest update
            for (let j = tools.length - 1; j >= 0; j--) {
                if (tools[j].name === 'write_todos') {
                    const todos = (tools[j].args as any)?.todos;
                    if (todos) return todos as any[];
                }
            }
        }
        return [];
    }, [messages]);

    const activeTodos = useMemo(() => {
        // Check active stream first (find last instance)
        const activeTools = activeStreaming.toolCalls || [];
        for (let i = activeTools.length - 1; i >= 0; i--) {
            if (activeTools[i].name === 'write_todos') {
                const todos = (activeTools[i].args as any)?.todos;
                if (todos) return todos as any[];
            }
        }
        return historyTodos;
    }, [activeStreaming.toolCalls, historyTodos]);

    return (
        <div className="flex flex-col h-full bg-surface-50">
            {/* Subagent Task Pane (overlays the main content) */}
            {activeSubagentTask ? (
                <SubagentStreamPane
                    toolCallId={activeSubagentTask.toolCallId}
                    tool={activeSubagentTask.tool}
                    onBack={handleCloseSubagentTask}
                />
            ) : (
                <>
                    {/* Messages Area - responsive padding */}
                    <div className="flex-1 overflow-y-auto min-w-0">
                        <div className="max-w-4xl mx-auto w-full p-3 sm:p-4 md:p-6">
                            <MessageList
                                messages={messages}
                                checkpointBundles={checkpointBundles}
                                checkpointBusy={checkpointBusy || activeStreaming.isStreaming}
                                onRestoreCheckpoint={handleRestoreCheckpoint}
                                onSystemAction={handleSystemAction}
                                onOpenSubagentTask={handleOpenSubagentTask}
                            />

                            {/* Active Agent Stream */}
                            <div className="mt-4">
                                <AgentStream
                                    isStreaming={activeStreaming.isStreaming}
                                    currentNode={activeStreaming.currentNode}
                                    interrupt={activeStreaming.currentInterrupt}
                                    toolCalls={activeStreaming.toolCalls}
                                    blocks={activeStreaming.blocks}
                                    onResume={handleResume}
                                    onOpenSubagentTask={handleOpenSubagentTask}
                                />
                            </div>

                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    {/* Active Todos Display */}
                    <div className="max-w-4xl mx-auto w-full px-4">
                        <TodoCard todos={activeTodos} />
                    </div>

                    {/* Input Area - MessageInput Component */}
                    <div className="w-full max-w-4xl mx-auto px-4 pb-6 pt-2">
                        <MessageInput
                            onSendMessage={handleSendMessage}
                            onCancelMessage={handleCancelMessage}
                            disabled={activeStreaming.isStreaming}
                        />
                    </div>
                </>
            )}
        </div>
    );
};
