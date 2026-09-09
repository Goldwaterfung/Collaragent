import { tool } from '@langchain/core/tools'
import {
  QueryAndFileBackInputSchema,
  type QueryAndFileBackInput,
  type RelationalLedgerEntry
} from '@shared/wiki'
import type { Block, DocumentPayload } from '@workspace/persistence/editorContent'
import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import { InverseCommandEngine } from '@collaragent/runtime/InverseCommandEngine'
import { type WikiWorkspaceAdapter, LiveWikiWorkspaceAdapter } from './adapters'
import type { InvertedIndexManager, SearchResult } from '@workspace/wiki/InvertedIndexManager'
import { type ToolConnectionContext, extractErrorInfo } from '../WorkspaceTools'

export interface QueryAndFileBackResult {
  status: 'success'
  action: 'Filed Back Synthesis'
  targetEntity: string
  synthesisTitle: string
  referencedEntities: string[]
  edgesCreated: number
  indexUpdated: boolean
  logAppended: boolean
  searchResults?: SearchResult[]
}

interface RollbackStep {
  description: string
  execute: () => Promise<void>
}

/**
 * Compiles or updates index.md with the new synthesis entity.
 */
function compileIndexForSynthesis(
  prevDoc: DocumentPayload | null,
  targetEntity: string,
  synthesisTitle: string,
  summary: string | undefined
): DocumentPayload {
  const blocks: Block[] = prevDoc?.blocks
    ? (JSON.parse(JSON.stringify(prevDoc.blocks)) as Block[])
    : []

  if (blocks.length === 0) {
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h1',
      children: [{ text: 'Workspace Index' }]
    })
  }

  // Find or create Entities section
  let entitiesHeadingIdx = blocks.findIndex(
    (b) => b.type === 'h2' && b.children?.[0]?.text?.toLowerCase().includes('entities')
  )
  if (entitiesHeadingIdx === -1) {
    entitiesHeadingIdx = blocks.length
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h2',
      children: [{ text: 'Entities' }]
    })
  }

  const desc = summary || synthesisTitle
  const existingIdx = blocks.findIndex(
    (b, idx) =>
      idx > entitiesHeadingIdx && b.children?.some((c) => c.text?.includes(`[[${targetEntity}]]`))
  )

  const entityBlock: Block = {
    id: existingIdx !== -1 ? blocks[existingIdx].id : crypto.randomUUID(),
    type: 'list-item',
    listType: 'bullet',
    children: [{ text: `[[${targetEntity}]]`, bold: true }, { text: `: ${desc}` }]
  }

  if (existingIdx !== -1) {
    blocks[existingIdx] = entityBlock
  } else {
    blocks.push(entityBlock)
  }

  return { blocks }
}

/**
 * Appends a query synthesis record to log.md.
 */
function compileLogForSynthesis(
  prevDoc: DocumentPayload | null,
  query: string,
  targetEntity: string,
  synthesisTitle: string,
  referencedEntities: string[],
  now: Date
): DocumentPayload {
  const blocks: Block[] = prevDoc?.blocks
    ? (JSON.parse(JSON.stringify(prevDoc.blocks)) as Block[])
    : []

  if (blocks.length === 0) {
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h1',
      children: [{ text: 'Workspace Log' }]
    })
  }

  const dateStr = now.toISOString().slice(0, 10)
  const header = `[${dateStr}] query | ${targetEntity}`
  const detail = `- Synthesized "${synthesisTitle}" addressing "${query}", referencing [${referencedEntities.join(', ')}].`

  blocks.push({
    id: crypto.randomUUID(),
    type: 'h2',
    children: [{ text: header }]
  })

  blocks.push({
    id: crypto.randomUUID(),
    type: 'paragraph',
    children: [{ text: detail }]
  })

  return { blocks }
}

/**
 * Executes knowledge synthesis query and files the result back into the workspace
 * as a new or updated entity document with bidirectional relational ledger links.
 */
