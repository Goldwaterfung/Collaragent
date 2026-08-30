# Registering New Tools

This document outlines the step-by-step procedure to register a new tool in the CollarAgent application. The process uses a centralized tool registry and supports **secure API key management**.

## Overview

Tools are capabilities that agents can use (e.g., File I/O, Web Search). To add a new tool:

1.  **Add** the tool metadata and factory to the centralized registry (`src/main/tools`).
2.  **Define** if an API key is required using `requireAPI: true`.
3.  **Implement** the factory to accept an optional `apiKey`.
4.  **Enable** the tool via the Settings UI. The UI will automatically provide an encrypted input field if `requireAPI` is enabled.

## Step 1: Centralized Tool Registry

Edit `src/main/tools/index.ts` to export metadata and factories.

### Example Registry with API Key Support:

```typescript
// src/main/tools/index.ts
export const toolsMeta = [
  { 
    id: "calculator", 
    name: "Calculator", 
    langchainTool: "Calculator" 
  },
  {
    id: "internet_search",
    name: "Internet Search",
    langchainTool: "internet_search",
    description: "Search the web using Tavily",
    requireAPI: true, // This triggers the secure API key field in UI
  },
];

type ToolFactory = (apiKey?: string) => Promise<any> | any;

export const toolFactoryMap: Record<string, ToolFactory> = {
  calculator: async () => {
    const { Calculator } = await import("@langchain/community/tools/calculator");
    return new Calculator();
  },
  internet_search: async (apiKey?: string) => {
    // The apiKey is retrieved from SecureStorage automatically
    if (apiKey) {
      process.env.TAVILY_API_KEY = apiKey;
    }
    const { internetSearch } = await import("../../deepagents/tools/SearchTools");
    return internetSearch;
  },
};
```

## Step 2: Runtime Instantiation

The `createTools` function in `src/main/agents/utils.ts` handles the heavy lifting of resolving keys from the secure vault.

```typescript
export async function createTools(
  toolConfigs: ToolConfig[], 
  resolveApiKey: (id: string) => string | undefined
) {
  const enabledTools = toolConfigs.filter((t) => t.enabled);
  const initiatedTools: any[] = [];

  for (const toolConfig of enabledTools) {
    const factory = toolFactoryMap[toolConfig.id];
    if (!factory) continue;

    // Fetch key for tools that require it
    const apiKey = toolConfig.requireAPI ? resolveApiKey(toolConfig.id) : undefined;
    
    const instance = await factory(apiKey);
    initiatedTools.push(instance);
  }
  // ... also loads MCP tools
  return initiatedTools;
}
```

## Secure Storage & UI

- **Registry Persistence**: `ToolManager` automatically merges `requireAPI` metadata into the app configuration.
- **UI Integration**: `ToolList.tsx` detects the `requireAPI` flag. When a tool is enabled:
    - It displays a secure `password` input.
    - It uses the `CONFIG_SET_TOOL_API_KEY` IPC channel to save the key.
    - Keys are stored in `~/.collaragent/secrets.json` using Electron's `safeStorage` (OS-level encryption).
- **Auto-Injection**: You don't need to manually load `.env` files. The factory receives the decrypted key at runtime, allowing it to set the necessary environment variables for third-party libraries.

## Architecture Notes

- **Sync Metadata**: Keep `toolsMeta` synchronous so the UI loads instantly.
- **Lazy Loading**: Use dynamic `import()` inside the factory to keep the main process fast and only load dependencies for enabled tools.
- **Cleanup**: If a tool changes its `requireAPI` status in code, the UI will reflect this change on the next restart.
