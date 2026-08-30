import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StdioConnection, StreamableHTTPConnection } from "@langchain/mcp-adapters";
import { MCPServerConfig } from "../../shared/config/types";
import { logger } from "../utils/Logger";
import crypto from "crypto";

type ServerMap = Record<string, StdioConnection | StreamableHTTPConnection>;

// --- Implementation for dynamic-subagent: BEGIN ---
// Cache individual MCP clients and their tools to prevent duplicate process spawning 
// and resource leaks when loadMCPTools is called multiple times.
const mcpServerCache = new Map<string, Promise<{ client: MultiServerMCPClient | null; tools: any[] }>>();
// --- Implementation for dynamic-subagent: END ---


/**
 * Converts our app's MCPServerConfig[] into a server map keyed by server id.
 * Each entry matches StdioConnection or StreamableHTTPConnection as expected
 * by MultiServerMCPClient({ mcpServers: ... }).
 */
function buildServerMap(
  mcpServers: MCPServerConfig[],
  resolveApiKey: (id: string) => string | undefined
): ServerMap {
  const servers: ServerMap = {};

  for (const server of mcpServers) {

    const { id, transport, requireAPI, apiKeyName } = server;

    if (transport.type === "stdio") {
      if (!transport.command) {
        logger.warn(`MCP server "${id}" uses stdio but has no command — skipped.`);
        continue;
      }

      // Inject process.env to ensure PATH and other necessary variables are available
      const env: Record<string, string> = { ...process.env, ...(transport.env || {}) } as Record<string, string>;
      if (requireAPI) {
        const apiKey = resolveApiKey(id);
        if (apiKey) {
          env[apiKeyName || "API_KEY"] = apiKey;
        }
      }

      const conn: StdioConnection = {
        transport: "stdio",
        command: transport.command,
        args: transport.args ?? [],
        env,
      };
      servers[id] = conn;
    } else if (transport.type === "sse" || transport.type === "http") {
      if (!transport.url) {
        logger.warn(`MCP server "${id}" uses ${transport.type} but has no url — skipped.`);
        continue;
      }

      const conn: StreamableHTTPConnection = {
        transport: "http",
        url: transport.url,
        automaticSSEFallback: true,
      };
      servers[id] = conn;
    } else {
      logger.warn(`MCP server "${id}" has unknown transport type — skipped.`);
    }
  }

  return servers;
}

export async function loadMCPTools(
  mcpServers: MCPServerConfig[],
  resolveApiKey: (id: string) => string | undefined
): Promise<any[]> {
  if (mcpServers.length === 0) {
    return [];
  }

  const serverMap = buildServerMap(mcpServers, resolveApiKey);

  if (Object.keys(serverMap).length === 0) {
    return [];
  }

  const allTools: any[] = [];
  const disabledToolsSet = new Set<string>();

  for (const server of mcpServers) {
    if (server.disabledTools) {
      server.disabledTools.forEach(t => disabledToolsSet.add(t));
    }
  }

  // --- Implementation for dynamic-subagent: BEGIN ---
  // Iterate and securely cache server configurations to ensure dynamic_task
  // can repeatedly fetch all tools without causing process collision.
  const promises = Object.entries(serverMap).map(async ([serverId, conn]) => {
    // Hash the connection configuration to reuse if unchanged
    const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ serverId, conn })).digest("hex");
    
    let cachedPromise = mcpServerCache.get(cacheKey);
    if (!cachedPromise) {
      cachedPromise = (async () => {
        try {
          const singleServerMap = { [serverId]: conn };
          const client = new MultiServerMCPClient({ mcpServers: singleServerMap });
          // Note: getTools() returns tools specifically named for `serverId`
          const tools = await client.getTools();
          return { client, tools };
        } catch (err) {
          logger.error(`Failed to load MCP tools for server ${serverId}`, err);
          return { client: null, tools: [] };
        }
      })();
      mcpServerCache.set(cacheKey, cachedPromise);
    }
    
    const { tools } = await cachedPromise;
    return tools;
  });

  const toolsArrays = await Promise.all(promises);
  for (const tools of toolsArrays) {
    allTools.push(...tools);
  }
  // --- Implementation for dynamic-subagent: END ---

  // Filter out disabled tools
  const filteredTools = allTools.filter(tool => !disabledToolsSet.has(tool.name));

  logger.info(`Loaded ${filteredTools.length} MCP tools (${allTools.length - filteredTools.length} disabled) from ${Object.keys(serverMap).length} servers`);
  return filteredTools;
}

/**
 * Fetch available tools for a single MCP server.
 * Used by the settings GUI to display all tools for a server.
 */
export async function fetchToolsForServer(
  serverConfig: MCPServerConfig,
  resolveApiKey: (id: string) => string | undefined
): Promise<{ name: string; description?: string }[]> {
  // We temporarily enable the server just to fetch its tools without filtering them out
  const configCopy = { ...serverConfig, enabled: true, disabledTools: [] };
  const tools = await loadMCPTools([configCopy], resolveApiKey);

  return tools.map(t => ({
    name: t.name,
    description: t.description,
  }));
}