export async function executeQueryAndFileBack(
  input: QueryAndFileBackInput,
  adapter: WikiWorkspaceAdapter,
  indexManager?: InvertedIndexManager
): Promise<QueryAndFileBackResult> {
  const validated = QueryAndFileBackInputSchema.parse(input)
  const rollbackStack: RollbackStep[] = []
  let edgesCreated = 0

  const ledgerStore = adapter.getLedgerStore()
  const now = new Date()
  const nowIso = now.toISOString()
  const rel = validated.relationToReferences || 'derived_from'

  // Query search context if indexManager is available
  const searchResults = indexManager ? indexManager.search(validated.query, 5) : undefined

  try {
    // ------------------------------------------------------------------------
    // Step 1: Create or Update Synthesis Document
    // ------------------------------------------------------------------------
    const prevDoc = await adapter.getDocument(validated.targetEntity)

    const blocks: Block[] = [
      {
        id: crypto.randomUUID(),
        type: 'h1',
        children: [{ text: validated.synthesisTitle }]
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [
          { text: 'Synthesis Query: ', bold: true },
          { text: validated.query },
          { text: ' | Created: ', italic: true },
          { text: nowIso, italic: true }
        ]
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [{ text: validated.synthesisContent }]
      }
    ]

    // Add references heading and claim badge blocks
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h2',
      children: [{ text: 'References & Citations' }]
    })

    const referenceBlockIds = new Map<string, string>()

    for (const ref of validated.referencedEntities) {
      const blockId = crypto.randomUUID()
      const badgeId = crypto.randomUUID()
      referenceBlockIds.set(ref, blockId)

      blocks.push({
        id: blockId,
        type: 'paragraph',
        children: [
          { text: `Referencing ` },
          { text: ref, bold: true },
          { text: ` ` },
          {
            text: '',
            claimBadge: {
              badgeId,
              targetEntityId: ref,
              rel,
              justification: validated.justification
            }
          }
        ]
      })
    }

    const payload: DocumentPayload = { blocks }
    await adapter.saveDocument(validated.targetEntity, payload)

    if (prevDoc) {
      const logEntry: WorkspaceCommandLogEntry = {
        instanceId: validated.targetEntity,
        instanceType: 'document',
        projectId: 'default',
        cursor: { seq: 1 },
        command: { type: 'editor:replace_document', payload },
        previousState: { documentPayload: prevDoc }
      }
      const inverse = InverseCommandEngine.invert(logEntry)
      rollbackStack.push({
        description: `Rollback synthesis document "${validated.targetEntity}"`,
        execute: async () => {
          if (inverse?.type === 'editor:replace_document') {
            await adapter.saveDocument(validated.targetEntity, inverse.payload)
          }
        }
      })
    } else {
      rollbackStack.push({
        description: `Rollback newly created synthesis document "${validated.targetEntity}"`,
        execute: async () => {
          if (adapter.deleteDocument) {
            await adapter.deleteDocument(validated.targetEntity)
          }
        }
      })
    }

    // ------------------------------------------------------------------------
    // Step 2: Create Bidirectional Relational Ledger Edges
    // ------------------------------------------------------------------------
    for (const ref of validated.referencedEntities) {
      const blockId = referenceBlockIds.get(ref) ?? crypto.randomUUID()

      // 2a. Forward document claim: synthesis -> referenced entity
      const existingForward = ledgerStore.findEdge(validated.targetEntity, ref, rel)
      const forwardEdge: RelationalLedgerEntry = {
        id: existingForward?.id ?? crypto.randomUUID(),
        sourceEntityId: validated.targetEntity,
        targetEntityId: ref,
        rel,
        provenance: 'document_claim',
        status: 'active',
        anchor: {
          blockId,
          justification: validated.justification
        },
        meta: existingForward?.meta
          ? { ...existingForward.meta, updatedAt: nowIso }
          : {
              createdAt: nowIso,
              updatedAt: nowIso,
              author: 'agent'
            }
      }

      const forwardRes = ledgerStore.upsertEdge(forwardEdge)
      edgesCreated++

      const forwardLog: WorkspaceCommandLogEntry = {
        instanceId: 'ledger-default',
        instanceType: 'ledger',
        projectId: 'default',
        cursor: { seq: 2 },
        command: { type: 'ledger:upsert_edge', entry: forwardRes.edge },
        previousState: { existed: !forwardRes.created, entry: forwardRes.previous }
      }
      const forwardInverse = InverseCommandEngine.invert(forwardLog)
      rollbackStack.push({
        description: `Rollback forward edge ${forwardRes.edge.id}`,
        execute: async () => {
          if (forwardInverse?.type === 'ledger:remove_edge') {
            ledgerStore.removeEdge(forwardInverse.edgeId)
          } else if (forwardInverse?.type === 'ledger:upsert_edge') {
            ledgerStore.upsertEdge(forwardInverse.entry)
          }
        }
      })

      // 2b. Reciprocal edge: referenced entity -> synthesis (canvas_relational backlink)
      const reciprocalRel = 'details'
      const existingReciprocal = ledgerStore.findEdge(ref, validated.targetEntity, reciprocalRel)
      const reciprocalEdge: RelationalLedgerEntry = {
        id: existingReciprocal?.id ?? crypto.randomUUID(),
        sourceEntityId: ref,
        targetEntityId: validated.targetEntity,
        rel: reciprocalRel,
        provenance: 'canvas_relational',
        status: 'active',
        meta: existingReciprocal?.meta
          ? { ...existingReciprocal.meta, updatedAt: nowIso }
          : {
              createdAt: nowIso,
              updatedAt: nowIso,
              author: 'agent'
            }
      }

      const reciprocalRes = ledgerStore.upsertEdge(reciprocalEdge)
      edgesCreated++

      const reciprocalLog: WorkspaceCommandLogEntry = {
        instanceId: 'ledger-default',
        instanceType: 'ledger',
        projectId: 'default',
        cursor: { seq: 3 },
        command: { type: 'ledger:upsert_edge', entry: reciprocalRes.edge },
        previousState: { existed: !reciprocalRes.created, entry: reciprocalRes.previous }
      }
      const reciprocalInverse = InverseCommandEngine.invert(reciprocalLog)
      rollbackStack.push({
        description: `Rollback reciprocal edge ${reciprocalRes.edge.id}`,
        execute: async () => {
          if (reciprocalInverse?.type === 'ledger:remove_edge') {
            ledgerStore.removeEdge(reciprocalInverse.edgeId)
          } else if (reciprocalInverse?.type === 'ledger:upsert_edge') {
            ledgerStore.upsertEdge(reciprocalInverse.entry)
          }
        }
      })
    }

    // ------------------------------------------------------------------------
    // Step 3: Update index.md
    // ------------------------------------------------------------------------
    const prevIndexDoc =
      (await adapter.getDocument('index.md')) ?? (await adapter.getDocument('index'))
    const updatedIndex = compileIndexForSynthesis(
      prevIndexDoc,
      validated.targetEntity,
      validated.synthesisTitle,
      validated.summary
    )
    await adapter.saveDocument('index.md', updatedIndex)

    const indexLog: WorkspaceCommandLogEntry = {
      instanceId: 'index.md',
      instanceType: 'document',
      projectId: 'default',
      cursor: { seq: 4 },
      command: { type: 'editor:replace_document', payload: updatedIndex },
      previousState: prevIndexDoc ? { documentPayload: prevIndexDoc } : undefined
    }
    const indexInverse = prevIndexDoc ? InverseCommandEngine.invert(indexLog) : null
    rollbackStack.push({
      description: 'Rollback index.md',
      execute: async () => {
        if (indexInverse?.type === 'editor:replace_document') {
          await adapter.saveDocument('index.md', indexInverse.payload)
        } else if (!prevIndexDoc && adapter.deleteDocument) {
          await adapter.deleteDocument('index.md')
        }
      }
    })

    // ------------------------------------------------------------------------
    // Step 4: Append to log.md
    // ------------------------------------------------------------------------
    const prevLogDoc = (await adapter.getDocument('log.md')) ?? (await adapter.getDocument('log'))
    const updatedLog = compileLogForSynthesis(
      prevLogDoc,
      validated.query,
      validated.targetEntity,
      validated.synthesisTitle,
      validated.referencedEntities,
      now
    )
    await adapter.saveDocument('log.md', updatedLog)

    const logLog: WorkspaceCommandLogEntry = {
      instanceId: 'log.md',
      instanceType: 'document',
      projectId: 'default',
      cursor: { seq: 5 },
      command: { type: 'editor:replace_document', payload: updatedLog },
      previousState: prevLogDoc ? { documentPayload: prevLogDoc } : undefined
    }
    const logInverse = prevLogDoc ? InverseCommandEngine.invert(logLog) : null
    rollbackStack.push({
      description: 'Rollback log.md',
      execute: async () => {
        if (logInverse?.type === 'editor:replace_document') {
          await adapter.saveDocument('log.md', logInverse.payload)
        } else if (!prevLogDoc && adapter.deleteDocument) {
          await adapter.deleteDocument('log.md')
        }
      }
    })

    return {
      status: 'success',
      action: 'Filed Back Synthesis',
      targetEntity: validated.targetEntity,
      synthesisTitle: validated.synthesisTitle,
      referencedEntities: validated.referencedEntities,
      edgesCreated,
      indexUpdated: true,
      logAppended: true,
      searchResults
    }
  } catch (error: unknown) {
    while (rollbackStack.length > 0) {
      const step = rollbackStack.pop()!
      try {
        await step.execute()
      } catch (rollbackError: unknown) {
        console.error(
          `[queryAndFileBack] Rollback failure on step "${step.description}":`,
          rollbackError
        )
      }
    }
    throw error
  }
}

/**
 * LangChain tool wrapper for queryAndFileBack.
 */
export const queryAndFileBack = tool(
  async (input, config) => {
    try {
      const context = config.configurable as
        | (ToolConnectionContext & {
            adapter?: WikiWorkspaceAdapter
            indexManager?: InvertedIndexManager
          })
        | undefined
      const adapter = context?.adapter ?? new LiveWikiWorkspaceAdapter(context)
      if (adapter instanceof LiveWikiWorkspaceAdapter) {
        await adapter.loadLedger()
      }
      return await executeQueryAndFileBack(input, adapter, context?.indexManager)
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to file back synthesis',
        targetEntity: input.targetEntity,
        synthesisTitle: input.synthesisTitle,
        code,
        message,
        recommendFix
      }
    }
  },
  {
    name: 'queryAndFileBack',
    description: `Queries knowledge across the workspace, synthesizes findings, and atomically files the synthesis back into the workspace as a new typed entity document with bidirectional relational ledger links, updating index.md and log.md.`,
    schema: QueryAndFileBackInputSchema
  }
)
