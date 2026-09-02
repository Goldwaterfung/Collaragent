import { useEffect, useState } from 'react'
import { AppConfig, SubAgentConfig } from '@shared/config/types'
import { ModelSelector } from './ModelSelector'
import { ToolList } from './ToolList'
import { SubagentList } from './SubagentList'
import { SkillsSettings } from './SkillsSettings'
import { MCPServerSettings } from './MCPServerSettings'
import { TelemetrySettings } from './TelemetrySettings'

export const Settings = () => {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<
    'general' | 'subagents' | 'skills' | 'tools' | 'telemetry'
  >('general')

  const loadConfig = async () => {
    try {
      setLoading(true)
      const response = await window.configIPC.get({})
      setConfig(response.config)
    } catch (err: any) {
      setError(err.message || 'Failed to load configuration')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  const handleToggleTool = async (toolId: string, enabled: boolean) => {
    try {
      await window.configIPC.toggleTool({ toolId, enabled })
      await loadConfig() // Refresh
    } catch (err) {
      console.error('Failed to toggle tool', err)
    }
  }

  const handleAddSubagent = async (subagent: SubAgentConfig) => {
    await window.configIPC.addSubagent({ subagent })
    await loadConfig()
  }

  const handleUpdateSubagent = async (id: string, updates: Partial<SubAgentConfig>) => {
    await window.configIPC.updateSubagent({ id, updates })
    await loadConfig()
  }

  const handleDeleteSubagent = async (id: string) => {
    await window.configIPC.deleteSubagent({ id })
    await loadConfig()
  }

  const handleToggleDynamic = async (enabled: boolean) => {
    if (!config) return
    const newConfig = {
      ...config,
      middleware: {
        ...config.middleware,
        subAgent: {
          ...config.middleware.subAgent,
          dynamicEnabled: enabled
        }
      }
    }
    await window.configIPC.save({ config: newConfig })
    await loadConfig()
  }

  if (loading && !config) {
    return <div className="p-8 text-center font-medium text-black/60">Loading settings...</div>
  }

  if (error || !config) {
    return <div className="p-8 text-center text-red-600">Error: {error}</div>
  }

  return (
    <div className="settings-container w-full h-full overflow-y-auto bg-surface-50">
      {/* Responsive container with fluid padding */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-6 sm:mb-8 text-black">
          Settings
        </h2>

        {/* Horizontal scrollable tabs on mobile */}
        <div className="flex overflow-x-auto border-b border-surface-200 mb-6 sm:mb-8 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
          <button
            className={`px-4 py-2 font-medium transition-colors ${activeTab === 'general' ? 'border-b-2 border-primary text-black' : 'text-black/60 hover:text-black hover:bg-surface-100/50 rounded-t-lg'}`}
            onClick={() => setActiveTab('general')}
          >
            General & Model
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${activeTab === 'subagents' ? 'border-b-2 border-primary text-black' : 'text-black/60 hover:text-black hover:bg-surface-100/50 rounded-t-lg'}`}
            onClick={() => setActiveTab('subagents')}
          >
            Subagents
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${activeTab === 'skills' ? 'border-b-2 border-primary text-black' : 'text-black/60 hover:text-black hover:bg-surface-100/50 rounded-t-lg'}`}
            onClick={() => setActiveTab('skills')}
          >
            Skills
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${activeTab === 'tools' ? 'border-b-2 border-primary text-black' : 'text-black/60 hover:text-black hover:bg-surface-100/50 rounded-t-lg'}`}
            onClick={() => setActiveTab('tools')}
          >
            Tools
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${activeTab === 'telemetry' ? 'border-b-2 border-primary text-black' : 'text-black/60 hover:text-black hover:bg-surface-100/50 rounded-t-lg'}`}
            onClick={() => setActiveTab('telemetry')}
          >
            Telemetry & Observability
          </button>
        </div>

        <div className="tab-content">
          {activeTab === 'general' && (
            <div className="mt-1">
              <ModelSelector currentConfig={config.model} onUpdate={loadConfig} />
            </div>
          )}

          {activeTab === 'subagents' && (
            <div className="mt-1">
              <SubagentList
                subagents={config.subagents}
                dynamicEnabled={config.middleware.subAgent.dynamicEnabled}
                availableTools={config.tools}
                availableMCPServers={config.mcpServers || []}
                onAdd={handleAddSubagent}
                onUpdate={handleUpdateSubagent}
                onDelete={handleDeleteSubagent}
                onToggleDynamic={handleToggleDynamic}
              />
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-3 sm:space-y-4 mt-1">
              {/* Skills Settings */}
              <SkillsSettings
                config={config}
                onSave={async (newConfig) => {
                  setConfig(newConfig)
                  try {
                    await window.configIPC.save({ config: newConfig })
                    await loadConfig()
                  } catch (err) {
                    console.error('Failed to save skills config', err)
                    await loadConfig()
                  }
                }}
              />
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="mt-1 space-y-6">
              <ToolList tools={config.tools} onToggle={handleToggleTool} />
              <MCPServerSettings mcpServers={config.mcpServers || []} onRefresh={loadConfig} />
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="mt-1">
              <TelemetrySettings config={config} onUpdate={loadConfig} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
