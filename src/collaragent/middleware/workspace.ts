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
  removeProjectTool,
  ingestSource,
  queryAndFileBack,
  lintWorkspace,
  compileGraph
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
- **lintWorkspace**: Run a deterministic structural audit of the wiki workspace to check for broken links, unresolved symbols, anchor losses, and cycles.

{writing_section}

### Usage Guidelines

1. **Information Discovery**: When starting a task, use \`listWorkspaceItems\` to discover relevant context already stored in the workspace.
2. **Contextual Awareness**: Before editing a document, ensure you have read its current state with \`readDocument\`.
3. **Knowledge Organization**: Use graphs and mind maps to represent complex relationships that are better served by a non-linear format.
4. **Document Presentation**: Present multi-attribute data (comparisons, metrics, timelines) in structured \`<table>\` blocks with \`<thead>\` and bold row keys. Use \`<ul>\`/\`<li>\` with bold lead-ins for parallel points, and \`<p>\` for cohesive narrative analysis.
5. **Workspace as Compounding Wiki**: Treat the workspace as an interconnected, compounding knowledge wiki. When ingesting papers or external sources, use \`ingestSource\` to ensure claims are anchored and tracked in the relational ledger. When conducting cross-cutting research, use \`queryAndFileBack\` to file synthesis documents back into the graph. Verify graph health using \`lintWorkspace\`, and compile document linkages to a concept canvas in SQLite with \`compileGraph\`.
`

const WORKSPACE_WRITING_SECTION = `
#### Creation & Modification
- **createDocument**: Create a new document.
- **editDocument**: Apply targeted changes to an existing document.
- **writeGraph**: Save or update a knowledge graph.
- **writeMindMap**: Create a mind map from existing content or ideas.
- **compileGraph**: Lints document linkage and compiles the relational ledger into a concept canvas graph stored directly in SQLite for readGraph inspection.
- **ingestSource**: Atomically ingest a literature source, updating concepts with anchored claim badges and the relational ledger with full rollback parity.
- **queryAndFileBack**: Synthesize cross-cutting research and file back into the wiki with bidirectional relations, index updates, and log entries.
- **createProject**: Create a new project workspace namespace for documents and graphs.
- **removeProject**: Remove an existing project workspace namespace and its contents.
`

export const createWorkspaceMiddleware = (
  config: WorkspaceMiddlewareConfig = {}
): AgentMiddleware => {
  // Define tool sets with clean separation between read-only and mutating actions
  const readTools = [readDocument, listWorkspaceItems, readGraph, lintWorkspace]
  const writeTools = [
    createDocument,
    editDocument,
    writeGraph,
    writeMindMap,
    compileGraph,
    ingestSource,
    queryAndFileBack,
    createProjectTool,
    removeProjectTool
  ]

  // Determine active tools based on config and guarantee unique tool names
  const rawTools = config.readOnly ? readTools : [...readTools, ...writeTools]
  const toolMap = new Map<string, (typeof rawTools)[number]>()
  for (const t of rawTools) {
    toolMap.set(t.name, t)
  }
  const activeTools = Array.from(toolMap.values())

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
