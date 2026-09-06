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
import type { IDockviewPanelProps } from 'dockview-react'
import { emitOpenChatTab } from '../Workspace/layoutPersistence'
import { useUiStore } from '../../store/uiStore'

export interface ChatContainerProps {
  sessionId?: string
  dockviewPanelApi?: IDockviewPanelProps['api']
  onOpenSettings?: () => void
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  sessionId,
  dockviewPanelApi,
  onOpenSettings
}) => {
  const [showHistory, setShowHistory] = useState(false)
  const { threadId, setThreadId } = useChatStore()
  const { hasSession, apiPort } = useProjectSession()

  const activeSessionId = sessionId || threadId

  const handleSelectSession = useCallback((selectedSessionId: string) => {
    setShowHistory(false)
    emitOpenChatTab(selectedSessionId)
  }, [])

  const handleNewChat = useCallback(() => {
    const newSessionId = crypto.randomUUID()
    emitOpenChatTab(newSessionId)
  }, [])

  const handleOpenSettings = useCallback(() => {
    if (onOpenSettings) {
      onOpenSettings()
    } else {
      useUiStore.getState().openSettings()
    }
  }, [onOpenSettings])

  useEffect(() => {
    if (!dockviewPanelApi || !activeSessionId) return
    let isMounted = true

    ChatService.getSessions()
      .then((sessions) => {
        if (!isMounted) return
        const found = sessions.find((s) => s.id === activeSessionId)
        if (found?.title) {
          dockviewPanelApi.setTitle(found.title)
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          console.warn('Failed to resolve chat session title:', error)
        }
      })

    return () => {
      isMounted = false
    }
  }, [dockviewPanelApi, activeSessionId])

  useEffect(() => {
    let isMounted = true

    if (hasSession && apiPort && !activeSessionId) {
      ChatService.getSessions()
        .then(async (sessions) => {
          if (!isMounted) return
          if (sessions.length > 0) {
            setThreadId(sessions[0].id)
          } else {
            setThreadId(crypto.randomUUID())
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
  }, [hasSession, apiPort, activeSessionId, setThreadId])

  return (
    <div className="flex flex-col h-full w-full relative bg-surface-50">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-200 bg-surface-50/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded-md transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${showHistory ? 'bg-primary/20 text-primary' : 'hover:bg-surface-200 text-black/60 hover:text-black'}`}
          >
            <HistoryIcon />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleNewChat}
            className="p-1.5 rounded-md hover:bg-surface-200 text-black/60 hover:text-black transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            onClick={handleOpenSettings}
            className="p-1.5 rounded-md hover:bg-surface-200 text-black/60 hover:text-black transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* Chat Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative w-full h-full min-w-0">
        <div className="flex-1 h-full w-full overflow-hidden flex flex-col min-w-0">
          <Chat sessionId={activeSessionId} />
        </div>

        {showHistory && (
          <div className="absolute left-0 top-0 h-full z-40 shadow-lg">
            <ChatHistory onSelectSession={handleSelectSession} currentSessionId={activeSessionId} />
          </div>
        )}
      </div>
    </div>
  )
}
