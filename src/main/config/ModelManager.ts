import { ModelInfo } from "../../shared/config/types";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export class ModelManager {
  private providers = [
    openaiProvider(),
    anthropicProvider(),
    googleProvider()
  ];

  getAvailableModels(): ModelInfo[] {
    const models: ModelInfo[] = [];

    for (const provider of this.providers) {
      const providerModels = provider.getModels();
      for (const m of providerModels) {
        const supportedLevels = getSupportedThinkingLevels(m);
        const activeThinkingLevels = supportedLevels.filter((l) => l !== "off");

        if (activeThinkingLevels.length > 0) {
          for (const level of activeThinkingLevels) {
            const capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1);
            models.push({
              id: `${m.id}-${level}`,
              apiModelId: m.id,
              name: `${m.name} (Thinking: ${capitalizedLevel})`,
              provider: m.provider as "openai" | "anthropic" | "google",
              description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
              contextWindow: m.contextWindow,
              pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
              parameters: this.buildParameters(m, level)
            });
          }

          if (supportedLevels.includes("off")) {
            models.push({
              id: m.id,
              apiModelId: m.id,
              name: `${m.name} (No Thinking)`,
              provider: m.provider as "openai" | "anthropic" | "google",
              description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
              contextWindow: m.contextWindow,
              pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
              parameters: this.buildParameters(m, "off")
            });
          }
        } else {
          models.push({
            id: m.id,
            apiModelId: m.id,
            name: m.name,
            provider: m.provider as "openai" | "anthropic" | "google",
            description: `Context: ${m.contextWindow?.toLocaleString()} tokens | Max Output: ${m.maxTokens?.toLocaleString()} tokens`,
            contextWindow: m.contextWindow,
            pricing: m.cost ? { input: m.cost.input, output: m.cost.output } : undefined,
            parameters: this.buildParameters(m, undefined)
          });
        }
      }
    }

    return models;
  }

  private buildParameters(m: any, level?: string): Record<string, any> {
    const params: Record<string, any> = {
      temperature: 0.7,
      maxTokens: m.maxTokens
    };

    if (level && level !== "off") {
      if (m.provider === "openai") {
        params.reasoning = {
          effort: level,
          summary: "auto"
        };
      } else if (m.provider === "anthropic") {
        params.thinking = {
          type: "enabled",
          budget_tokens: Math.min(
            Math.max(1024, Math.round((m.maxTokens || 8192) * (level === "low" ? 0.25 : level === "medium" ? 0.5 : 0.75))),
            32000
          )
        };
      } else if (m.provider === "google") {
        params.thinkingConfig = {
          thinkingBudget: level === "low" ? 1024 : level === "medium" ? 8192 : 16384
        };
      }
    }

    return params;
  }
}