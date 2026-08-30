import { AppConfig } from "../../shared/config/types";
import { ConfigManager } from "../config/ConfigManager";

export class AgentConfigLoader {
  constructor(private configManager: ConfigManager) {}

  /**
   * Load the current configuration to be used for agent creation
   */
  async loadConfig(): Promise<AppConfig> {
    return this.configManager.getConfig();
  }

  /**
   * Get API key for a specific provider
   */
  getApiKey(provider: string): string | undefined {
    return this.configManager.getApiKey(provider);
  }
}
