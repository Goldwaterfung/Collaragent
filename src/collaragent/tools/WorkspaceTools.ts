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
    public readonly code: WorkspaceErrorCode | string
  ) {
    super(message)
    this.name = 'WorkspaceToolError'
  }
}

class InstanceNotFoundError extends WorkspaceToolError {
  constructor(instanceName: string, projectName?: string) {
    const suffix = projectName ? ` in project "${projectName}"` : ''
    super(
      `Instance "${instanceName}" not found${suffix}. Use listWorkspaceItems to see available files.`,
      WorkspaceErrorCode.WORKSPACE_INSTANCE_NOT_FOUND
    )
  }
}

class MultipleInstancesError extends WorkspaceToolError {
  constructor(instanceName: string, projectNames: string[]) {
    super(
      `Multiple instances named "${instanceName}" found in projects: ${projectNames.join(', ')}. Please specify a projectName.`,
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

const getDocumentInputSchema = z.object({
  instanceName: z.string().min(1).describe('The name of document.'),
  projectName: z.string().optional().describe('Optional project name.')
})

const listDocumentInstancesInputSchema = z.object({
  instanceName: z
    .string()
    .optional()
    .describe('Optional filter to return only the document matching this name.'),
  projectName: z.string().optional().describe('Optional project name filter.')
})

const createDocumentHtmlSchema = z.object({
  html_content: z
    .string()
    .min(1)
    .describe(
      'The full document content as HTML blocks (e.g. <h1>Title</h1><p>Content...</p><table>...</table>). Tabularize 2D data (comparisons, metrics) and use bold lead-ins for list items.'
    ),
  instanceName: z.string().min(1).describe('The name for the new document.'),
  projectName: z
    .string()
    .optional()
    .describe('Optional project name where the document should be created.')
})

const editDocumentSchema = z.object({
  instanceName: z.string().min(1).describe('The document name.'),
  projectName: z.string().optional().describe('Optional project name.'),
  operations: z
    .array(
      z.object({
        action: z.enum(['update', 'insert', 'delete']).describe('The action to perform.'),
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
          )
      })
    )
    .min(1)
    .describe('An array of edit operations to apply in order.'),
  explanation: z.string().optional().describe('Optional explanation of the intended change.')
})

// Graph Schemas
const writeMindMapInputSchema = z.object({
  instanceName: z.string().min(1).describe('The name of the mind map canvas instance.'),
  projectName: z.string().optional().describe('Optional project name.'),
  root: MindMapNodeSchema,
  direction: DirectionSchema.default('RADIAL')
})

const readGraphInputSchema = z.object({
  instanceName: z.string().min(1).describe('The name of the graph canvas instance to read.'),
  projectName: z.string().optional().describe('Optional project name.'),
  includeMemo: z.boolean().optional().describe('If true, include full memo text for each node.')
})

const writeGraphInputSchema = WriteGraphSpecSchema.omit({ instanceId: true, root: true }).extend({
  instanceName: z.string().min(1).describe('The name of the graph canvas instance.'),
  projectName: z.string().optional().describe('Optional project name.'),
  direction: z.enum(['LR', 'TD']).describe('Layout direction: LR (Left-to-Right) or TD (Top-Down).')
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

interface ReadDocumentResult {
  status: 'success'
  action: 'Read'
  instanceName: string
  projectName?: string
  editable_blocks: Array<{
    id: string
    html: string
  }>
  comments?: Record<string, Comment>
}

interface CreateDocumentResult {
  status: 'success'
  action: 'Created'
  instanceName: string
  projectName?: string
  blockCount: number
}

interface EditDocumentErrorResult {
  status: 'error'
  action: 'Failed to edit'
  instanceName: string
  projectName?: string
  explanation?: string
  code: string
  message: string
  recommendFix?: string
  failedHunk?: number
  failedHeader?: string
  // Optional: only populated when the document was successfully fetched before the error
  current_editable_blocks?: Array<{
    id: string
    html: string
  }>
}

interface EditDocumentSuccessResult {
  status: 'success'
  action: 'Applied Patch'
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
  instanceName: string
  projectName?: string
  code: string
  message: string
  recommendFix?: string
}

export interface CreateDocumentErrorResult {
  status: 'error'
  action: 'Failed to create'
  instanceName: string
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
  instanceName: string
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
  if (message.includes('newHtml is required')) {
    return 'The "newHtml" field is mandatory for update and insert operations.'
  }
  if (message.includes('anchor is required')) {
    return 'The "anchor" field ("before" or "after") is mandatory for insert operations.'
  }
  if (message.includes('Could not find block')) {
    return 'Re-run readDocument to confirm valid block IDs. The targeted block may have been deleted or moved.'
  }
  if (message.includes('update newHtml contained no valid blocks')) {
    return 'The "newHtml" string must contain at least one valid HTML tag (e.g. <p>...</p>).'
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

async function readDocumentHandler(
  input: ReadDocumentInput,
  config: ToolConfig
): Promise<ReadDocumentResult | ReadDocumentErrorResult> {
  try {
    const context = config.configurable
    const uuid = await resolveResourceId(input.instanceName, input.projectName, context)

    const { payload } = await getDocumentPayload({
      instanceId: uuid,
      port: context?.wsPort
    })

    const editableBlocks = buildEditableBlocks(payload.blocks)

    return {
      status: 'success',
      action: 'Read',
      instanceName: input.instanceName,
      projectName: input.projectName,
      editable_blocks: editableBlocks,
      comments: payload.comments
    }
  } catch (err: unknown) {
    const { code, message, recommendFix } = extractErrorInfo(err)
    return {
      status: 'error',
      action: 'Failed to read',
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
    const uuid = await resolveOrCreateResourceId(
      input.instanceName,
      input.projectName,
      'document',
      context
    )

    const safeBlocks = normalizeWritableBlocks(parsedBlocks)
    const payload = DocumentSchema.parse({ blocks: safeBlocks })

    await executeWriteDocument({
      payload,
      instanceId: uuid,
      wsPort: context?.wsPort
    })

    return {
      status: 'success',
      action: 'Created',
      instanceName: input.instanceName,
      projectName: input.projectName,
      blockCount: safeBlocks.length
    }
  } catch (err: unknown) {
    const { code, message, recommendFix } = extractErrorInfo(err)
    return {
      status: 'error',
      action: 'Failed to create',
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
    const uuid = await resolveResourceId(input.instanceName, input.projectName, context)

    const { payload } = await getDocumentPayload({
      instanceId: uuid,
      port: context?.wsPort
    })

    const currentPatchView = convertBlocksToPatchView(payload.blocks)
    const compiled = PatchCommandEngine.compile(currentPatchView, input.operations)

    if (!compiled.applied) {
      return {
        status: 'error',
        action: 'Failed to edit',
        instanceName: input.instanceName,
        projectName: input.projectName,
        explanation: input.explanation,
        code: compiled.code,
        message: compiled.message,
        recommendFix: getRecommendFix(compiled.message),
        failedHunk: compiled.hunkIndex,
        current_editable_blocks: buildEditableBlocks(payload.blocks)
      }
    }

    await executeDocumentCommands({
      commands: compiled.commands,
      instanceId: uuid,
      wsPort: context?.wsPort
    })

    const diffViewSnippet = generateUnifiedDiff(currentPatchView, compiled.updatedContent)

    return {
      status: 'success',
      action: 'Applied Patch',
      instanceName: input.instanceName,
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
 * Filters instances based on name and optionally project scope.
 */
function filterInstances(
  instances: InstanceInfo[],
  instanceName: string,
  projectId?: string
): InstanceInfo[] {
  return instances.filter(
    (i) =>
      i.name?.toLowerCase() === instanceName.toLowerCase() &&
      (!projectId || i.projectId === projectId)
  )
}

/**
 * Resolves a human-readable instance name (and optional project name) to its persistent UUID.
 *
 * Logic Flow:
 * 1. Fetches all instances and projects.
 * 2. If projectName is provided, resolves it to a projectId or throws PROJECT_NOT_FOUND.
 * 3. Filters instances by name (and projectId if available).
 * 4. Throws INSTANCE_NOT_FOUND if no match.
 * 5. Throws MULTIPLE_INSTANCES if ambiguity persists (matching names in different projects).
 */
async function resolveResourceId(
  instanceName: string,
  projectName?: string,
  context?: ToolConnectionContext
): Promise<string> {
  const { instances, projects } = await fetchInstancesAndProjects(context)

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

  const matches = filterInstances(instances, instanceName, projectFilterId)

  if (matches.length === 0) {
    throw new InstanceNotFoundError(instanceName, projectName)
  }

  if (matches.length > 1) {
    const projectNames = matches.map(
      (m) => projects.find((p) => p.id === m.projectId)?.name || 'Unknown'
    )
    throw new MultipleInstancesError(instanceName, projectNames)
  }

  return matches[0].instanceId
}

/**
 * Resolves a resource name to a UUID, or performs an "upsert-like" creation.
 *
 * If the resource exists within the specified (or default) project, returns its ID.
 * If not, it provisions a new instance of the requested type via REST API.
 */
async function resolveOrCreateResourceId(
  instanceName: string,
  projectName?: string,
  type: 'document' | 'canvas' = 'document',
  context?: ToolConnectionContext
): Promise<string> {
  try {
    const existingId = await resolveResourceId(instanceName, projectName, context)
    return existingId
  } catch (error) {
    if (error instanceof InstanceNotFoundError) {
      const { projects } = await fetchInstancesAndProjects(context)

      const targetProject = projectName ? findProjectByName(projects, projectName) : projects[0]

      if (!targetProject) {
        throw new ProjectNotFoundError(
          projectName || 'default',
          projects.map((p) => p.name)
        )
      }

      const createdInstanceId = await createInstance({
        name: instanceName,
        projectId: targetProject.id,
        type,
        apiPort: context?.apiPort
      })

      return createdInstanceId
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
  description: `Read a document and return its content as a list of editable blocks and associated comments.

The editable_blocks are the preferred source for editDocument patches. Each item contains:
- id: the stable block ID
- html: the exact current block HTML without data-block-id attributes.

If a block contains comment references, they will appear in the HTML as <span data-comment-ids="c1,c2">text</span>. 
The actual content of these comments is provided in the 'comments' record.

Example editable_blocks:
[
  { "id": "abc123", "html": "<h1>My Document</h1>" },
  { "id": "xyz789", "html": "<p>This is a section <span data-comment-ids=\"c1\">with a comment</span>.</p>" }
]

Example comments:
{
  "c1": { "id": "c1", "author": "Alice", "content": "This needs more detail." }
}`,
  schema: getDocumentInputSchema
})

/**
 * createDocument - LangChain Tool
 * Creates or completely overwrites a document using HTML input.
 * If the document name does not exist, it is provisioned in the requested project.
 */
export const createDocument = tool(createDocumentHandler, {
  name: 'createDocument',
  description: `Create a new document (or completely replace an existing one) using standard HTML tags.

Supported tags: <h1>, <h2>, <h3>, <h4>, <ul>, <ol>, <li>, <p>, <br>, <table>, <thead>, <tbody>, <tfoot>, <tr>, <th>, <td>.
Supported styles: <b>, <i>, <u>; style="text-align: center|right"; colspan, rowspan, background-color.

Each top-level HTML tag (like <p> or <h2> or <table>) becomes a separate block in the document.

DOCUMENT STRUCTURE GUIDELINES:
• Extract 2D Data to Tables: Comparisons, timelines, options, and metrics belong in <table> with <thead> and <th>. Bold row keys in <td><b>Key</b></td>.
• High-Density Lists: Use <ul>/<li> with a 2-4 word bold lead-in phrase (<li><b>Label:</b> description</li>) for parallel points.
• Narrative Cohesion: Use <p> for continuous conceptual reasoning and synthesis. Preserve thematic unity (one core idea per paragraph); do not bury tabular data in prose.
For comprehensive layouts, refer to the 'workspace-document-presentation' skill.

Example Input:
{
  "instanceName": "Storage-Engine-Evaluation",
  "html_content": "<h2>Storage Engine Evaluation</h2><p>This evaluation benchmarks relational and sharded key-value engines for local document persistence, focusing on retrieval latency and cross-process concurrency guarantees.</p><table><thead><tr><th>Engine</th><th>Read Latency</th><th>Concurrency</th><th>Assessment</th></tr></thead><tbody><tr><td><b>SQLite (WAL)</b></td><td>&lt;2ms</td><td>Multi-reader, single-writer</td><td>Recommended for metadata</td></tr><tr><td><b>Sharded MsgPack</b></td><td>&lt;1ms</td><td>Process-isolated shards</td><td>Optimal for binary snapshots</td></tr></tbody></table><h3>Selection Criteria</h3><ul><li><b>Throughput Resilience:</b> Must handle rapid micro-edits without UI thread blocking.</li><li><b>Crash Consistency:</b> Atomic file swaps prevent corruption during unexpected shutdowns.</li></ul>"
}`,
  schema: createDocumentHtmlSchema
})

/**
 * editDocument - LangChain Tool
 * Performs granular block-level updates (edit, delete, split) on a document.
 * This is the preferred tool for modifications to existing documents.
 */
export const editDocument = tool(editDocumentHandler, {
  name: 'editDocument',
  description: `Edit an existing document using structured JSON operations.
 
This tool allows you to update, insert, or delete blocks in a document without needing to provide the old HTML content or adhere to a strict text grammar.

OPERATIONS:
• update: Replaces the block at 'blockId' with 'newHtml'. If 'newHtml' contains multiple tags, they are all inserted sequentially.
• insert: Adds 'newHtml' 'before' or 'after' the 'blockId'.
• delete: Removes the block at 'blockId'.

BEST PRACTICES:
• Batching: Combine multiple updates, inserts, and deletes into a single tool call for maximum efficiency.
• Targeted Edits: Always call readDocument first to retrieve the current state and valid blockIds.
• Multi-Block Support: Use a single 'update' or 'insert' to add multiple tags at once rather than making separate calls.
• Valid HTML: Ensure 'newHtml' contains valid, semantic HTML tags (e.g., <p>, <ul>, <h2>, <table>). Keep comparisons in <table> with <thead> and bold keys, and use bold lead-ins for <li>.

Supported tags: <h1>, <h2>, <h3>, <h4>, <ul>, <ol>, <li>, <p>, <br>, <table>, <thead>, <tbody>, <tfoot>, <tr>, <th>, <td>.
Supported styles: <b>, <i>, <u>; style="text-align: center|right"; colspan, rowspan, background-color.

Example Input (Batch Refinement):
{
  "instanceName": "Storage-Engine-Evaluation",
  "operations": [
    {
      "action": "update",
      "blockId": "summary-p1",
      "newHtml": "<p>Updated analysis incorporating recent stress-test benchmarks under concurrent worker loads.</p>"
    },
    {
      "action": "insert",
      "blockId": "criteria-heading",
      "anchor": "after",
      "newHtml": "<table><thead><tr><th>Metric</th><th>Target</th><th>Observed</th><th>Status</th></tr></thead><tbody><tr><td><b>Sync P99</b></td><td>&lt;15ms</td><td>8.2ms</td><td>Pass</td></tr><tr><td><b>Memory Peak</b></td><td>&lt;120MB</td><td>94MB</td><td>Pass</td></tr></tbody></table>"
    },
    {
      "action": "delete",
      "blockId": "deprecated-draft-note"
    }
  ],
  "explanation": "Incorporate latest benchmark findings, insert metrics table, and remove obsolete draft notes."
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
      'Get a list of all available workspace items (documents and canvases). Returns names, project names, and types.',
    schema: listDocumentInstancesInputSchema
  }
)

export const readGraph = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    try {
      const uuid = await resolveResourceId(input.instanceName, input.projectName, context)

      const result = await executeReadGraph({
        instanceId: uuid,
        wsPort: context?.wsPort,
        includeMemo: input.includeMemo
      })

      return {
        status: 'success' as const,
        action: 'Read Graph',
        instanceName: input.instanceName,
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
    const { instanceName, projectName, ...spec } = input

    try {
      const uuid = await resolveOrCreateResourceId(instanceName, projectName, 'canvas', context)

      const nodesToResolve = spec.nodes || []
      const edgesToUse = spec.edges || []

      assertUniqueNodeEntities(nodesToResolve)

      const result = await executeWriteGraph({
        ...spec,
        // Overwrite the nodes and edges with the fully flattened & resolved ones
        nodes: nodesToResolve,
        edges: edgesToUse,
        instanceId: uuid,
        wsPort: context?.wsPort,
        apiPort: context?.apiPort
      })

      return {
        status: result.status,
        action: 'Wrote Graph',
        instanceName: input.instanceName,
        projectName: input.projectName,
        nodeCount: nodesToResolve.length,
        edgeCount: edgesToUse.length
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to write graph',
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
    description: `Declaratively create or update a knowledge graph.
    
Nodes are identified solely by their "entity" alias (usually the name). The system ensures each entity is linked to a corresponding document automatically.

RULES:
1. Every edge "from" and "to" MUST refer to an entity alias.
2. Any alias used in an edge must appear in the "nodes" array of the same request, or already exist on the canvas.
3. If an edge endpoint cannot be resolved to a known node (either incoming or existing), the entire operation fails.
4. Always call readGraph first to confirm existing entity aliases before using them in edges.
5. The memo field is always in Markdown format.

MODE:
- "replace": Overwrites the entire graph with the new spec
- "merge": Extends the existing graph, optionally starting from an anchor entity

DIRECTION:
- "LR": Left-to-right layout (nodes flow horizontally)
- "TD": Top-down layout (nodes flow vertically)

EXAMPLE (replace mode - create new graph):
{
  "instanceName": "AI-Overview",
  "direction": "LR",
  "mode": "replace",
  "nodes": [
    { "entity": "Machine Learning", "memo": "A subfield of AI.", "group": "Theory" },
    { "entity": "Deep Learning", "group": "Applied" },
    { "entity": "Neural Networks", "group": "Applied" }
  ],
  "edges": [
    { "from": "Machine Learning", "to": "Deep Learning", "label": "includes" },
    { "from": "Deep Learning", "to": "Neural Networks", "label": "uses" }
  ]
}

EXAMPLE (merge mode - extend existing graph):
{
  "instanceName": "AI-Overview",
  "direction": "TD",
  "mode": "merge",
  "startFrom": "Deep Learning",
  "nodes": [
    { "entity": "CNN", "memo": "Convolutional Neural Network" },
    { "entity": "RNN" }
  ],
  "edges": [
    { "from": "Deep Learning", "to": "CNN", "label": "type" },
    { "from": "Deep Learning", "to": "RNN", "label": "type" }
  ]
}

EXAMPLE (merge mode - delete entities):
{
  "instanceName": "AI-Overview",
  "direction": "LR",
  "mode": "merge",
  "nodes": [],
  "edges": [],
  "deleteNodes": ["RNN"],
  "deleteEdges": [{ "from": "Machine Learning", "to": "Deep Learning" }]
}

Use meaningful document instance names in the "entity" field.`,
    schema: writeGraphInputSchema
  }
)

export const writeMindMap = tool(
  async (input, config) => {
    const context = config.configurable as ToolConnectionContext | undefined
    const { instanceName, projectName, root, direction } = input

    try {
      const uuid = await resolveOrCreateResourceId(instanceName, projectName, 'canvas', context)

      // Flatten the hierarchical mind map into flat nodes and edges
      const { nodes, edges } = flattenMindMap(root)

      assertUniqueNodeEntities(nodes)

      const result = await executeWriteGraph({
        mode: 'replace', // Mind maps usually replace the whole view for consistency
        direction,
        nodes,
        edges,
        instanceId: uuid,
        wsPort: context?.wsPort,
        apiPort: context?.apiPort
      })

      return {
        status: result.status,
        action: 'Wrote Mind Map',
        instanceName: input.instanceName,
        projectName: input.projectName,
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to write mind map',
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
    description: `Create a professional hierarchical mind map on a canvas.
    
The input is a recursive "root" node with "children". This tool automatically handles layout, connection ports, and ensures each node is linked to a document.
The memo field is always in Markdown format.

EXAMPLE:
{
  "instanceName": "Project-Architecture",
  "root": {
    "entity": "Core Platform",
    "children": [
      {
        "entity": "Frontend Layer",
        "children": [
          {
            "entity": "Web Client",
            "children": [
              { "entity": "User Dashboard" },
              { "entity": "Admin Portal" }
            ]
          },
          { "entity": "Design System" }
        ]
      },
      {
        "entity": "Backend Layer",
        "children": [
          {
            "entity": "Microservices",
            "children": [
              { "entity": "Auth Service" },
              { "entity": "Payment Gateway" }
            ]
          },
          { "entity": "Data Persistence" }
        ]
      }
    ]
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
