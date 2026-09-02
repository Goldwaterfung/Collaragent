import { createMiddleware, type AgentMiddleware } from 'langchain'
import {
  readDocument,
  createDocument,
  editDocument,
  listWorkspaceItems,
  readGraph,
  writeGraph,
  writeMindMap,
  createProjectTool,
  removeProjectTool
} from '@collaragent/tools'

interface WorkspaceMiddlewareConfig {
  readOnly?: boolean
}

const WORKSPACE_SYSTEM_PROMPT = `
## Workspace System

You are in the workspace. Workspace is your primary environment and set of tools for managing information and completing tasks. Use it as the primary way to organize and retrieve knowledge.
Workspace System tools are available to you and all subagents at all times.

### Available Tools

#### Exploration & Retrieval
- **listWorkspaceItems**: Use this to see all documents and graphs available in the current workspace.
- **readDocument**: Read the full content of a document.
- **readGraph**: Load the structure and data of a knowledge graph.

{writing_section}

### Usage Guidelines

1. **Information Discovery**: When starting a task, use \`listWorkspaceItems\` to discover relevant context already stored in the workspace.
2. **Contextual Awareness**: Before editing a document, ensure you have read its current state with \`readDocument\`.
3. **Knowledge Organization**: Use graphs and mind maps to represent complex relationships that are better served by a non-linear format.
`

const WORKSPACE_WRITING_SECTION = `
#### Creation & Modification
- **createDocument**: Create a new document.
- **editDocument**: Apply targeted changes to an existing document.
- **writeGraph**: Save or update a knowledge graph.
- **writeMindMap**: Create a mind map from existing content or ideas.
- **createProjectTool**: Register a new tool for use within this project.
- **removeProjectTool**: Unregister a project-specific tool.
`

export const createWorkspaceMiddleware = (
  config: WorkspaceMiddlewareConfig = {}
): AgentMiddleware => {
  // Define tool sets
  const readTools = [readDocument, listWorkspaceItems, readGraph]
  const writeTools = [
    createDocument,
    editDocument,
    writeGraph,
    writeMindMap,
    createProjectTool,
    removeProjectTool
  ]

  // Determine active tools based on config
  const activeTools = config.readOnly ? [...readTools] : [...readTools, ...writeTools]

  return createMiddleware({
    name: 'WorkspaceMiddleware',
    tools: activeTools,
    wrapModelCall: (request, handler) => {
      const writingSection = config.readOnly ? '' : WORKSPACE_WRITING_SECTION
      const workspaceSection = WORKSPACE_SYSTEM_PROMPT.replace(
        '{writing_section}',
        writingSection
      ).trim()

      // Append to existing system prompt
      const currentSystemPrompt = request.systemPrompt || ''
      const newSystemPrompt = currentSystemPrompt
        ? `${currentSystemPrompt}\n\n${workspaceSection}`
        : workspaceSection

      return handler({ ...request, systemPrompt: newSystemPrompt })
    }
  })
}
