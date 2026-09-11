import React, { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/config/types'

interface UserRulesSettingsProps {
  config: AppConfig
  onUpdate: () => Promise<void> | void
}

export const UserRulesSettings: React.FC<UserRulesSettingsProps> = ({ config, onUpdate }) => {
  const [rules, setRules] = useState(config.userRules || '')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  useEffect(() => {
    setRules(config.userRules || '')
  }, [config.userRules])

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)

    try {
      const updatedConfig: AppConfig = {
        ...config,
        userRules: rules.trim()
      }

      const saveRes = await window.configIPC.save({ config: updatedConfig })
      if (saveRes.success) {
        setSaveMessage({ type: 'success', text: 'User rules saved successfully' })
        await onUpdate()
      } else {
        setSaveMessage({
          type: 'error',
          text: saveRes.error || 'Failed to save user rules'
        })
      }
    } catch (error: unknown) {
      const errText = error instanceof Error ? error.message : 'An unexpected error occurred'
      setSaveMessage({ type: 'error', text: errText })
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    setRules('')
    setSaveMessage(null)
  }

  const lineCount = rules ? rules.split('\n').length : 0
  const charCount = rules.length

  return (
    <div className="user-rules-settings p-4 sm:p-6 lg:p-8 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-surface-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-semibold text-base sm:text-lg lg:text-xl text-black">
            User Rules & Instructions
          </h3>
          <div className="text-xs text-black/50 flex items-center gap-3">
            <span>{lineCount} lines</span>
            <span>•</span>
            <span>{charCount} characters</span>
          </div>
        </div>
        <p className="text-xs sm:text-sm text-black/60 mt-1">
          Define custom behavioral guidelines, tone, language requirements, or output constraints.
          Rules are injected as{' '}
          <code className="bg-surface-100 px-1 py-0.5 rounded font-mono text-xs text-black/80">
            &lt;user_rules&gt;
          </code>{' '}
          into the system prompt for the main agent and all delegated subagents.
        </p>
      </div>

      {/* Editor Textarea */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-black">Rules Content</label>
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={12}
          placeholder={`Enter persistent instructions for the agent, for example:
- Always respond in Traditional Chinese (繁體中文).
- Adopt a formal academic tone for research papers.
- Avoid conclusions longer than two paragraphs.
- When generating tables, use clear Markdown or HTML headers.`}
          className="w-full p-4 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base font-mono placeholder:text-black/40 focus:outline-none focus:border-primary transition-colors resize-y leading-relaxed"
        />
        <div className="flex items-center justify-between text-xs text-black/50 px-1">
          <span>Leave empty to use default agent persona without extra constraints.</span>
          <span>Preserves KV-cache prefix before runtime context.</span>
        </div>
      </div>

      {/* Save Result Message */}
      {saveMessage && (
        <div
          className={`p-3.5 rounded-xl text-sm font-medium border ${
            saveMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-surface-200">
        <button
          onClick={handleClear}
          disabled={saving || !rules}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-surface-200 bg-surface-100 hover:bg-surface-200 text-black text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none active:scale-95"
        >
          Clear Rules
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full sm:w-auto bg-primary text-black px-6 sm:px-8 py-2.5 rounded-xl hover:bg-surface-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium text-sm shadow-sm focus:outline-none active:scale-95"
        >
          {saving ? 'Saving...' : 'Save User Rules'}
        </button>
      </div>
    </div>
  )
}
