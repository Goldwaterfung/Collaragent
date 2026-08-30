import { create } from 'zustand';
import { AppConfig } from '@shared/config/types';

interface ConfigState {
  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}));
