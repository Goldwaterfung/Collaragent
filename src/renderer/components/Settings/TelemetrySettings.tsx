import React, { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/config/types'

interface TelemetrySettingsProps {
  config: AppConfig
  onUpdate: () => Promise<void> | void
}

export const TelemetrySettings: React.FC<TelemetrySettingsProps> = ({ config, onUpdate }) => {
  const [enabled, setEnabled] = useState(config.telemetry?.enabled ?? false)
  const [baseUrl, setBaseUrl] = useState(config.telemetry?.baseUrl || 'http://localhost:3000')
  const [publicKey, setPublicKey] = useState(config.telemetry?.publicKey || '')
  const [secretKey, setSecretKey] = useState('')
  const [hasExistingSecret, setHasExistingSecret] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  useEffect(() => {
    setEnabled(config.telemetry?.enabled ?? false)
    setBaseUrl(config.telemetry?.baseUrl || 'http://localhost:3000')
    setPublicKey(config.telemetry?.publicKey || '')
    checkExistingKey()
  }, [config])

  const checkExistingKey = async () => {
    try {
      const res = await window.configIPC.checkKey({ id: 'langfuse' })
      setHasExistingSecret(!!res?.exists)
    } catch {
      setHasExistingSecret(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    setSaveMessage(null)

    try {
      const cleanUrl = baseUrl.trim() || 'http://localhost:3000'
      const response = await window.configIPC.testTelemetry({
        baseUrl: cleanUrl,
        publicKey: publicKey.trim() || undefined,
        secretKey: secretKey.trim() || undefined
      })

      if (response.success) {
        setTestResult({
          ok: true,
          message: response.message || 'Connected to Langfuse server successfully'
        })
      } else {
        setTestResult({
          ok: false,
          message: response.error || 'Server is unreachable or returned an error'
        })
      }
    } catch (error: unknown) {
      const errText = error instanceof Error ? error.message : 'Failed to ping Langfuse'
      setTestResult({ ok: false, message: `Connection test error: ${errText}` })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)

    try {
      // 1. Save secret key to OS Keychain via SecureStorage if entered
      if (secretKey.trim()) {
        const keyRes = await window.configIPC.setToolApiKey({
          toolId: 'langfuse',
          apiKey: secretKey.trim()
        })
        if (!keyRes.success) {
          throw new Error('Failed to encrypt secret key in OS Keychain')
        }
        setSecretKey('')
        setHasExistingSecret(true)
      }

      // 2. Save public telemetry configuration
      const updatedConfig: AppConfig = {
        ...config,
        telemetry: {
          enabled,
          baseUrl: baseUrl.trim() || 'http://localhost:3000',
          publicKey: publicKey.trim()
        }
      }

      const saveRes = await window.configIPC.save({ config: updatedConfig })
      if (saveRes.success) {
        setSaveMessage({ type: 'success', text: 'Telemetry configuration saved successfully' })
        await onUpdate()
      } else {
        setSaveMessage({
          type: 'error',
          text: saveRes.error || 'Failed to persist configuration'
        })
      }
    } catch (error: unknown) {
      const errText = error instanceof Error ? error.message : 'An unexpected error occurred'
      setSaveMessage({ type: 'error', text: errText })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="telemetry-settings p-4 sm:p-6 lg:p-8 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm space-y-6">
      {/* Header with Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-surface-200">
        <div className="flex-1">
          <h3 className="font-semibold text-base sm:text-lg lg:text-xl text-black">
            Langfuse Observability & Tracing
          </h3>
          <p className="text-xs sm:text-sm text-black/60 mt-1">
            Capture real-time LLM token economics, execution traces, and agent tool calls.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 self-start sm:self-auto">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <div className="w-11 h-6 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
        </label>
      </div>

      {/* Configuration Fields */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-6">
        <div className="lg:col-span-2">
          <label className="block text-sm font-medium mb-2 text-black">
            Langfuse Host / Base URL
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base placeholder:text-black/40 focus:outline-none transition-shadow"
            placeholder="http://localhost:3000"
          />
          <p className="text-xs text-black/50 mt-1.5">
            Default local deployment URL is{' '}
            <code className="bg-surface-100 px-1 py-0.5 rounded font-mono">
              http://localhost:3000
            </code>
            .
          </p>
        </div>

        <div className="lg:col-span-1">
          <label className="block text-sm font-medium mb-2 text-black">
            Public Key <span className="text-black/50 font-normal">(pk-lf-...)</span>
          </label>
          <input
            type="text"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base placeholder:text-black/40 focus:outline-none transition-shadow"
            placeholder="pk-lf-1234567890abcdef..."
          />
        </div>

        <div className="lg:col-span-1">
          <label className="block text-sm font-medium mb-2 text-black">
            Secret Key <span className="text-black/50 font-normal">(sk-lf-...)</span>
          </label>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base placeholder:text-black/40 focus:outline-none transition-shadow"
            placeholder={
              hasExistingSecret
                ? '(Encrypted in OS Keychain - enter new key to update)'
                : 'sk-lf-1234567890abcdef...'
            }
          />
          {hasExistingSecret && (
            <p className="text-xs text-emerald-600 mt-1.5 flex items-center gap-1 font-medium">
              🔒 Secret key is encrypted and stored in system keychain.
            </p>
          )}
        </div>
      </div>

      {/* Test Connection Result Banner */}
      {testResult && (
        <div
          className={`p-3.5 rounded-xl text-sm font-medium flex items-center gap-2 border ${
            testResult.ok
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          <span className="text-base">{testResult.ok ? '🟢' : '🔴'}</span>
          <span>{testResult.message}</span>
        </div>
      )}

      {/* Save Result Message */}
      {saveMessage && (
        <div
          className={`p-3.5 rounded-xl text-sm font-medium border ${
            saveMessage.type === 'success'
              ? 'bg-surface-100 text-black border-surface-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
        <button
          onClick={handleTestConnection}
          disabled={testing}
          className="w-full sm:w-auto px-5 py-3 rounded-xl border border-surface-200 bg-surface-100 hover:bg-surface-200 text-black text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none active:scale-95"
        >
          {testing ? (
            <>
              <span className="animate-spin text-xs">⏳</span>
              <span>Testing Connection...</span>
            </>
          ) : (
            <>
              <span>⚡</span>
              <span>Test Connection</span>
            </>
          )}
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full sm:w-auto bg-primary text-black px-6 sm:px-8 py-3 rounded-xl hover:bg-surface-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium text-sm shadow-sm focus:outline-none active:scale-95"
        >
          {saving ? 'Saving...' : 'Save Telemetry Settings'}
        </button>
      </div>
    </div>
  )
}
