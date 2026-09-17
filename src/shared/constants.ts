/**
 * Shared constants for the Graph Canvas to ensure visual consistency
 * between agent-generated graphs and the renderer.
 */

export const DEFAULT_NODE_WIDTH = 300
export const DEFAULT_NODE_HEIGHT = 100
export const DEFAULT_NODE_SEP = 60
export const DEFAULT_RANK_SEP = 90
export const NODE_SPACING = DEFAULT_RANK_SEP

export const MIN_NODE_EXPANDED_HEIGHT = 120
export const MAX_NODE_EXPANDED_HEIGHT = 1200
export const MIN_NODE_WIDTH = 200
export const MAX_NODE_WIDTH = 800

export const DEFAULT_MEMO_WIDTH = 400
export const DEFAULT_MEMO_HEIGHT = 300
export const NODE_MEMO_GAP = 8

export const DEFAULT_CLUSTER_PADDING = 32
export const DEFAULT_CLUSTER_MARGIN = 120
export const CLUSTER_HEADER_HEIGHT = 28
export const DEFAULT_CLUSTER_PALETTE = [
  'var(--color-cluster-1)',
  'var(--color-cluster-2)',
  'var(--color-cluster-3)',
  'var(--color-cluster-4)',
  'var(--color-cluster-5)',
  'var(--color-cluster-6)'
] as const
export type ClusterPaletteColor = (typeof DEFAULT_CLUSTER_PALETTE)[number]

export const CLUSTER_CONTAINER_Z_INDEX = 5
export const CLUSTER_PILL_Z_INDEX = 30
export const MAX_CLUSTER_GRID_COLUMNS = 3
export const CLUSTER_ACCENT_BAR_WIDTH_PX = 3.5
export const CLUSTER_LABEL_MAX_WIDTH_PX = 200
export const CLUSTER_PROGRESS_MAX_WIDTH_PX = 260
export const CLUSTER_FILL_OPACITY_PERCENT = 5

// Workspace Document Tool Constants
export const DEFAULT_DOCUMENT_BLOCK_LIMIT = 15
export const MAX_DOCUMENT_BLOCK_LIMIT = 200

export const WORKSPACE_TOOL_NAMES = [
  'readDocument',
  'createDocument',
  'editDocument',
  'leaveComment',
  'listWorkspaceItems',
  'readGraph',
  'writeGraph',
  'writeMindMap',
  'createProject',
  'removeProject',
  'createProjectTool',
  'removeProjectTool',
  'compileGraph',
  'lintWorkspace',
  'ingestSource',
  'queryAndFileBack',
  'pruneLedger'
] as const

export const PRUNE_LEDGER_TOOL_NAME = 'pruneLedger'

export type WorkspaceToolName = (typeof WORKSPACE_TOOL_NAMES)[number]

export function isWorkspaceTool(name?: string): boolean {
  if (!name) return false
  return (WORKSPACE_TOOL_NAMES as readonly string[]).includes(name)
}

// Relational Ledger Constants
export const DEFAULT_RELATIONAL_LEDGER_INSTANCE_ID = 'ledger-default'
export const DEFAULT_RELATIONAL_LEDGER_NAME = 'ledger-default'
export const DEFAULT_RELATIONAL_LEDGER_TYPE = 'ledger'

// Wiki Graph Compilation & Layout Constants
export const DEFAULT_WIKI_NODE_WIDTH = 280
export const DEFAULT_WIKI_NODE_HEIGHT = 160
export const DEFAULT_WIKI_GRID_COLUMNS = 5
export const DEFAULT_WIKI_GRID_COL_WIDTH = 320
export const DEFAULT_WIKI_GRID_ROW_HEIGHT = 220
export const DEFAULT_WIKI_GRID_OFFSET = 50
