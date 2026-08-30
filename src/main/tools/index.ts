type ToolMeta = {
  id: string;
  name: string;
  langchainTool: string;
  description?: string;
  icon?: string;
  requireAPI?: boolean;
};

export const toolsMeta: ToolMeta[] = [
  {
    id: "internet_search",
    name: "Internet Search",
    langchainTool: "internet_search",
    description: "Search the web",
    requireAPI: true,
  },
];

type ToolFactory = (apiKey?: string) => Promise<any> | any;

export const toolFactoryMap: Record<string, ToolFactory> = {
  internet_search: async (apiKey?: string) => {
    // We expect the apiKey to be passed here from SecureStorage
    if (apiKey) {
      process.env.TAVILY_API_KEY = apiKey;
    }
    const { internetSearch } = await import("../../collaragent/tools/SearchTools");
    return internetSearch;
  },
};

export default {
  toolsMeta,
  toolFactoryMap,
};
