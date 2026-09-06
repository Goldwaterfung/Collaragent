import { useState, useCallback } from 'react'
import { TitleBar } from './components/Layout/TitleBar'
import { ProgressBar } from './components/Layout/ProgressBar'
import { Workspace } from './components/Workspace/Workspace'
import { Divider } from './components/Utilities/Divider'
import { SettingsModal } from './components/Settings/SettingsModal'
import { InstanceManager } from './components/Management/InstanceManager'
import { useProjectSession } from '@workspace/contexts/project/ProjectSession'
import { InstanceProvider } from '@workspace/contexts/instance/InstanceContext'
import { SkillsProvider, useSkillsContext } from '@workspace/contexts/skills/SkillsContext'
import { WelcomeScreen } from './components/Welcome/WelcomeScreen'
import { SkillsPanel } from './components/Workspace/SkillsPanel'
import { useUiStore } from './store/uiStore'

function AppContent(): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const { isSettingsOpen, closeSettings } = useUiStore()
  const { hasSession } = useProjectSession()
  const { setActiveSkillPath } = useSkillsContext()

  const handleSidebarResize = useCallback((clientX: number) => {
    const newWidth = Math.max(150, Math.min(clientX, 500))
    setSidebarWidth(newWidth)
  }, [])

  return (
    <div className="flex flex-col w-screen h-screen bg-surface-50 text-black font-sans antialiased overflow-hidden relative">
      <TitleBar />
      <ProgressBar />

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative w-full">
        {hasSession ? (
          <>
            {/* Left Sidebar */}
            <div
              style={{ width: sidebarWidth }}
              className="shrink-0 flex flex-col h-full border-r border-surface-200"
            >
              <div className="flex-1 overflow-hidden relative">
                <InstanceManager onSelect={() => setActiveSkillPath(null)} />
              </div>
              <div className="shrink-0 border-t border-surface-200 bg-surface-50">
                <SkillsPanel />
              </div>
            </div>

            <Divider onResize={handleSidebarResize} />

            {/* Content Region: Workspace (unified Dockview) */}
            <div className="flex-1 h-full min-w-0 bg-surface-50">
              <Workspace />
            </div>
          </>
        ) : (
          /* Welcome Screen fills full window and centers horizontally and vertically */
          <div className="flex-1 h-full w-full min-w-0 bg-surface-50 flex items-center justify-center overflow-hidden">
            <WelcomeScreen />
          </div>
        )}
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <InstanceProvider>
      <SkillsProvider>
        <AppContent />
      </SkillsProvider>
    </InstanceProvider>
  )
}

export default App
