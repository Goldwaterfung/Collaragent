import { ChatMessage } from "../../agents/types";

export interface ChatSession {
    id: string;
    title?: string;
    lastMessageAt: Date;
    messageCount: number;
}

export interface GetChatMessagesResponse {
    sessionId: string;
    messages: ChatMessage[];
}
