import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps, DockviewApi } from 'dockview-react'
import { useEffect, useState, useRef } from 'react'
import { Canvas } from '@workspace/canvas/components/Canvas'
import Cards from '@workspace/editor/components/CardEditor'
import { SkillEditor } from '@workspace/editor/components/SkillEditor'
import '@workspace/editor/style/style.css'
import { useInstanceContext, InstanceScope } from '@workspace/contexts/instance/InstanceContext'
import { useSkillsContext } from '@workspace/contexts/skills/SkillsContext'
import { CanvasProvider } from '@workspace/canvas/store'
import { ChatContainer } from '../Chat/ChatContainer'
import { useChatStore } from '../../store/chatStore'
import {
  isChatPanelId,
  getSessionIdFromPanelId,
  createChatPanelId,
  DEFAULT_CHAT_TITLE,
  CHAT_COMPONENT_NAME,
  saveDockviewLayout,
  loadDockviewLayout,
  COLLAR_OPEN_CHAT_TAB_EVENT,
  COLLAR_TOGGLE_CHAT_PANEL_EVENT,
  type OpenChatTabDetail
} from './layoutPersistence'

const CanvasComponent = (props: IDockviewPanelProps) => {
  // Determine instance ID from panel ID
  const instanceId = props.api.id

  return (
    <InstanceScope instanceId={instanceId}>
      <CanvasProvider>
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Canvas />
        </div>
      </CanvasProvider>
    </InstanceScope>
  )
}

const DocumentComponent = (props: IDockviewPanelProps) => {
  const instanceId = props.api.id
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <Cards instanceId={instanceId} />
    </div>
  )
}

const SkillComponent = (props: IDockviewPanelProps) => {
  const skillMdPath = props.api.id
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff'
      }}
    >
      <SkillEditor skillMdPath={skillMdPath} />
    </div>
  )
}

const ChatComponent = (props: IDockviewPanelProps) => {
  const sessionId = getSessionIdFromPanelId(props.api.id)
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <ChatContainer sessionId={sessionId} dockviewPanelApi={props.api} />
    </div>
  )
}

const components = {
  canvas: CanvasComponent,
  document: DocumentComponent,
  skill: SkillComponent,
  chat: ChatComponent
}

