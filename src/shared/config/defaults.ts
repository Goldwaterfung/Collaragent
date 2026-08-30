import { AppConfig } from "./types";

export const DEFAULT_CONFIG: AppConfig = {
  model: {
    provider: "openai",
    modelId: "gpt-5.2-medium",
    parameters: {
      temperature: 0.7,
      maxTokens: 32768,
      reasoning: {
        effort: "medium",
        summary: "auto"
      }
    },
  },
  subagents: [
    {
      id: "researcher-1",
      name: "researcher",
      description: "Handles web research tasks and information gathering",
      systemPrompt:
        "You are a research assistant. Use web search to find accurate information.",
      tools: ["tavily-search"],
      enabled: true,
    },
    {
      id: "analyzer-1",
      name: "analyzer",
      description: "Analyzes code and provides code review",
      systemPrompt:
        "You are a code analyzer. Review code for bugs, security issues, and best practices.",
      tools: ["calculator"],
      enabled: false,
    },
  ],
  tools: [
    {
      id: "calculator",
      name: "Calculator",
      enabled: true,
      langchainTool: "Calculator",
    },
  ],
  middleware: {
    subAgent: {
      enabled: true,
      dynamicEnabled: true,
      recursionLimit: 200,
    },
    skills: {
      enabled: false,
      source: '',
    },
  },
  mcpServers: [],
  recentFiles: [],
};
