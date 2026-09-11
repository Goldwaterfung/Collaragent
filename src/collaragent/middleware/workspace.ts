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

const WORKSPACE_BASE_PROMPT = `
## Workspace System

The workspace is an interconnected knowledge environment of documents and visual concept canvases.

### Operating Protocols
1. **Discovery First**: Inspect existing context using \`listWorkspaceItems\`, \`readDocument\`, or \`readGraph\` before planning modifications.
2. **Knowledge Organization**: Use concept canvases and mind maps for structural and non-linear relationships; use documents for narrative synthesis and analysis.
3. **Structured Document Presentation**:
   - Tabular Data: Comparisons, metrics, and multi-attribute data belong in \`<table>\` with \`<thead>\` and bold keys (\`<td><b>Key</b></td>\`).
   - High-Density Lists: Parallel points belong in \`<ul>\`/\`<li>\` with 2-4 word bold lead-ins.
   - Narrative Prose: Use \`<p>\` for conceptual reasoning and synthesis (one core thesis per paragraph).`

const WORKSPACE_WRITING_SECTION = `
4. **Targeted Mutations**: Use \`editDocument\` with batched operations (\`update\`, \`insert\`, \`delete\`) to modify documents. This preserves block identities and attached comments. Only use \`createDocument\` when provisioning a new document or replacing the entire file.
5. **Compounding Wiki & Ledger Integrity**:
   - Link entities and literature claims using typed wikilinks (\`[[<relation>:<targetEntity>|<justification>]]\`).
   - Supported relations: 'supports', 'contradicts', 'supersedes', 'details', 'derived_from', 'cites', 'relates_to'.
   - Ingest papers with \`ingestSource\`, file syntheses back with \`queryAndFileBack\`, and materialize graphs with \`compileGraph\`.
   - Maintain structural integrity: run \`lintWorkspace\` to identify broken links, anchor losses, and circular dependencies.`

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
      const workspaceSection = config.readOnly
        ? WORKSPACE_BASE_PROMPT.trim()
        : `${WORKSPACE_BASE_PROMPT.trim()}\n${WORKSPACE_WRITING_SECTION.trim()}`

      // Append to existing system prompt
      const currentSystemPrompt = request.systemPrompt || ''
      const newSystemPrompt = currentSystemPrompt
        ? `${currentSystemPrompt}\n\n${workspaceSection}`
        : workspaceSection

      return handler({ ...request, systemPrompt: newSystemPrompt })
    }
  })
}