export const Workspace = (props: { theme?: string }) => {
  const {
    instanceId,
    setInstanceId,
    unsetInstanceId,
    instanceIds,
    openInstanceIds,
    instanceSummaries,
    isLoaded,
    setOpenInstanceIds
  } = useInstanceContext()
  const { skills, activeSkillPath, setActiveSkillPath } = useSkillsContext()
  const [api, setApi] = useState<DockviewApi | null>(null)
  const layoutDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastChatWidthRef = useRef<number>(400)
  const paramsRef = useRef({
    instanceId,
    instanceIds,
    openInstanceIds,
    instanceSummaries,
    skills,
    activeSkillPath,
    setActiveSkillPath,
    setInstanceId,
    unsetInstanceId,
    setOpenInstanceIds
  })

  // Keep ref updated for event handlers/callbacks that might be stale
  paramsRef.current = {
    instanceId,
    instanceIds,
    openInstanceIds,
    instanceSummaries,
    skills,
    activeSkillPath,
    setActiveSkillPath,
    setInstanceId,
    unsetInstanceId,
    setOpenInstanceIds
  }

  const isSkillId = (id: string) =>
    paramsRef.current.skills.some((s) => s.skillMdPath === id) || id.endsWith('SKILL.md')

  // Helper to look up instance type from summaries or skills
  const getInstanceType = (id: string): 'canvas' | 'document' | 'skill' => {
    if (isSkillId(id)) return 'skill'
    const summary = paramsRef.current.instanceSummaries.find((s) => s.instanceId === id)
    return summary?.type === 'canvas' ? 'canvas' : 'document'
  }

  const getInstanceName = (id: string): string => {
    const skill = paramsRef.current.skills.find((s) => s.skillMdPath === id)
    if (skill) return skill.name

    const summary = paramsRef.current.instanceSummaries.find((s) => s.instanceId === id)
    return summary?.name || id
  }

  const onReady = (event: DockviewReadyEvent) => {
    setApi(event.api)

    const updateOpenPanels = () => {
      const panelIds = event.api.panels
        .filter((panel) => !isChatPanelId(panel.id))
        .map((panel) => panel.id)
      paramsRef.current.setOpenInstanceIds(panelIds)
    }

    // Try restoring layout from localStorage
    const savedLayout = loadDockviewLayout()
    let isRestored = false
    if (savedLayout) {
      try {
        event.api.fromJSON(savedLayout)
        isRestored = true
      } catch (err: unknown) {
        console.warn('Failed to restore saved Dockview layout:', err)
      }
    }

    if (!isRestored) {
      // Default layout: Content on left, Chat on right
      const currentId = paramsRef.current.instanceId || paramsRef.current.activeSkillPath
      if (currentId && isLoaded) {
        const instanceType = getInstanceType(currentId)
        event.api.addPanel({
          id: currentId,
          component: instanceType,
          title: getInstanceName(currentId),
          renderer: 'always'
        })
      }

      const initialSessionId = useChatStore.getState().threadId || crypto.randomUUID()
      event.api.addPanel({
        id: createChatPanelId(initialSessionId),
        component: CHAT_COMPONENT_NAME,
        title: DEFAULT_CHAT_TITLE,
        renderer: 'always',
        position: { direction: 'right' },
        initialWidth: 400,
        minimumWidth: 300
      })
    }

    // Sync active panel change back to context
    event.api.onDidActivePanelChange((e) => {
      const panelId = e?.panel?.id
      if (panelId) {
        if (isChatPanelId(panelId)) {
          const sid = getSessionIdFromPanelId(panelId)
          useChatStore.getState().setThreadId(sid)
          // Do not unset or overwrite instanceId or activeSkillPath!
        } else if (isSkillId(panelId)) {
          if (panelId !== paramsRef.current.activeSkillPath) {
            paramsRef.current.setActiveSkillPath(panelId)
          }
          paramsRef.current.unsetInstanceId()
        } else {
          if (panelId !== paramsRef.current.instanceId) {
            paramsRef.current.setInstanceId(panelId)
          }
          paramsRef.current.setActiveSkillPath(null)
        }
      } else {
        paramsRef.current.unsetInstanceId()
        paramsRef.current.setActiveSkillPath(null)
      }
      updateOpenPanels()
    })

    event.api.onDidAddPanel(() => {
      updateOpenPanels()
    })

    event.api.onDidRemovePanel((panel) => {
      const removedId = panel.api.id
      updateOpenPanels()

      if (isChatPanelId(removedId)) {
        return
      }

      if (
        paramsRef.current.instanceId === removedId ||
        paramsRef.current.activeSkillPath === removedId
      ) {
        const remainingIds = event.api.panels
          .filter((item) => !isChatPanelId(item.id))
          .map((item) => item.id)
        if (remainingIds.length > 0) {
          if (isSkillId(remainingIds[0])) {
            paramsRef.current.setActiveSkillPath(remainingIds[0])
            paramsRef.current.unsetInstanceId()
          } else {
            paramsRef.current.setInstanceId(remainingIds[0])
            paramsRef.current.setActiveSkillPath(null)
          }
        } else {
          paramsRef.current.unsetInstanceId()
          paramsRef.current.setActiveSkillPath(null)
        }
      }
    })

    event.api.onDidLayoutChange(() => {
      const chatPanel = event.api.panels.find((p) => isChatPanelId(p.id))
      if (chatPanel && chatPanel.api.width > 0) {
        lastChatWidthRef.current = chatPanel.api.width
      }
      if (layoutDebounceRef.current) {
        clearTimeout(layoutDebounceRef.current)
      }
      layoutDebounceRef.current = setTimeout(() => {
        saveDockviewLayout(event.api)
      }, 300)
    })

    updateOpenPanels()
  }

  // Listen for window-level chat events (open new/existing tab, toggle chat panel)
  useEffect(() => {
    if (!api) return

    const handleOpenChatTab = (event: Event) => {
      const customEvent = event as CustomEvent<OpenChatTabDetail>
      const targetSessionId = customEvent.detail?.sessionId
      if (!targetSessionId) return

      const panelId = createChatPanelId(targetSessionId)
      const existingPanel = api.getPanel(panelId)
      if (existingPanel) {
        existingPanel.api.setActive()
        return
      }

      const chatPanels = api.panels.filter((p) => isChatPanelId(p.id))
      const referencePanel = chatPanels.length > 0 ? chatPanels[0] : undefined

      api.addPanel({
        id: panelId,
        component: CHAT_COMPONENT_NAME,
        title: customEvent.detail?.title || DEFAULT_CHAT_TITLE,
        renderer: 'always',
        position: referencePanel ? { referencePanel, direction: 'within' } : { direction: 'right' },
        ...(referencePanel ? {} : { initialWidth: lastChatWidthRef.current || 400 })
      })
    }

    const handleToggleChatPanel = () => {
      const chatPanels = api.panels.filter((p) => isChatPanelId(p.id))
      if (chatPanels.length > 0) {
        const activePanel = api.activePanel
        if (activePanel && isChatPanelId(activePanel.id)) {
          // Toggle focus to first non-chat panel if already in chat
          const contentPanels = api.panels.filter((p) => !isChatPanelId(p.id))
          if (contentPanels.length > 0) {
            contentPanels[0].api.setActive()
            return
          }
        }
        chatPanels[0].api.setActive()
      } else {
        const targetId = useChatStore.getState().threadId || crypto.randomUUID()
        api.addPanel({
          id: createChatPanelId(targetId),
          component: CHAT_COMPONENT_NAME,
          title: DEFAULT_CHAT_TITLE,
          renderer: 'always',
          position: { direction: 'right' },
          initialWidth: lastChatWidthRef.current || 400
        })
      }
    }

    window.addEventListener(COLLAR_OPEN_CHAT_TAB_EVENT, handleOpenChatTab)
    window.addEventListener(COLLAR_TOGGLE_CHAT_PANEL_EVENT, handleToggleChatPanel)

    return () => {
      window.removeEventListener(COLLAR_OPEN_CHAT_TAB_EVENT, handleOpenChatTab)
      window.removeEventListener(COLLAR_TOGGLE_CHAT_PANEL_EVENT, handleToggleChatPanel)
      if (layoutDebounceRef.current) {
        clearTimeout(layoutDebounceRef.current)
      }
    }
  }, [api])

  // Unified Sync Effect: Context -> Dockview (Open/Activate/Close)
  useEffect(() => {
    if (!api || !isLoaded) return

    const nextOpenInstanceIds = openInstanceIds.filter(
      (id) =>
        instanceIds.includes(id) ||
        skills.some((s) => s.skillMdPath === id) ||
        id.endsWith('SKILL.md')
    )

    if (nextOpenInstanceIds.length !== openInstanceIds.length) {
      setOpenInstanceIds(nextOpenInstanceIds)
      return
    }

    if (instanceId && !openInstanceIds.includes(instanceId)) {
      setOpenInstanceIds([...openInstanceIds, instanceId])
      return
    }

    if (activeSkillPath && !openInstanceIds.includes(activeSkillPath)) {
      setOpenInstanceIds([...openInstanceIds, activeSkillPath])
      return
    }

    const panels = api.panels
    const openSet = new Set(openInstanceIds)

    openInstanceIds.forEach((id) => {
      if (!api.getPanel(id)) {
        const instanceType = getInstanceType(id)
        const contentPanels = api.panels.filter((p) => !isChatPanelId(p.id))
        const chatPanels = api.panels.filter((p) => isChatPanelId(p.id))
        const position =
          contentPanels.length > 0
            ? { referencePanel: contentPanels[0], direction: 'within' as const }
            : chatPanels.length > 0
              ? { referencePanel: chatPanels[0], direction: 'left' as const }
              : undefined

        api.addPanel({
          id,
          component: instanceType,
          title: getInstanceName(id),
          renderer: 'always',
          ...(position ? { position } : {})
        })
      }
    })

    panels.forEach((panel) => {
      if (!isChatPanelId(panel.id) && !openSet.has(panel.id)) {
        panel.api.close()
      }
    })

    const activeTarget = activeSkillPath || instanceId
    if (activeTarget) {
      const panel = api.getPanel(activeTarget)
      if (panel && activePanelId(api) !== activeTarget) {
        panel.api.setActive()
      }
    }
  }, [
    api,
    instanceId,
    activeSkillPath,
    instanceIds,
    openInstanceIds,
    isLoaded,
    instanceSummaries,
    skills,
    setOpenInstanceIds
  ])

  const activePanelId = (dockApi: DockviewApi) => {
    return dockApi.activePanel?.id
  }

  return (
    <div className="w-full h-full dockview-container">
      <DockviewReact
        className={`${props.theme || 'dockview-theme-custom'}`}
        onReady={onReady}
        components={components}
        disableFloatingGroups={true}
      />
    </div>
  )
}
