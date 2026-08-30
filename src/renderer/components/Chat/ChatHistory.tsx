import React, { useEffect, useState } from 'react';
import { ChatSession } from '@shared/ipc/history/types';
import * as ChatService from '@shared/services/ChatService';

interface ChatHistoryProps {
    onSelectSession: (sessionId: string) => void;
    currentSessionId?: string;
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({ onSelectSession, currentSessionId }) => {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [loading, setLoading] = useState(true);

    const loadSessions = async () => {
        setLoading(true);
        try {
            const data = await ChatService.getSessions();
            setSessions(data as any);
        } catch (error) {
            console.error("Failed to load sessions:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSessions();
    }, []);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm("Are you sure you want to delete this chat?")) {
            const success = await ChatService.deleteSession(id);
            if (success) setSessions(sessions.filter(s => s.id !== id));
        }
    };

    return (
        <div className="flex flex-col h-full bg-surface-50 border-r border-surface-200 w-64">
            <div className="p-4 border-b border-surface-200 flex justify-between items-center">
                <h3 className="font-semibold text-sm">History</h3>
                <button
                    onClick={loadSessions}
                    className="p-1 hover:bg-surface-200 rounded text-black/50 hover:text-black transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
                {loading ? (
                    <div className="p-4 text-center text-xs text-black/40">Loading...</div>
                ) : sessions.length === 0 ? (
                    <div className="p-4 text-center text-xs text-black/40">No recent chats</div>
                ) : (
                    sessions.map(session => (
                        <div
                            key={session.id}
                            onClick={() => onSelectSession(session.id)}
                            className={`
                                group px-4 py-3 cursor-pointer transition-colors relative
                                ${currentSessionId === session.id ? 'bg-primary/10 border-r-2 border-primary' : 'hover:bg-surface-100'}
                            `}
                        >
                            <div className="text-sm font-medium truncate pr-6">
                                {session.title || `Chat ${session.id.substring(0, 8)}`}
                            </div>
                            <div className="text-[10px] text-black/40 mt-1 flex justify-between">
                                <span>{session.messageCount} messages</span>
                                <span>{new Date(session.lastMessageAt).toLocaleDateString()}</span>
                            </div>

                            <button
                                onClick={(e) => handleDelete(e, session.id)}
                                className="absolute right-2 top-3 p-1 opacity-0 group-hover:opacity-100 hover:bg-surface-200 rounded text-black/40 hover:text-red-500 transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
