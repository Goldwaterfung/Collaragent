import { useState, useCallback } from 'react';
import { TitleBar } from './components/Layout/TitleBar';
import { ProgressBar } from './components/Layout/ProgressBar';
import { Workspace } from './components/Workspace/Workspace';
import { ChatContainer } from './components/Chat/ChatContainer';
import { Divider } from './components/Utilities/Divider';
import { SettingsModal } from './components/Settings/SettingsModal';
import { InstanceManager } from './components/Management/InstanceManager';
import { useProjectSession } from '@workspace/contexts/project/ProjectSession';
import { InstanceProvider } from '@workspace/contexts/instance/InstanceContext';
import { SkillsProvider, useSkillsContext } from '@workspace/contexts/skills/SkillsContext';
import { WelcomeScreen } from './components/Welcome/WelcomeScreen';
import { SkillsPanel } from './components/Workspace/SkillsPanel';

function AppContent(): React.JSX.Element {
  const [chatWidth, setChatWidth] = useState(400);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { hasSession } = useProjectSession();
  const { setActiveSkillPath } = useSkillsContext();

  const handleChatResize = useCallback((clientX: number) => {
    const newWidth = window.innerWidth - clientX;
    const clampedWidth = Math.max(300, Math.min(newWidth, Math.min(800, window.innerWidth * 0.6)));
    setChatWidth(clampedWidth);
  }, []);

  const handleSidebarResize = useCallback((clientX: number) => {
    const newWidth = Math.max(150, Math.min(clientX, 500));
    setSidebarWidth(newWidth);
  }, []);

  return (
    <div className="flex flex-col w-screen h-screen bg-surface-50 text-black font-sans antialiased overflow-hidden relative">
      <TitleBar />
      <ProgressBar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-row overflow-hidden relative w-full h-full">
        {/* Left Sidebar */}
        <div style={{ width: sidebarWidth }} className="shrink-0 flex flex-col h-full border-r border-surface-200">
          <div className="flex-1 overflow-hidden relative">
            <InstanceManager onSelect={() => setActiveSkillPath(null)} />
          </div>
          <div className="shrink-0 border-t border-surface-200 bg-surface-50">
            <SkillsPanel />
          </div>
        </div>

        <Divider onResize={handleSidebarResize} />

        {/* Middle: Content (Workspace) */}
        <div className="flex-1 h-full min-w-0 bg-surface-50">
          {hasSession ? <Workspace /> : <WelcomeScreen />}
        </div>

        {/* Draggable Divider for Chat */}
        <Divider onResize={handleChatResize} />

        {/* Right Side: Chat & Settings */}
        <div
          style={{ width: chatWidth }}
          className="h-full shrink-0 border-l border-surface-200 bg-surface-50"
        >
          <ChatContainer onOpenSettings={() => setIsSettingsOpen(true)} />
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

function App(): React.JSX.Element {
  return (
    <InstanceProvider>
      <SkillsProvider>
        <AppContent />
      </SkillsProvider>
    </InstanceProvider>
  );
}

export default App;
