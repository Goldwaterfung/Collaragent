import React, { useState, useEffect } from 'react';
import { ModelConfig, ModelInfo } from '@shared/config/types';

interface ModelSelectorProps {
    currentConfig: ModelConfig;
    onUpdate: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ currentConfig, onUpdate }) => {
    const [provider, setProvider] = useState<ModelConfig['provider']>(currentConfig.provider);
    const [modelId, setModelId] = useState(currentConfig.modelId);
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState(currentConfig.baseUrl || '');

    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        loadModels();
    }, []);

    useEffect(() => {
        // Update local state if currentConfig changes externally
        setProvider(currentConfig.provider);
        setModelId(currentConfig.modelId);
        setBaseUrl(currentConfig.baseUrl || '');
    }, [currentConfig]);

    const loadModels = async () => {
        try {
            const response = await window.configIPC.getModels({});
            if (response && response.models) {
                setAvailableModels(response.models);
            }
        } catch (error) {
            console.error('Failed to load models:', error);
        }
    };

    const handleSave = async () => {
        setLoading(true);
        setMessage(null);
        try {
            // Find the selected model info to get its preset parameters
            const selectedModel = availableModels.find(m => m.id === modelId && m.provider === provider);

            // Use preset parameters if available, otherwise fall back to safe defaults or empty object
            // Note: We no longer allow user to customize these parameters in the UI
            const parameters = selectedModel?.parameters || {};

            const response = await window.configIPC.setModel({
                provider,
                modelId,
                apiKey: apiKey || undefined, // Only send if provided
                baseUrl: baseUrl || undefined,
                parameters
            });

            if (response.success) {
                setMessage({ type: 'success', text: 'Model configuration saved successfully' });
                setApiKey(''); // Clear API key for security
                onUpdate();
            } else {
                setMessage({ type: 'error', text: response.error || 'Failed to save configuration' });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'An unexpected error occurred' });
        } finally {
            setLoading(false);
        }
    };

    const providers: ModelConfig['provider'][] = ['openai', 'anthropic', 'google'];
    const filteredModels = availableModels.filter(m => m.provider === provider);
    const selectedModelInfo = availableModels.find(m => m.id === modelId && m.provider === provider);

    return (
        <div className="model-selector p-4 sm:p-6 lg:p-8 border border-surface-200 rounded-xl sm:rounded-2xl bg-white shadow-sm">
            <h3 className="text-base sm:text-lg lg:text-xl font-semibold mb-4 sm:mb-5 lg:mb-6 text-black">Model Configuration</h3>

            {/* Responsive grid - stack on mobile, 2 columns on larger screens for provider/model */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-6">
                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium mb-2 text-black">Provider</label>
                    <select
                        value={provider}
                        onChange={(e) => {
                            setProvider(e.target.value as any);
                            // Optional: Auto-select first model of new provider
                            const firstModel = availableModels.find(m => m.provider === e.target.value);
                            if (firstModel) setModelId(firstModel.id);
                        }}
                        className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base focus:outline-none transition-shadow"
                    >
                        {providers.map(p => (
                            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                        ))}
                    </select>
                </div>

                <div className="lg:col-span-1">
                    <label className="block text-sm font-medium mb-2 text-black">Model</label>
                    <select
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base focus:outline-none transition-shadow"
                    >
                        {filteredModels.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                        {/* Fallback if current modelId isn't in the list */}
                        {!filteredModels.find(m => m.id === modelId) && (
                            <option value={modelId}>{modelId} (Custom/Legacy)</option>
                        )}
                    </select>
                </div>

                {selectedModelInfo && (
                    <div className="lg:col-span-2 bg-surface-100 border border-surface-200 p-4 rounded-xl text-sm text-black">
                        <p className="font-medium text-sm sm:text-base">{selectedModelInfo.description}</p>
                        <p className="text-xs sm:text-sm mt-1.5 text-black/60">
                            Context Window: {selectedModelInfo.contextWindow?.toLocaleString()} tokens
                        </p>
                    </div>
                )}

                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium mb-2 text-black">API Key</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base placeholder:text-black/40 focus:outline-none transition-shadow"
                        placeholder={apiKey ? "(Unchanged)" : "Enter new API key to update"}
                    />
                    <p className="text-xs sm:text-sm text-black/50 mt-2">Stored securely in system keychain. Leave blank to keep existing key.</p>
                </div>

                <div className="lg:col-span-2">
                    <label className="block text-sm font-medium mb-2 text-black">Base URL (Optional)</label>
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        className="w-full p-3 border border-surface-200 rounded-xl bg-surface-50 text-black text-sm sm:text-base placeholder:text-black/40 focus:outline-none transition-shadow"
                        placeholder="https://api.example.com/v1"
                    />
                </div>

                {message && (
                    <div className={`lg:col-span-2 p-3 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-surface-100 text-black border border-surface-200' : 'bg-surface-300 text-black border border-primary'}`}>
                        {message.text}
                    </div>
                )}

                <div className="lg:col-span-2">
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="w-full sm:w-auto bg-primary text-black px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl hover:bg-surface-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium shadow-sm text-sm sm:text-base focus-visible:outline-none"
                    >
                        {loading ? 'Saving...' : 'Save Model Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

