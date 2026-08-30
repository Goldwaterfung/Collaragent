import { ToolConfig } from "../../shared/config/types";
import { toolsMeta as AVAILABLE_TOOLS } from "../tools";

export class ToolManager {
  getAllAvailableTools(): Omit<ToolConfig, "enabled">[] {
    return AVAILABLE_TOOLS.map(t => ({
      id: t.id,
      name: t.name,
      langchainTool: t.langchainTool,
      requireAPI: t.requireAPI
    }));
  }

  validateTools(tools: ToolConfig[]): ToolConfig[] {
    // Ensure all configured tools are valid available tools
    return tools.filter(t => AVAILABLE_TOOLS.some(at => at.id === t.id));
  }
  
  getToolImportPath(toolId: string): string | undefined {
      const tool = AVAILABLE_TOOLS.find(t => t.id === toolId);
      return tool?.langchainTool;
  }
}
