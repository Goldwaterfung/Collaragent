import React, { useCallback, useEffect, useState } from 'react'
import './chat.css'
import { Chat } from './Chat'
import { ChatHistory } from './ChatHistory'
import { useChatStore } from '../../store/chatStore'
import { HistoryIcon } from '../../assets/icons/HistoryIcon'
import { PlusIcon } from '../../assets/icons/PlusIcon'
import { SettingsIcon } from '../../assets/icons/SettingsIcon'
import * as ChatService from '@shared/services/ChatService'
import { useProjectSession } from '@workspace/contexts/project/ProjectSession'
import type { ChatMessage } from '../../types/ui'

export interface ChatContainerProps {
  onOpenSettings: () => void
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ onOpenSettings }) => {
  const [showHistory, setShowHistory] = useState(false)
  const { threadId, setThreadId, setMessages, clearMessages } = useChatStore()
  const { hasSession, apiPort } = useProjectSession()

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      try {
        const history = await ChatService.getMessages(sessionId)
        setMessages(history as unknown as ChatMessage[])
        setThreadId(sessionId)
      } catch (error: unknown) {
        // ChatService will already log missing apiPort. Keep console debug here.
        console.error('Failed to load history:', error)
      }
    },
    [setMessages, setThreadId]
  )

  const handleNewChat = useCallback(() => {
    clearMessages()
    setThreadId(crypto.randomUUID())
  }, [clearMessages, setThreadId])

  useEffect(() => {
    let isMounted = true

    if (hasSession && apiPort && !threadId) {
      ChatService.getSessions()
        .then(async (sessions) => {
          if (!isMounted) return
          if (sessions.length > 0) {
            await handleSelectSession(sessions[0].id)
          } else {
            handleNewChat()
          }
        })
        .catch((error: unknown) => {
          if (isMounted) {
            console.error('Failed to auto-hydrate chat sessions:', error)
          }
        })
    }

    return () => {
      isMounted = false
    }
  }, [hasSession, apiPort, threadId, handleSelectSession, handleNewChat])

  return (
    <div className="flex flex-col h-full w-full relative border-l border-surface-200">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-surface-200 bg-surface-50/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${showHistory ? 'bg-primary/20 text-primary' : 'hover:bg-surface-200 text-black/60 hover:text-black'}`}
            title="History"
          >
            <HistoryIcon />
          </button>
          <h2 className="text-sm font-semibold text-black/70">Chat</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md hover:bg-surface-200 text-black/60 hover:text-black transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            title="New Chat"
          >
            <PlusIcon />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-md hover:bg-surface-200 text-black/60 hover:text-black transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* Chat Content */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 h-full overflow-hidden">
          <Chat />
        </div>

        {showHistory && (
          <div className="absolute left-0 top-0 h-full z-40 shadow-lg">
            <ChatHistory onSelectSession={handleSelectSession} currentSessionId={threadId} />
          </div>
        )}
      </div>
    </div>
  )
}
