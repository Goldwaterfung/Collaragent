import { useProjectSession } from '@workspace/contexts/project/ProjectSession'
import { useEffect, useState } from 'react'
import { ChatIcon } from '../../assets/icons/ChatIcon'
import { emitToggleChatPanel } from '../Workspace/layoutPersistence'

export function TitleBar(): React.JSX.Element {
  const { hasSession, filePath } = useProjectSession()
  const [title, setTitle] = useState('COLLAR AGENT')

  useEffect(() => {
    if (hasSession && filePath) {
      // Extract filename from path (cross-platform split)
      const fileName = filePath.split(/[/\\]/).pop()
      setTitle(fileName || 'COLLAR AGENT')
    } else {
      setTitle('COLLAR AGENT')
    }
  }, [hasSession, filePath])

  return (
    <div
      className="h-9 bg-surface-50 flex items-center justify-center border-b border-surface-200 select-none w-full relative z-50 px-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="text-xs text-gray-500 font-medium tracking-wide">{title}</div>

      {hasSession && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          <button
            type="button"
            onClick={emitToggleChatPanel}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="p-1.5 rounded-md hover:bg-surface-200 text-black/60 hover:text-black transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <ChatIcon />
          </button>
        </div>
      )}
    </div>
  )
}
