// WorkspaceTools.ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { DocumentSchema, type Block, type Comment } from '@workspace/persistence/editorContent'
import { CollarError } from '@shared/errors/CollarError'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import {
  convertBlocksToPatchView,
  convertHtmlToBlocks
} from '@workspace/editor/schemas/htmlContentConversion'
import { PatchCommandEngine } from '@collaragent/runtime'
import { getDocumentPayload } from '@workspace/wstools/getDocument'
import { executeWriteDocument, executeDocumentCommands } from '@workspace/wstools/manageDocument'
import { listDocumentInstances } from '@workspace/wstools/listDocumentInstances'
import { createInstance } from '@workspace/wstools/createDocumentInstance'
import { RelationalLedgerStore } from '@workspace/wiki/RelationalLedgerStore'
import {
  syncDocumentClaimsToLedger,
  extractClaimsFromDocument
} from '@workspace/wiki/LinkExtractor'
import { normalizeEntityTitle } from '@workspace/wiki/L1StructuralLinter'

// Graph Canvas imports
import { executeReadGraph, executeWriteGraph } from '@workspace/wstools/manageGraph'
import { createProject, removeProject } from '@workspace/wstools/manageProject'
import {
  WriteGraphSpecSchema,
  MindMapNodeSchema,
  flattenMindMap,
  DirectionSchema,
  assertUniqueNodeEntities
} from '@workspace/wstools/graphSchemaConverter'
import {
  DEFAULT_DOCUMENT_BLOCK_LIMIT,
  MAX_DOCUMENT_BLOCK_LIMIT,
  WORKSPACE_TOOL_NAMES,
  isWorkspaceTool,
  type WorkspaceToolName
} from '@shared/constants'

export {
  DEFAULT_DOCUMENT_BLOCK_LIMIT,
  MAX_DOCUMENT_BLOCK_LIMIT,
  WORKSPACE_TOOL_NAMES,
  isWorkspaceTool,
  type WorkspaceToolName
}

// ============================================================================
// Constants
// ============================================================================

const EMPTY_PARAGRAPH_BLOCK: Block = {
  type: 'paragraph',
  children: [{ text: '' }]
}

// ============================================================================
// Error Types
// ============================================================================

export class WorkspaceToolError extends Error {
  constructor(
    message: string,
    public readonly code: WorkspaceErrorCode | string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'WorkspaceToolError'
  }
}

class InstanceNotFoundError extends WorkspaceToolError {
  constructor(identifier: string, projectName?: string) {
    const suffix = projectName ? ` in project "${projectName}"` : ''
    super(
      `Instance "${identifier}" not found${suffix}. Use listWorkspaceItems to see available files.`,
      WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND
    )
  }
}

class MultipleInstancesError extends WorkspaceToolError {
  constructor(instanceName: string, matches: InstanceInfo[], projects: ProjectInfo[]) {
    const details = matches
      .map((m) => {
        const pName = projects.find((p) => p.id === m.projectId)?.name || 'Unknown'
        return `ID: "${m.instanceId}" (Project: "${pName}", Type: ${m.type || 'unknown'})`
      })
      .join(', ')
    super(
      `Multiple instances named "${instanceName}" found: [${details}]. Please specify "instanceId" or a specific "projectName" to disambiguate.`,
      WorkspaceErrorCode.WORKSPACE_MULTIPLE_INSTANCES
    )
  }
}

class ProjectNotFoundError extends WorkspaceToolError {
  constructor(projectName: string, availableProjects: string[]) {
    super(
      `Project "${projectName}" not found. Available projects: ${availableProjects.join(', ')}`,
      WorkspaceErrorCode.WORKSPACE_PROJECT_NOT_FOUND
    )
  }
}

// ============================================================================
// Schemas
// ============================================================================

