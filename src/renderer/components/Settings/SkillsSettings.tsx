import { useState } from 'react'
import type { AppConfig } from '@shared/config/types'

type Props = {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

export function SkillsSettings({ config, onSave }: Props) {
  const [source, setSource] = useState(config.middleware?.skills?.source ?? '')

  const handlePickDirectory = async () => {
    const res = await window.skillsIPC.pickDirectory()
    if (!res.path) return
    setSource(res.path)
    await saveConfig(res.path)
  }

  const handleClearDirectory = async () => {
    setSource('')
    await saveConfig('')
  }

  const saveConfig = async (src: string) => {
    const newConfig = {
      ...config,
      middleware: {
        ...config.middleware,
        skills: { enabled: true, source: src }
      }
    }
    await onSave(newConfig)
  }

  return (
    <div className="p-4 sm:p-5 bg-white rounded-xl sm:rounded-2xl border border-surface-200 shadow-sm transition-all hover:border-primary/20">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-base sm:text-lg">Skills Middleware</h3>
        <p className="text-xs sm:text-sm text-black/50">
          The agent automatically loads built-in skills and can load additional custom skills from a
          directory.
        </p>
      </div>

      <div className="mt-4 pt-4 border-t border-surface-100 space-y-2">
        <p className="text-[10px] sm:text-xs font-semibold text-black/60 uppercase tracking-wider mb-2">
          Custom Skills Directory (Optional)
        </p>
        <p className="text-xs text-black/40 mb-3">
          Configure a folder containing custom SKILL.md subdirectories. Custom skills override
          built-in skills with the same name.
        </p>

        {source ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg font-mono text-[10px] sm:text-xs group hover:border-primary/30 transition-colors">
            <span className="truncate text-black/70 flex-1">{source}</span>
            <button
              onClick={handleClearDirectory}
              className="text-black/30 hover:text-red-500 transition-colors p-1"
              title="Remove custom directory"
            >
              ✕
            </button>
          </div>
        ) : (
          <p className="text-xs italic text-black/40 bg-surface-50 p-3 rounded-lg border border-dashed border-surface-200">
            No custom directory configured. Built-in skills remain active.
          </p>
        )}

        <button
          onClick={handlePickDirectory}
          className="mt-3 w-full sm:w-auto px-4 py-2 text-xs font-medium bg-surface-100 hover:bg-surface-200 border border-surface-200 rounded-lg transition-all text-black/60 hover:text-black active:scale-95 flex items-center justify-center gap-2 cursor-pointer focus:outline-none"
        >
          <span className="text-lg leading-none">📁</span>
          {source ? 'Change Directory' : 'Pick Directory'}
        </button>
      </div>
    </div>
  )
}