const getDocumentInputSchema = z
  .object({
    instanceId: z
      .string()
      .optional()
      .describe(
        'Optional persistent UUID of the document. If provided, resolves directly without ambiguity.'
      ),
    instanceName: z.string().optional().describe('The name of document.'),
    projectName: z.string().optional().describe('Optional project name.'),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('0-based block index to start reading from (default: 0).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_DOCUMENT_BLOCK_LIMIT)
      .optional()
      .default(DEFAULT_DOCUMENT_BLOCK_LIMIT)
      .describe(
        `Maximum number of blocks to return (default: ${DEFAULT_DOCUMENT_BLOCK_LIMIT}, max: ${MAX_DOCUMENT_BLOCK_LIMIT}). Use to read documents incrementally in chunks.`
      ),
    outlineOnly: z
      .boolean()
      .optional()
      .describe(
        'If true, returns only headings and compact block previews with IDs. Highly token-efficient for discovering block IDs and document structure.'
      ),
    targetBlockId: z
      .string()
      .optional()
      .describe(
        'Optional block ID to anchor reading around. Fetches this target block and immediate surrounding context blocks.'
      ),
    radius: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .default(2)
      .describe('Number of context blocks before and after targetBlockId to include (default: 2).')
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

const listDocumentInstancesInputSchema = z.object({
  instanceName: z
    .string()
    .optional()
    .describe('Optional filter to return only the document matching this name.'),
  projectName: z.string().optional().describe('Optional project name filter.')
})

const createDocumentHtmlSchema = z
  .object({
    html_content: z
      .string()
      .min(1)
      .describe(
        'The full document content as HTML blocks (e.g. <h1>Title</h1><p>Content...</p><table>...</table>). Tabularize 2D data (comparisons, metrics) and use bold lead-ins for list items.'
      ),
    instanceId: z
      .string()
      .optional()
      .describe('Optional persistent UUID if overwriting an existing document.'),
    instanceName: z.string().optional().describe('The name for the new document.'),
    projectName: z
      .string()
      .optional()
      .describe('Optional project name where the document should be created.'),
    allowUnresolvedLinks: z
      .boolean()
      .optional()
      .describe(
        'If true, allows creating wikilinks to documents that do not exist yet. Defaults to false.'
      )
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

const editDocumentSchema = z
  .object({
    instanceId: z.string().optional().describe('Optional persistent UUID of the document.'),
    instanceName: z.string().optional().describe('The document name.'),
    projectName: z.string().optional().describe('Optional project name.'),
    allowUnresolvedLinks: z
      .boolean()
      .optional()
      .describe(
        'If true, allows adding wikilinks to documents that do not exist yet. Defaults to false.'
      ),
    operations: z
      .array(
        z
          .object({
            action: z
              .enum(['update', 'insert', 'delete', 'replace_text'])
              .describe('The action to perform.'),
            blockId: z.string().describe('The target block ID (or anchor ID for insert).'),
            anchor: z
              .enum(['before', 'after'])
              .optional()
              .describe('Placement relative to the blockId. Required only for "insert".'),
            newHtml: z
              .string()
              .optional()
              .describe(
                'The new HTML content. Required for "update" and "insert". Can contain multiple tags.'
              ),
            target: z
              .string()
              .optional()
              .describe(
                'Exact substring within the block to replace. Required for "replace_text".'
              ),
            replacement: z
              .string()
              .optional()
              .describe('Replacement string or HTML snippet. Required for "replace_text".')
          })
          .refine(
            (op) => {
              if (op.action === 'replace_text') return !!(op.target && op.replacement !== undefined)
              if (op.action === 'update') return !!op.newHtml
              if (op.action === 'insert') return !!(op.anchor && op.newHtml)
              return true
            },
            {
              message:
                'Missing required fields: "target" and "replacement" for replace_text; "newHtml" for update; "anchor" and "newHtml" for insert.'
            }
          )
      )
      .min(1)
      .describe('An array of edit operations to apply in order.'),
    explanation: z.string().optional().describe('Optional explanation of the intended change.')
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

// Graph Schemas
const writeMindMapInputSchema = z
  .object({
    instanceId: z
      .string()
      .optional()
      .describe('Optional persistent UUID of the mind map canvas instance.'),
    instanceName: z.string().optional().describe('The name of the mind map canvas instance.'),
    projectName: z.string().optional().describe('Optional project name.'),
    root: MindMapNodeSchema,
    direction: DirectionSchema.default('RADIAL')
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

const readGraphInputSchema = z
  .object({
    instanceId: z
      .string()
      .optional()
      .describe('Optional persistent UUID of the graph canvas instance to read.'),
    instanceName: z.string().optional().describe('The name of the graph canvas instance to read.'),
    projectName: z.string().optional().describe('Optional project name.'),
    includeMemo: z.boolean().optional().describe('If true, include full memo text for each node.')
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

const writeGraphInputSchema = WriteGraphSpecSchema.omit({ instanceId: true, root: true })
  .extend({
    instanceId: z
      .string()
      .optional()
      .describe('Optional persistent UUID of the graph canvas instance.'),
    instanceName: z.string().optional().describe('The name of the graph canvas instance.'),
    projectName: z.string().optional().describe('Optional project name.'),
    direction: z
      .enum(['LR', 'TD'])
      .describe('Layout direction: LR (Left-to-Right) or TD (Top-Down).')
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })

const createProjectInputSchema = z.object({
  name: z.string().min(1).describe('The name of the new project.')
})

const removeProjectInputSchema = z.object({
  name: z.string().min(1).describe('The name of the project to remove.')
})

// ============================================================================
// Types
// ============================================================================

export interface ToolConnectionContext {
  wsPort?: number
  apiPort?: number
  thread_id?: string
  threadId?: string
  ledgerStore?: RelationalLedgerStore
  /** Optional cancellation signal propagated from caller/session lifecycle (equiv. to C# CancellationToken) */
  signal?: AbortSignal
  /** Optional caller-configured network timeout in milliseconds */
  timeoutMs?: number
  /** Optional in-memory WebSocket server handle for transactional persistence flushes */
  wsHandle?: {
    flush: (
      instanceId?: string,
      options?: { signal?: AbortSignal; timeoutMs?: number }
    ) => Promise<void>
  }
  /** When true, adapters and tools execute transactional read barrier flush() before reading */
  flushBeforeRead?: boolean
}

interface ToolConfig {
  configurable?: ToolConnectionContext
}

type ReadDocumentInput = z.infer<typeof getDocumentInputSchema>
type CreateDocumentInput = z.infer<typeof createDocumentHtmlSchema>
type EditDocumentInput = z.infer<typeof editDocumentSchema>

interface InstanceInfo {
  instanceId: string
  name?: string
  projectId?: string
  type?: string
  updatedAt?: string
}

interface ProjectInfo {
  id: string
  name: string
}

interface ListInstancesResult {
  instances: InstanceInfo[]
  projects: ProjectInfo[]
}

export interface ResolvedResource {
  instanceId: string
  name: string
  projectId?: string
}

export interface ResolveResourceOptions {
  instanceId?: string
  instanceName?: string
  projectName?: string
  type?: 'document' | 'canvas'
  context?: ToolConnectionContext
}

export interface DocumentOutlineItem {
  id: string
  type: string
  headingText?: string
  preview: string
}

export interface ReadDocumentSuccessResult {
  status: 'success'
  action: 'Read' | 'Read Outline' | 'Read Target Neighborhood'
  instanceId: string
  instanceName: string
  projectName?: string
  totalBlocks: number
  offset?: number
  limit?: number
  hasMore?: boolean
  nextOffset?: number
  editable_blocks?: Array<{
    id: string
    html: string
  }>
  outline?: DocumentOutlineItem[]
  targetBlockId?: string
  radius?: number
  comments?: Record<string, Comment>
}

export type ReadDocumentResult = ReadDocumentSuccessResult | ReadDocumentErrorResult

interface CreateDocumentResult {
  status: 'success'
  action: 'Created'
  instanceId: string
  instanceName: string
  projectName?: string
  blockCount: number
}

interface EditDocumentErrorResult {
  status: 'error'
  action: 'Failed to edit'
  instanceId?: string
  instanceName?: string
  projectName?: string
  explanation?: string
  code: string
  message: string
  recommendFix?: string
  failedHunk?: number
  failedBlockId?: string
  failedHeader?: string
  // Optional: only populated when the document was successfully fetched before the error
  current_editable_blocks?: Array<{
    id: string
    html: string
  }>
  valid_outline?: DocumentOutlineItem[]
}

interface EditDocumentSuccessResult {
  status: 'success'
  action: 'Applied Patch'
  instanceId: string
  instanceName: string
  projectName?: string
  explanation?: string
  hunksApplied: number
  totalBlocks: number
  commandsEmitted: number
  blocksUpdated: number
  blocksInserted: number
  blocksRemoved: number
  commentsUpdated: number
  diff_view: string
}

export type EditDocumentResult = EditDocumentErrorResult | EditDocumentSuccessResult

export interface ReadDocumentErrorResult {
  status: 'error'
  action: 'Failed to read'
  instanceId?: string
  instanceName?: string
  projectName?: string
  code: string
  message: string
  recommendFix?: string
}

export interface CreateDocumentErrorResult {
  status: 'error'
  action: 'Failed to create'
  instanceId?: string
  instanceName?: string
  projectName?: string
  code: string
  message: string
  recommendFix?: string
}

export interface ListWorkspaceItemsErrorResult {
  status: 'error'
  action: 'Failed to list'
  code: string
  message: string
  recommendFix?: string
}

export interface GraphErrorResult {
  status: 'error'
  action: string
  instanceId?: string
  instanceName?: string
  projectName?: string
  code: string
  message: string
  recommendFix?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensures document has at least one block to prevent empty document errors.
 * If the blocks array is empty, it returns a default paragraph block.
 */
function ensureNonEmptyBlocks(blocks: Block[]): Block[] {
  return blocks.length > 0 ? blocks : [EMPTY_PARAGRAPH_BLOCK]
}

function createBlockId(): string {
  return Math.random().toString(36).substring(2, 11)
}

function createUniqueBlockId(seen: Set<string>): string {
  let nextId = createBlockId()

  while (seen.has(nextId)) {
    nextId = createBlockId()
  }

  return nextId
}

function normalizeWritableBlocks(blocks: Block[]): Block[] {
  const seen = new Set<string>()

  return ensureNonEmptyBlocks(blocks).map((block) => {
    let nextId = block.id

    if (!nextId || seen.has(nextId)) {
      nextId = createUniqueBlockId(seen)
    }

    seen.add(nextId)

    return {
      ...block,
      id: nextId
    }
  })
}

function extractBlockId(line: string): string | undefined {
  const match = line.match(/data-block-id="([^"]+)"/)
  return match?.[1]
}

function stripBlockId(line: string): string {
  return line.replace(/\sdata-block-id="[^"]*"/, '')
}

function extractBlockText(block: Block): string {
  if (typeof block.content === 'string') {
    return block.content.trim()
  }
  if (block.children) {
    return block.children
      .map((c) => c.text || '')
      .join('')
      .trim()
  }
  if (block.type === 'table' && block.tableRows) {
    const rowCount = block.tableRows.length
    const colCount = block.tableRows[0]?.cells?.length ?? 0
    return `[Table: ${rowCount} rows x ${colCount} cols]`
  }
  return ''
}

export function buildDocumentOutline(blocks: Block[]): DocumentOutlineItem[] {
  if (!Array.isArray(blocks)) return []
  return blocks.map((block) => {
    const isHeading = !!(block.type && /^h[1-6]$/.test(block.type))
    const text = extractBlockText(block)
    const preview = text.length > 60 ? `${text.slice(0, 57)}...` : text
    return {
      id: block.id ?? '',
      type: block.type,
      ...(isHeading ? { headingText: text } : {}),
      preview
    }
  })
}

export function buildEditableBlocks(blocks: Block[]): Array<{ id: string; html: string }> {
  if (!Array.isArray(blocks)) {
    throw new WorkspaceToolError(
      'Document payload blocks must be an array.',
      WorkspaceErrorCode.WORKSPACE_PAYLOAD_INVALID
    )
  }

  return blocks.map((block, index) => {
    const blockId = block.id?.trim()
    if (!blockId) {
      throw new WorkspaceToolError(
        `Block at index ${index} (type: ${block.type}) is missing a required block ID.`,
        WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING
      )
    }

    const patchView = convertBlocksToPatchView([block])
    const extractedId = extractBlockId(patchView)
    if (!extractedId) {
      throw new WorkspaceToolError(
        `Failed to encode block identity for block "${blockId}".`,
        WorkspaceErrorCode.WORKSPACE_BLOCK_ENCODING_FAILED
      )
    }

    return {
      id: extractedId,
      html: stripBlockId(patchView)
    }
  })
}

function generateUnifiedDiff(currentPatchView: string, updatedPatchView: string): string {
  const oldLines = currentPatchView.split('\n').filter((l) => l.trim() !== '')
  const newLines = updatedPatchView.split('\n').filter((l) => l.trim() !== '')

  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++
  }

  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--
    newEnd--
  }

  if (start > oldEnd && start > newEnd) return 'No changes detected.'

  const ctx = 2 // Context lines
  const contextStart = Math.max(0, start - ctx)
  const contextOldEnd = Math.min(oldLines.length - 1, oldEnd + ctx)

  const diffLines: string[] = ['[diff_block_start]']
  diffLines.push(`@@ -${start + 1},${oldEnd - start + 1} +${start + 1},${newEnd - start + 1} @@`)

  for (let i = contextStart; i < start; i++) diffLines.push(` ${oldLines[i]}`)
  for (let i = start; i <= oldEnd; i++) diffLines.push(`-${oldLines[i]}`)
  for (let i = start; i <= newEnd; i++) diffLines.push(`+${newLines[i]}`)
  for (let i = oldEnd + 1; i <= contextOldEnd; i++) diffLines.push(` ${oldLines[i]}`)

  diffLines.push('[diff_block_end]')
  return diffLines.join('\n')
}

function getRecommendFix(message: string): string | undefined {
  if (message.includes('both "target" and "replacement" are required')) {
    return 'Both "target" and "replacement" fields are mandatory for replace_text operations.'
  }
  if (message.includes('Target text') && message.includes('was not found')) {
    return 'The target text to replace was not found in the block. Verify exact spelling, spacing, or run readDocument.'
  }
  if (message.includes('newHtml is required')) {
    return 'The "newHtml" field is mandatory for update and insert operations.'
  }
  if (message.includes('anchor is required')) {
    return 'The "anchor" field ("before" or "after") is mandatory for insert operations.'
  }
  if (message.includes('Could not find block')) {
    return 'Re-run readDocument to confirm valid block IDs, or inspect the valid_outline provided in this error response.'
  }
  if (
    message.includes('update newHtml contained no valid blocks') ||
    message.includes('replace_text produced no valid blocks')
  ) {
    return 'The operation produced no valid blocks. Ensure content is wrapped in standard HTML tags such as <p>...</p>.'
  }
  return undefined
}

export function getCodeRecommendFix(code: string): string | undefined {
  switch (code) {
    case 'INSTANCE_NOT_FOUND':
    case WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND:
      return 'Use listWorkspaceItems to see available documents and verify the exact name.'
    case 'PROJECT_NOT_FOUND':
    case WorkspaceErrorCode.WORKSPACE_PROJECT_NOT_FOUND:
      return 'Use listWorkspaceItems to verify available project names.'
    case 'MULTIPLE_INSTANCES':
    case WorkspaceErrorCode.WORKSPACE_MULTIPLE_INSTANCES:
      return 'Provide a more specific projectName to disambiguate the document.'
    case 'CONNECTION_ERROR':
    case WorkspaceErrorCode.WORKSPACE_SYNC_DISCONNECTED:
      return 'The workspace server may be unreachable. Retry the operation.'
    case WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING:
      return 'Document blocks are missing persistent IDs. The document must be saved or normalized.'
    case WorkspaceErrorCode.WORKSPACE_BLOCK_ENCODING_FAILED:
      return 'Failed to encode block identity in patch view. Check block HTML syntax.'
    case WorkspaceErrorCode.WORKSPACE_PAYLOAD_INVALID:
      return 'The document payload structure is invalid. Verify the document format.'
    case WorkspaceErrorCode.WORKSPACE_HTML_EMPTY:
      return 'The provided html_content is empty. Provide standard HTML tags like <h1>, <p>, or <table>.'
    case WorkspaceErrorCode.WORKSPACE_HTML_NO_VALID_BLOCKS:
      return 'The HTML string did not produce any valid blocks. Ensure content is wrapped in standard HTML tags such as <p>...</p> or <table>...</table>.'
    case WorkspaceErrorCode.WORKSPACE_HTML_TABLE_MALFORMED:
      return 'The table markup contains no rows or cells. Ensure <table> contains at least one <tr> with <th> or <td> elements.'

    // Graph Canvas & Diagram Subsystem Recommendations
    case WorkspaceErrorCode.WORKSPACE_GRAPH_NOT_FOUND:
      return 'The requested graph canvas instance does not exist. Use listWorkspaceItems to verify available canvas names.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_SNAPSHOT_FAILED:
      return 'Failed to retrieve the graph canvas snapshot from the server. Ensure the canvas server is reachable and initialized.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_CORRUPTED:
      return 'The graph canvas snapshot contains an invalid or unreadable schema. Re-create or re-initialize the canvas instance.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_SPEC_INVALID:
      return 'The graph specification is invalid. Verify direction (LR/TD/RADIAL), mode (replace/merge), and nodes/edges schemas.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_DUPLICATE_NODE_ALIAS:
      return 'Each node in the "nodes" array must have a unique "entity" alias. Consolidate or rename duplicate entries.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_NODE_ALIAS_COLLISION:
      return 'Multiple entity aliases resolved to the same underlying node ID. Use unique entity names for distinct nodes.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_EDGE_ENDPOINT_UNRESOLVED:
      return 'Edge endpoints must refer to an entity in the "nodes" array or an existing canvas node. Call readGraph first to confirm available entities.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_START_NODE_NOT_FOUND:
      return 'The "startFrom" anchor entity was not found on the canvas. Run readGraph to see existing node entity aliases.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_ROOT_EMPTY:
      return 'The root node of a mind map must have a non-empty "entity" name.'
    case WorkspaceErrorCode.WORKSPACE_GRAPH_MINDMAP_CYCLE_DETECTED:
      return 'Mind maps must be strictly hierarchical trees. Remove circular parent-child references.'
    case WorkspaceErrorCode.WORKSPACE_LAYOUT_COMPUTATION_FAILED:
      return 'Automated graph layout computation failed. Check for cyclic or disconnected node structures.'
    case WorkspaceErrorCode.WORKSPACE_INVALID_CLUSTER_SPEC:
      return 'The clustering specification is invalid. Ensure cluster names and node group assignments are valid strings.'
    case WorkspaceErrorCode.WORKSPACE_CLUSTER_EXECUTION_FAILED:
      return 'Graph clustering algorithm execution failed. Verify graph connectivity and node relationships.'
    case WorkspaceErrorCode.WORKSPACE_CLUSTER_ABORTED:
      return 'Graph clustering operation was aborted or timed out.'

    // Workspace-as-Wiki & Knowledge Compiler Subsystem Recommendations
    case WorkspaceErrorCode.WORKSPACE_WIKI_ENTITY_COLLISION:
      return 'An entity document with this name already exists in the workspace. Choose a different name or edit the existing document.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL:
      return 'The referenced wiki entity does not exist. Create the missing entity document, edit the document to remove the invalid wikilink, or use pruneLedger to clean up obsolete ledger edges.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE:
      return 'Circular supersedence detected in documents. Ensure version/supersedence relationships are strictly acyclic.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_CYCLE_DETECTED:
      return 'A cycle was detected in the relational ledger edges. Ensure hierarchical edges form a directed acyclic graph.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_COMPILATION_FAILED:
      return 'Wiki graph compilation failed. Run lintWorkspace first to identify and resolve structural issues.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA:
      return 'Document link syntax is invalid. Ensure links follow the [[Entity]] or [[Entity#Anchor|Label]] standard.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND:
      return 'The block anchor for this claim was deleted or modified. Edit the source document to restore or update the claim anchor, or use pruneLedger to purge degraded edges.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_EDGE_NOT_FOUND:
      return 'The specified ledger edge ID was not found. Use lintWorkspace to check current edge IDs.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED:
      return 'Relational ledger synchronization failed. Check database permissions and integrity.'
    case WorkspaceErrorCode.WORKSPACE_WIKI_MIGRATION_FAILED:
      return 'Migration of legacy workspace links failed.'
    default:
      return undefined
  }
}

/**
 * Extracts a structured { code, message, recommendFix } from any thrown error.
 * Handles WorkspaceToolError, CollarError (including WorkspaceError), ZodError,
 * and bracketed [CODE] protocol messages.
 */
export function extractErrorInfo(err: unknown): {
  code: string
  message: string
  recommendFix?: string
} {
  if (err instanceof WorkspaceToolError) {
    return {
      code: err.code,
      message: err.message,
      recommendFix: getCodeRecommendFix(err.code)
    }
  }
  if (err instanceof CollarError) {
    return {
      code: err.code,
      message: err.message,
      recommendFix: getCodeRecommendFix(err.code)
    }
  }
  if (err instanceof z.ZodError) {
    const firstIssue = err.issues[0]
    const pathStr = firstIssue?.path?.length ? ` at "${firstIssue.path.join('.')}"` : ''
    const msg = firstIssue
      ? `Schema validation failed${pathStr}: ${firstIssue.message}`
      : err.message
    return {
      code: WorkspaceErrorCode.WORKSPACE_GRAPH_SPEC_INVALID,
      message: msg,
      recommendFix: getCodeRecommendFix(WorkspaceErrorCode.WORKSPACE_GRAPH_SPEC_INVALID)
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  const codeMatch = message.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/)
  if (codeMatch) {
    const code = codeMatch[1]
    const extractedMsg = codeMatch[2] || message
    return {
      code,
      message: extractedMsg,
      recommendFix: getCodeRecommendFix(code)
    }
  }

  return {
    code: 'CONNECTION_ERROR',
    message,
    recommendFix: getCodeRecommendFix('CONNECTION_ERROR')
  }
}

function extractCommentIdsFromBlocks(blocks: Block[]): Set<string> {
  const commentIds = new Set<string>()

  function inspectRuns(runs?: Array<{ commentIds?: string[] }>) {
    if (!runs) return
    for (const run of runs) {
      if (Array.isArray(run.commentIds)) {
        for (const cid of run.commentIds) {
          if (cid) commentIds.add(cid)
        }
      }
    }
  }

  for (const block of blocks) {
    inspectRuns(block.children)
    if (Array.isArray(block.tableRows)) {
      for (const row of block.tableRows) {
        if (Array.isArray(row.cells)) {
          for (const cell of row.cells) {
            inspectRuns(cell.children)
          }
        }
      }
    }
  }

  return commentIds
}

async function readDocumentHandler(
  input: ReadDocumentInput,
  config: ToolConfig
): Promise<ReadDocumentResult> {
  try {
    const context = config.configurable
    const resolved = await resolveResourceId({
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      type: 'document',
      context
    })

    const { payload } = await getDocumentPayload({
      instanceId: resolved.instanceId,
      port: context?.wsPort
    })

    const allBlocks = payload.blocks || []
    const totalBlocks = allBlocks.length

    if (input.outlineOnly) {
      return {
        status: 'success',
        action: 'Read Outline',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        totalBlocks,
        outline: buildDocumentOutline(allBlocks)
      }
    }

    if (input.targetBlockId) {
      const targetIdx = allBlocks.findIndex((b) => b.id === input.targetBlockId)
      if (targetIdx === -1) {
        throw new WorkspaceToolError(
          `Target block "${input.targetBlockId}" not found in document "${resolved.name}".`,
          WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING
        )
      }

      const rad = input.radius ?? 2
      const start = Math.max(0, targetIdx - rad)
      const end = Math.min(totalBlocks, targetIdx + rad + 1)
      const slicedBlocks = allBlocks.slice(start, end)
      const editableBlocks = buildEditableBlocks(slicedBlocks)

      let filteredComments: Record<string, Comment> | undefined
      if (payload.comments) {
        const visibleCommentIds = extractCommentIdsFromBlocks(slicedBlocks)
        const result: Record<string, Comment> = {}
        for (const [id, comment] of Object.entries(payload.comments)) {
          if (visibleCommentIds.has(id)) {
            result[id] = comment
          }
        }
        filteredComments = Object.keys(result).length > 0 ? result : undefined
      }

      return {
        status: 'success',
        action: 'Read Target Neighborhood',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        totalBlocks,
        targetBlockId: input.targetBlockId,
        radius: rad,
        offset: start,
        limit: slicedBlocks.length,
        hasMore: end < totalBlocks,
        nextOffset: end < totalBlocks ? end : undefined,
        editable_blocks: editableBlocks,
        comments: filteredComments
      }
    }

    const offset = Math.max(0, Math.min(input.offset ?? 0, totalBlocks))
    const limit = Math.max(
      1,
      Math.min(input.limit ?? DEFAULT_DOCUMENT_BLOCK_LIMIT, MAX_DOCUMENT_BLOCK_LIMIT)
    )

    const slicedBlocks = allBlocks.slice(offset, offset + limit)
    const hasMore = offset + slicedBlocks.length < totalBlocks
    const nextOffset = hasMore ? offset + slicedBlocks.length : undefined

    const editableBlocks = buildEditableBlocks(slicedBlocks)

    let filteredComments: Record<string, Comment> | undefined
    if (payload.comments) {
      const visibleCommentIds = extractCommentIdsFromBlocks(slicedBlocks)
      const result: Record<string, Comment> = {}
      for (const [id, comment] of Object.entries(payload.comments)) {
        if (visibleCommentIds.has(id)) {
          result[id] = comment
        }
      }
      filteredComments = Object.keys(result).length > 0 ? result : undefined
    }

    return {
      status: 'success',
      action: 'Read',
      instanceId: resolved.instanceId,
      instanceName: resolved.name,
      projectName: input.projectName,
      totalBlocks,
      offset,
      limit,
      hasMore,
      nextOffset,
      editable_blocks: editableBlocks,
      comments: filteredComments
    }
  } catch (err: unknown) {
    const { code, message, recommendFix } = extractErrorInfo(err)
    return {
      status: 'error',
      action: 'Failed to read',
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      code,
      message,
      recommendFix
    }
  }
}

async function createDocumentHandler(
  input: CreateDocumentInput,
  config: ToolConfig
): Promise<CreateDocumentResult | CreateDocumentErrorResult> {
  try {
    const trimmedHtml = input.html_content.trim()
    if (trimmedHtml.length === 0) {
      throw new WorkspaceToolError(
        'html_content must not be empty.',
        WorkspaceErrorCode.WORKSPACE_HTML_EMPTY
      )
    }

    const parsedBlocks = convertHtmlToBlocks(input.html_content)
    if (parsedBlocks.length === 0) {
      throw new WorkspaceToolError(
        'The provided html_content contained no valid HTML blocks.',
        WorkspaceErrorCode.WORKSPACE_HTML_NO_VALID_BLOCKS
      )
    }

    const context = config.configurable
    const resolved = await resolveOrCreateResourceId({
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      type: 'document',
      context
    })

    const safeBlocks = normalizeWritableBlocks(parsedBlocks)
    const payload = DocumentSchema.parse({ blocks: safeBlocks })

    // Flaw #2: Pre-validate extracted claim targets against workspace documents at write time
    const claims = extractClaimsFromDocument(resolved.name, payload)
    if (claims.length > 0 && input.allowUnresolvedLinks !== true) {
      const list = await listDocumentInstances({
        apiPort: context?.apiPort,
        timeoutMs: context?.timeoutMs
      })
      const validDocNames = new Set<string>()
      validDocNames.add(normalizeEntityTitle(resolved.name))
      if (input.instanceName) {
        validDocNames.add(normalizeEntityTitle(input.instanceName))
      }
      for (const inst of list.instances) {
        if (inst.type === 'document') {
          if (inst.name) validDocNames.add(normalizeEntityTitle(inst.name))
          validDocNames.add(normalizeEntityTitle(inst.instanceId))
        }
      }

      for (const claim of claims) {
        const targetNorm = normalizeEntityTitle(claim.targetEntityId)
        if (!validDocNames.has(targetNorm)) {
          throw new WorkspaceToolError(
            `Cannot link to target "${claim.targetEntityId}": no corresponding document exists in workspace. Create document "${claim.targetEntityId}" first, or pass allowUnresolvedLinks: true.`,
            WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
            { details: { targetEntityId: claim.targetEntityId, rel: claim.rel } }
          )
        }
      }
    }

    await executeWriteDocument({
      payload,
      instanceId: resolved.instanceId,
      wsPort: context?.wsPort,
      threadId: context?.thread_id || context?.threadId,
      staged: false
    })

    const ledgerStore = context?.ledgerStore ?? new RelationalLedgerStore()
    syncDocumentClaimsToLedger(resolved.name, payload, ledgerStore)

    return {
      status: 'success',
      action: 'Created',
      instanceId: resolved.instanceId,
      instanceName: resolved.name,
      projectName: input.projectName,
      blockCount: safeBlocks.length
    }
  } catch (err: unknown) {
    const { code, message, recommendFix } = extractErrorInfo(err)
    return {
      status: 'error',
      action: 'Failed to create',
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      code,
      message,
      recommendFix
    }
  }
}

async function editDocumentHandler(
  input: EditDocumentInput,
  config: ToolConfig
): Promise<EditDocumentResult> {
  try {
    const context = config.configurable
    const resolved = await resolveResourceId({
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      type: 'document',
      context
    })

    const { payload } = await getDocumentPayload({
      instanceId: resolved.instanceId,
      port: context?.wsPort
    })

    const currentPatchView = convertBlocksToPatchView(payload.blocks)
    const compiled = PatchCommandEngine.compile(currentPatchView, input.operations)

    if (!compiled.applied) {
      const isContextMismatch = compiled.code === 'PATCH_CONTEXT_MISMATCH'
      const failedHunkOp = input.operations[compiled.hunkIndex ?? 0]
      const failedBlockId = failedHunkOp?.blockId

      return {
        status: 'error',
        action: 'Failed to edit',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        explanation: input.explanation,
        code: compiled.code,
        message: compiled.message,
        recommendFix: getRecommendFix(compiled.message),
        failedHunk: compiled.hunkIndex,
        failedBlockId,
        // On context mismatch, provide compact structural outline rather than dumping all raw block HTML
        ...(isContextMismatch ? { valid_outline: buildDocumentOutline(payload.blocks) } : {})
      }
    }

    const updatedBlocks = convertHtmlToBlocks(compiled.updatedContent)
    const updatedPayload = DocumentSchema.parse({ blocks: normalizeWritableBlocks(updatedBlocks) })

    // Flaw #2: Pre-validate extracted claim targets against workspace documents at edit time
    const claims = extractClaimsFromDocument(resolved.name, updatedPayload)
    if (claims.length > 0 && input.allowUnresolvedLinks !== true) {
      const list = await listDocumentInstances({
        apiPort: context?.apiPort,
        timeoutMs: context?.timeoutMs
      })
      const validDocNames = new Set<string>()
      validDocNames.add(normalizeEntityTitle(resolved.name))
      if (input.instanceName) {
        validDocNames.add(normalizeEntityTitle(input.instanceName))
      }
      for (const inst of list.instances) {
        if (inst.type === 'document') {
          if (inst.name) validDocNames.add(normalizeEntityTitle(inst.name))
          validDocNames.add(normalizeEntityTitle(inst.instanceId))
        }
      }

      for (const claim of claims) {
        const targetNorm = normalizeEntityTitle(claim.targetEntityId)
        if (!validDocNames.has(targetNorm)) {
          throw new WorkspaceToolError(
            `Cannot link to target "${claim.targetEntityId}": no corresponding document exists in workspace. Create document "${claim.targetEntityId}" first, or pass allowUnresolvedLinks: true.`,
            WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
            { details: { targetEntityId: claim.targetEntityId, rel: claim.rel } }
          )
        }
      }
    }

    await executeDocumentCommands({
      commands: compiled.commands,
      instanceId: resolved.instanceId,
      wsPort: context?.wsPort,
      threadId: context?.thread_id || context?.threadId,
      staged: false
    })

    const ledgerStore = context?.ledgerStore ?? new RelationalLedgerStore()
    syncDocumentClaimsToLedger(resolved.name, updatedPayload, ledgerStore)

    const diffViewSnippet = generateUnifiedDiff(currentPatchView, compiled.updatedContent)

    return {
      status: 'success',
      action: 'Applied Patch',
      instanceId: resolved.instanceId,
      instanceName: resolved.name,
      projectName: input.projectName,
      explanation: input.explanation,
      hunksApplied: compiled.stats.hunksApplied,
      totalBlocks: compiled.updatedLines.length,
      commandsEmitted: compiled.commands.length,
      blocksUpdated: compiled.stats.blocksUpdated,
      blocksInserted: compiled.stats.blocksInserted,
      blocksRemoved: compiled.stats.blocksRemoved,
      commentsUpdated: 0,
      diff_view: diffViewSnippet
    }
  } catch (err: unknown) {
    const { code, message, recommendFix } = extractErrorInfo(err)
    return {
      status: 'error',
      action: 'Failed to edit',
      instanceId: input.instanceId,
      instanceName: input.instanceName,
      projectName: input.projectName,
      explanation: input.explanation,
      code,
      message,
      recommendFix
    }
  }
}

// ============================================================================
// Resolution Logic
// ============================================================================

/**
 * Fetches the raw list of all instances and projects from the backend.
 * Uses the provided context for port information in multi-window/session environments.
 * Ensures ports are correctly typed as strings for the connection layer.
 */
async function fetchInstancesAndProjects(
  context?: ToolConnectionContext
): Promise<ListInstancesResult> {
  const result = await listDocumentInstances({
    apiPort: context?.apiPort,
    port: context?.wsPort
  })

  return {
    instances: result.instances as InstanceInfo[],
    projects: result.projects as ProjectInfo[]
  }
}

/**
 * Searches for a project by its human-readable name.
 */
function findProjectByName(projects: ProjectInfo[], projectName: string): ProjectInfo | undefined {
  return projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase())
}

/**
 * Filters instances based on name and optionally project scope and resource type.
 */
function filterInstances(
  instances: InstanceInfo[],
  instanceName: string,
  projectId?: string,
  type?: 'document' | 'canvas'
): InstanceInfo[] {
  return instances.filter(
    (i) =>
      i.name?.toLowerCase() === instanceName.toLowerCase() &&
      (!projectId || i.projectId === projectId) &&
      (!type || i.type === type)
  )
}

/**
 * Resolves a resource identifier (instanceId or instanceName + optional projectName/type) to its persistent UUID.
 *
 * Logic Flow:
 * 1. Fetches all instances and projects.
 * 2. If instanceId is provided, looks up by ID directly and verifies type if specified.
 * 3. If projectName is provided, resolves it to a projectId or throws PROJECT_NOT_FOUND.
 * 4. Filters instances by name, projectId, and type.
 * 5. Throws INSTANCE_NOT_FOUND if no match.
 * 6. Throws MULTIPLE_INSTANCES with candidate details if ambiguity persists.
 */
async function resolveResourceId(options: ResolveResourceOptions): Promise<ResolvedResource> {
  const { instanceId, instanceName, projectName, type, context } = options
  const { instances, projects } = await fetchInstancesAndProjects(context)

  // 1. Direct UUID resolution
  if (instanceId) {
    const directMatch = instances.find((i) => i.instanceId === instanceId)
    if (!directMatch) {
      throw new InstanceNotFoundError(instanceId, projectName)
    }
    if (type && directMatch.type && directMatch.type !== type) {
      throw new WorkspaceToolError(
        `Instance "${instanceId}" is a ${directMatch.type}, but expected a ${type}.`,
        WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND
      )
    }
    return {
      instanceId: directMatch.instanceId,
      name: directMatch.name || directMatch.instanceId,
      projectId: directMatch.projectId
    }
  }

  // 2. Name-based resolution
  if (!instanceName) {
    throw new WorkspaceToolError(
      'Either instanceId or instanceName must be provided.',
      WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND
    )
  }

  let projectFilterId: string | undefined
  if (projectName) {
    const project = findProjectByName(projects, projectName)
    if (!project) {
      throw new ProjectNotFoundError(
        projectName,
        projects.map((p) => p.name)
      )
    }
    projectFilterId = project.id
  }

  const matches = filterInstances(instances, instanceName, projectFilterId, type)

  if (matches.length === 0) {
    throw new InstanceNotFoundError(instanceName, projectName)
  }

  if (matches.length > 1) {
    throw new MultipleInstancesError(instanceName, matches, projects)
  }

  const match = matches[0]
  return {
    instanceId: match.instanceId,
    name: match.name || instanceName,
    projectId: match.projectId
  }
}

/**
 * Resolves a resource identifier to a UUID, or performs an "upsert-like" creation.
 *
 * If the resource exists within the specified (or default) project, returns its ID.
 * If not, it provisions a new instance of the requested type via REST API.
 */
async function resolveOrCreateResourceId(options: {
  instanceId?: string
  instanceName?: string
  projectName?: string
  type: 'document' | 'canvas'
  context?: ToolConnectionContext
}): Promise<ResolvedResource> {
  try {
    const existing = await resolveResourceId(options)
    return existing
  } catch (error) {
    if (error instanceof InstanceNotFoundError && !options.instanceId && options.instanceName) {
      const { projects } = await fetchInstancesAndProjects(options.context)

      const targetProject = options.projectName
        ? findProjectByName(projects, options.projectName)
        : projects[0]

      if (!targetProject) {
        throw new ProjectNotFoundError(
          options.projectName || 'default',
          projects.map((p) => p.name)
        )
      }

      const createdInstanceId = await createInstance({
        name: options.instanceName,
        projectId: targetProject.id,
        type: options.type,
        apiPort: options.context?.apiPort
      })

      return {
        instanceId: createdInstanceId,
        name: options.instanceName,
        projectId: targetProject.id
      }
    }
    throw error
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * readDocument - LangChain Tool
 * Retrieves the full content of a Lexical document as HTML.
 * Automatically resolves the human-readable name to a UUID.
 */
export const readDocument = tool(readDocumentHandler, {
  name: 'readDocument',
  description: `Read a document and return its content as editable blocks and associated comments. Supports pagination ('offset'/'limit'), structural discovery ('outlineOnly'), and anchored neighborhood reading ('targetBlockId'/'radius').

Modes:
- outlineOnly: Set outlineOnly: true to retrieve headings and short previews with block IDs. Use this first to locate sections and block IDs with minimal token usage.
- targetBlockId: Pass targetBlockId (and optional radius: 2) to read only that block and immediate surrounding context.
- pagination: Read sequentially in chunks using 'offset' and 'limit'. When 'hasMore' is true, call again with 'offset' set to 'nextOffset'.

Output:
- editable_blocks: Array of { id: string, html: string }. Use these stable block IDs for editDocument patches.
- outline: Array of { id, type, headingText?, preview } when outlineOnly: true.
- comments: Record of comment metadata referenced by <span data-comment-ids="..."> in returned blocks.
- wikilinks: Entity relationships appear as [[<relation>:<targetEntity>|<justification>]].`,
  schema: getDocumentInputSchema
})

/**
 * createDocument - LangChain Tool
 * Creates or completely overwrites a document using HTML input.
 * If the document name does not exist, it is provisioned in the requested project.
 */
export const createDocument = tool(createDocumentHandler, {
  name: 'createDocument',
  description: `Create a new document (or completely replace an existing one) using semantic HTML.

Structure Guidelines:
- Tags: <h1>-<h4>, <p>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <b>, <i>, <u>, <br>.
- Tables: Multi-attribute comparisons, metrics, and parameters belong in <table> with <thead> and <td><b>Key</b></td>.
- Lists: Parallel points belong in <ul>/<li> with bold lead-ins (<li><b>Label:</b> Description</li>).
- Narrative Prose: Use <p> for cohesive conceptual synthesis (one central thesis per paragraph).

Wikilinks & Relational Ledger:
- Syntax: [[<relation>:<targetEntity>|<justification>]] or [[<relation>:<targetEntity>]].
- Supported relations: 'supports', 'contradicts', 'supersedes', 'details', 'derived_from', 'cites', 'relates_to'.
- Embedded wikilinks automatically extract into the Relational Ledger and project onto the Concept Canvas.`,
  schema: createDocumentHtmlSchema
})

/**
 * editDocument - LangChain Tool
 * Performs granular block-level updates (edit, delete, split) on a document.
 * This is the preferred tool for modifications to existing documents.
 */
export const editDocument = tool(editDocumentHandler, {
  name: 'editDocument',
  description: `Edit an existing document using granular block operations. Call readDocument first to obtain valid block IDs.

Operations:
- replace_text: Surgically replaces a specific substring within a block. Requires 'blockId', 'target', and 'replacement'. Highly recommended for minor edits, typo fixes, or metric updates (saves 90%+ tokens).
- update: Replaces entire block at 'blockId' with 'newHtml' (can contain multiple sequential HTML tags).
- insert: Inserts 'newHtml' 'before' or 'after' the specified 'blockId'.
- delete: Removes the block at 'blockId'.

Rules:
- Batching: Combine all operations (replace_text, update, insert, delete) for a document into a single tool call.
- Valid HTML: Use semantic tags (<h1>-<h4>, <p>, <ul>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <b>, <i>). Keep comparisons in <table> and bold lead-ins in <li>.
- Wikilinks: Embed [[<relation>:<targetEntity>|<justification>]] to update Relational Ledger edges and Concept Canvas projections.

Examples:
1. Surgical text replacement:
{
  "instanceName": "Doc-Name",
  "operations": [
    { "action": "replace_text", "blockId": "k9f2x8z1a", "target": "old text", "replacement": "new text" }
  ]
}
2. Block replacement and insertion:
{
  "instanceName": "Doc-Name",
  "operations": [
    { "action": "update", "blockId": "k9f2x8z1a", "newHtml": "<p>Updated text</p>" },
    { "action": "insert", "blockId": "k9f2x8z1a", "anchor": "after", "newHtml": "<table>...</table>" },
    { "action": "delete", "blockId": "m4n5p6q7r" }
  ]
}`,
  schema: editDocumentSchema
})

/**
 * listWorkspaceItems - LangChain Tool
 * Provides a discovery layer for the agent to see which documents and canvases
 * exist across various projects.
 */
export const listWorkspaceItems = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    try {
      const { instances, projects } = await fetchInstancesAndProjects(context)

      const filtered = instances.filter((i) => {
        // Exclude internal ledger instances and hidden items
        if (i.type === 'ledger') return false
        if (i.name === 'ledger-default' || i.instanceId === 'ledger-default') return false
        if ((i as { metadata?: { isHidden?: boolean } }).metadata?.isHidden) return false

        let match = true
        if (input.instanceName) {
          match = match && !!i.name?.toLowerCase().includes(input.instanceName.toLowerCase())
        }
        if (input.projectName) {
          const project = findProjectByName(projects, input.projectName)
          match = match && i.projectId === project?.id
        }
        return match
      })

      const formatted = filtered.map((i) => {
        const project = projects.find((p) => p.id === i.projectId)
        return {
          instanceId: i.instanceId,
          name: i.name,
          project: project?.name,
          type: i.type
        }
      })

      return {
        status: 'success' as const,
        action: 'Listed',
        count: formatted.length,
        items: formatted
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to list',
        code,
        message,
        recommendFix
      } satisfies ListWorkspaceItemsErrorResult
    }
  },
  {
    name: 'listWorkspaceItems',
    description:
      'Get a list of all available workspace items (documents and canvases). Returns instanceId, names, project names, and types.',
    schema: listDocumentInstancesInputSchema
  }
)

export const readGraph = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    try {
      const resolved = await resolveResourceId({
        instanceId: input.instanceId,
        instanceName: input.instanceName,
        projectName: input.projectName,
        type: 'canvas',
        context
      })

      const result = await executeReadGraph({
        instanceId: resolved.instanceId,
        wsPort: context?.wsPort,
        includeMemo: input.includeMemo
      })

      return {
        status: 'success' as const,
        action: 'Read Graph',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        groups: result.groups,
        nodes: result.nodes,
        edges: result.edges
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to read graph',
        instanceId: input.instanceId,
        instanceName: input.instanceName,
        projectName: input.projectName,
        code,
        message,
        recommendFix
      } satisfies GraphErrorResult
    }
  },
  {
    name: 'readGraph',
    description:
      'Read the full state of a graph canvas. Returns node display names and edge relationships by their readable entities.',
    schema: readGraphInputSchema
  }
)

/**
 * writeGraph - LangChain Tool
 * The primary entry point for managing knowledge graphs.
 * Handles layout (TD/LR), merging, and automatic document provisioning.
 */
export const writeGraph = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    const { instanceId, instanceName, projectName, ...spec } = input

    try {
      const resolved = await resolveOrCreateResourceId({
        instanceId,
        instanceName,
        projectName,
        type: 'canvas',
        context
      })

      const nodesToResolve = spec.nodes || []
      const edgesToUse = spec.edges || []

      assertUniqueNodeEntities(nodesToResolve)

      const result = await executeWriteGraph({
        ...spec,
        // Overwrite the nodes and edges with the fully flattened & resolved ones
        nodes: nodesToResolve,
        edges: edgesToUse,
        instanceId: resolved.instanceId,
        wsPort: context?.wsPort,
        apiPort: context?.apiPort,
        threadId: context?.thread_id || context?.threadId,
        staged: false,
        ledgerStore: context?.ledgerStore ?? new RelationalLedgerStore()
      })

      return {
        status: result.status,
        action: 'Wrote Graph',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        nodeCount: nodesToResolve.length,
        edgeCount: edgesToUse.length
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to write graph',
        instanceId,
        instanceName,
        projectName,
        code,
        message,
        recommendFix
      } satisfies GraphErrorResult
    }
  },
  {
    name: 'writeGraph',
    description: `Declaratively create, merge, or update a knowledge graph canvas. Canvas edges automatically synchronize with the Relational Ledger.

Parameters & Invariants:
- entity: Unique identifier for each node (matches a document name). Call readGraph first to inspect existing aliases.
- mode: "replace" (overwrites canvas with provided nodes/edges) or "merge" (extends canvas, optionally anchored with 'startFrom', or removes via 'deleteNodes'/'deleteEdges').
- direction: "LR" (left-to-right) or "TD" (top-down).
- edges: 'from' and 'to' must reference valid entity aliases in 'nodes' or existing on canvas.
- memo: Optional Markdown description for each node.

Example:
{
  "instanceName": "System-Architecture",
  "direction": "LR",
  "nodes": [{ "entity": "ServiceA" }, { "entity": "ServiceB" }],
  "edges": [{ "from": "ServiceA", "to": "ServiceB", "label": "calls" }]
}`,
    schema: writeGraphInputSchema
  }
)

export const writeMindMap = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    const { instanceId, instanceName, projectName, root, direction } = input

    try {
      const resolved = await resolveOrCreateResourceId({
        instanceId,
        instanceName,
        projectName,
        type: 'canvas',
        context
      })

      // Flatten the hierarchical mind map into flat nodes and edges
      const { nodes, edges } = flattenMindMap(root)

      assertUniqueNodeEntities(nodes)

      const result = await executeWriteGraph({
        mode: 'replace', // Mind maps usually replace the whole view for consistency
        direction,
        nodes,
        edges,
        instanceId: resolved.instanceId,
        wsPort: context?.wsPort,
        apiPort: context?.apiPort,
        threadId: context?.thread_id || context?.threadId,
        staged: false,
        ledgerStore: context?.ledgerStore ?? new RelationalLedgerStore()
      })

      return {
        status: result.status,
        action: 'Wrote Mind Map',
        instanceId: resolved.instanceId,
        instanceName: resolved.name,
        projectName: input.projectName,
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to write mind map',
        instanceId,
        instanceName,
        projectName,
        code,
        message,
        recommendFix
      } satisfies GraphErrorResult
    }
  },
  {
    name: 'writeMindMap',
    description: `Create a hierarchical mind map on a canvas from a recursive tree.

Input Schema:
- root: Recursive node { entity: string, memo?: string, children?: [...] }.
- direction: Optional "LR" or "TD".
Automatically calculates ports, layout, and canvas links without manual edge definitions.

Example:
{
  "instanceName": "System-Overview",
  "root": {
    "entity": "Core",
    "children": [{ "entity": "ModuleA" }, { "entity": "ModuleB" }]
  }
}`,
    schema: writeMindMapInputSchema
  }
)

export const createProjectTool = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    const projectId = await createProject({
      name: input.name,
      apiPort: context?.apiPort
    })

    return {
      status: 'success',
      action: 'Created Project',
      projectName: input.name,
      projectId
    }
  },
  {
    name: 'createProject',
    description:
      'Create a new project workspace. Projects effectively isolate documents and graphs.',
    schema: createProjectInputSchema
  }
)

export const removeProjectTool = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    await removeProject({
      name: input.name,
      apiPort: context?.apiPort
    })

    return {
      status: 'success',
      action: 'Removed Project',
      projectName: input.name
    }
  },
  {
    name: 'removeProject',
    description:
      'Remove an existing project namespace and all its contents (documents, graphs, etc). BE CAREFUL.',
    schema: removeProjectInputSchema
  }
)
