import { tool } from '@langchain/core/tools'
import {
  IngestSourceInputSchema,
  type IngestSourceInput,
  type RelationalLedgerEntry
} from '@shared/wiki'
import type { Block, DocumentPayload } from '@workspace/persistence/editorContent'
import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import { InverseCommandEngine } from '@collaragent/runtime/InverseCommandEngine'
import { type WikiWorkspaceAdapter, LiveWikiWorkspaceAdapter } from './adapters'
import { type ToolConnectionContext, extractErrorInfo } from '../WorkspaceTools'

export interface IngestSourceResult {
  status: 'success'
  action: 'Ingested Source'
  sourceTitle: string
  sourceType: string
  createdDocuments: string[]
  updatedDocuments: string[]
  edgesCreated: number
  indexUpdated: boolean
  logAppended: boolean
}

interface RollbackStep {
  description: string
  execute: () => Promise<void>
}

/**
 * Builds or updates the index.md DocumentPayload with the new source and entity entries.
 */
function compileUpdatedIndexDocument(
  prevDoc: DocumentPayload | null,
  sourceTitle: string,
  sourceType: string,
  summary: string,
  targetEntities: string[]
): DocumentPayload {
  const blocks: Block[] = prevDoc?.blocks
    ? (JSON.parse(JSON.stringify(prevDoc.blocks)) as Block[])
    : []

  // Ensure index heading exists
  if (blocks.length === 0) {
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h1',
      children: [{ text: 'Workspace Index' }]
    })
  }

  // Find or create Sources section
  let sourcesHeadingIdx = blocks.findIndex(
    (b) => b.type === 'h2' && b.children?.[0]?.text?.toLowerCase().includes('sources')
  )
  if (sourcesHeadingIdx === -1) {
    sourcesHeadingIdx = blocks.length
    blocks.push({
      id: crypto.randomUUID(),
      type: 'h2',
      children: [{ text: 'Sources' }]
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

  // Check if source item already exists in blocks
  const existingSourceIdx = blocks.findIndex(
    (b, idx) =>
      idx > sourcesHeadingIdx &&
      idx < entitiesHeadingIdx &&
      b.children?.some((c) => c.text?.includes(`[[${sourceTitle}]]`))
  )

  const sourceEntryBlock: Block = {
    id: existingSourceIdx !== -1 ? blocks[existingSourceIdx].id : crypto.randomUUID(),
    type: 'list-item',
    listType: 'bullet',
    children: [{ text: `[[${sourceTitle}]]`, bold: true }, { text: ` (${sourceType}): ${summary}` }]
  }

  if (existingSourceIdx !== -1) {
    blocks[existingSourceIdx] = sourceEntryBlock
  } else {
    blocks.splice(entitiesHeadingIdx, 0, sourceEntryBlock)
    entitiesHeadingIdx++
  }

  // Ensure each target entity is listed under Entities
  for (const entity of targetEntities) {
    const existingEntity = blocks
      .slice(entitiesHeadingIdx)
      .some((b) => b.children?.some((c) => c.text?.includes(`[[${entity}]]`)))
    if (!existingEntity) {
      blocks.push({
        id: crypto.randomUUID(),
        type: 'list-item',
        listType: 'bullet',
        children: [{ text: `[[${entity}]]`, bold: true }]
      })
    }
  }

  return { blocks }
}

/**
 * Builds or updates the log.md DocumentPayload by appending an operational log entry.
 */
function compileUpdatedLogDocument(
  prevDoc: DocumentPayload | null,
  sourceTitle: string,
  sourceType: string,
  claimCount: number,
  targetEntities: string[],
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
  const entryHeader = `[${dateStr}] ingest | ${sourceTitle}`
  const entryDetail = `- Ingested ${sourceType} "${sourceTitle}" with ${claimCount} claim(s) into [${targetEntities.join(', ')}].`

  blocks.push({
    id: crypto.randomUUID(),
    type: 'h2',
    children: [{ text: entryHeader }]
  })

  blocks.push({
    id: crypto.randomUUID(),
    type: 'paragraph',
    children: [{ text: entryDetail }]
  })

  return { blocks }
}

/**
 * Executes atomic source ingestion with full ADR-005 transactional rollback across:
 * 1. Raw source document creation / update
 * 2. Target concept documents creation / inline claim badge updates
 * 3. Relational Ledger edge insertions / promotions
 * 4. index.md catalog update
 * 5. log.md operational audit append
 */
export async function executeIngestSource(
  input: IngestSourceInput,
  adapter: WikiWorkspaceAdapter
): Promise<IngestSourceResult> {
  const validatedInput = IngestSourceInputSchema.parse(input)
  const rollbackStack: RollbackStep[] = []
  const createdDocuments: string[] = []
  const updatedDocuments: string[] = []
  let edgesCreated = 0

  const ledgerStore = adapter.getLedgerStore()
  const now = new Date()
  const nowIso = now.toISOString()
  const targetEntityNames = Array.from(new Set(validatedInput.claims.map((c) => c.targetEntity)))

  try {
    // ------------------------------------------------------------------------
    // Step 1: Raw Source Document Creation / Update
    // ------------------------------------------------------------------------
    const prevSourceDoc = await adapter.getDocument(validatedInput.sourceTitle)
    const sourceBlocks: Block[] = [
      {
        id: crypto.randomUUID(),
        type: 'h1',
        children: [{ text: validatedInput.sourceTitle }]
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [
          { text: 'Source Type: ', bold: true },
          { text: validatedInput.sourceType },
          { text: ' | Ingested: ', italic: true },
          { text: nowIso, italic: true }
        ]
      },
      {
        id: crypto.randomUUID(),
        type: 'h2',
        children: [{ text: 'Summary' }]
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [{ text: validatedInput.summary }]
      },
      {
        id: crypto.randomUUID(),
        type: 'h2',
        children: [{ text: 'Raw Content' }]
      },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        children: [{ text: validatedInput.rawContent }]
      }
    ]

    const newSourceDocPayload: DocumentPayload = { blocks: sourceBlocks }
    await adapter.saveDocument(validatedInput.sourceTitle, newSourceDocPayload)

    if (prevSourceDoc) {
      updatedDocuments.push(validatedInput.sourceTitle)
      const logEntry: WorkspaceCommandLogEntry = {
        instanceId: validatedInput.sourceTitle,
        instanceType: 'document',
        projectId: 'default',
        cursor: { seq: 1 },
        command: { type: 'editor:replace_document', payload: newSourceDocPayload },
        previousState: { documentPayload: prevSourceDoc }
      }
      const inverse = InverseCommandEngine.invert(logEntry)
      rollbackStack.push({
        description: `Rollback updated source document "${validatedInput.sourceTitle}"`,
        execute: async () => {
          if (inverse?.type === 'editor:replace_document') {
            await adapter.saveDocument(validatedInput.sourceTitle, inverse.payload)
          }
        }
      })
    } else {
      createdDocuments.push(validatedInput.sourceTitle)
      rollbackStack.push({
        description: `Rollback newly created source document "${validatedInput.sourceTitle}"`,
        execute: async () => {
          if (adapter.deleteDocument) {
            await adapter.deleteDocument(validatedInput.sourceTitle)
          }
        }
      })
    }

    // ------------------------------------------------------------------------
    // Step 2 & 3: Target Concept Documents & Relational Ledger Edges
    // ------------------------------------------------------------------------
    for (const claim of validatedInput.claims) {
      const prevTargetDoc = await adapter.getDocument(claim.targetEntity)
      const targetBlocks: Block[] = prevTargetDoc?.blocks
        ? (JSON.parse(JSON.stringify(prevTargetDoc.blocks)) as Block[])
        : [
            {
              id: crypto.randomUUID(),
              type: 'h1',
              children: [{ text: claim.targetEntity }]
            }
          ]

      const claimBlockId = crypto.randomUUID()
      const badgeId = crypto.randomUUID()

      const claimBlock: Block = {
        id: claimBlockId,
        type: 'paragraph',
        children: [
          { text: `${claim.claimText} ` },
          {
            text: '',
            claimBadge: {
              badgeId,
              targetEntityId: validatedInput.sourceTitle,
              rel: claim.rel,
              justification: claim.justification
            }
          }
        ]
      }
      targetBlocks.push(claimBlock)

      const newTargetDocPayload: DocumentPayload = { blocks: targetBlocks }
      await adapter.saveDocument(claim.targetEntity, newTargetDocPayload)

      if (prevTargetDoc) {
        if (!updatedDocuments.includes(claim.targetEntity)) {
          updatedDocuments.push(claim.targetEntity)
        }
        const logEntry: WorkspaceCommandLogEntry = {
          instanceId: claim.targetEntity,
          instanceType: 'document',
          projectId: 'default',
          cursor: { seq: 2 },
          command: { type: 'editor:replace_document', payload: newTargetDocPayload },
          previousState: { documentPayload: prevTargetDoc }
        }
        const inverse = InverseCommandEngine.invert(logEntry)
        rollbackStack.push({
          description: `Rollback concept document "${claim.targetEntity}"`,
          execute: async () => {
            if (inverse?.type === 'editor:replace_document') {
              await adapter.saveDocument(claim.targetEntity, inverse.payload)
            }
          }
        })
      } else {
        if (!createdDocuments.includes(claim.targetEntity)) {
          createdDocuments.push(claim.targetEntity)
        }
        rollbackStack.push({
          description: `Rollback newly created concept document "${claim.targetEntity}"`,
          execute: async () => {
            if (adapter.deleteDocument) {
              await adapter.deleteDocument(claim.targetEntity)
            }
          }
        })
      }

      // Record edge into Relational Ledger
      const existingEdge = ledgerStore.findEdge(
        validatedInput.sourceTitle,
        claim.targetEntity,
        claim.rel
      )

      const ledgerEntryInput: RelationalLedgerEntry = {
        id: existingEdge?.id ?? crypto.randomUUID(),
        sourceEntityId: validatedInput.sourceTitle,
        targetEntityId: claim.targetEntity,
        rel: claim.rel,
        provenance: 'document_claim',
        status: 'active',
        anchor: {
          blockId: claimBlockId,
          justification: claim.justification
        },
        meta: existingEdge?.meta
          ? { ...existingEdge.meta, updatedAt: nowIso }
          : {
              createdAt: nowIso,
              updatedAt: nowIso,
              author: 'agent'
            }
      }

      // Upsert into ledger (triggers Tarjan cycle check if rel === 'supersedes')
      const upsertResult = ledgerStore.upsertEdge(ledgerEntryInput)
      edgesCreated++

      const ledgerLogEntry: WorkspaceCommandLogEntry = {
        instanceId: 'ledger-default',
        instanceType: 'ledger',
        projectId: 'default',
        cursor: { seq: 3 },
        command: {
          type: 'ledger:upsert_edge',
          entry: upsertResult.edge
        },
        previousState: {
          existed: !upsertResult.created,
          entry: upsertResult.previous
        }
      }

      const ledgerInverse = InverseCommandEngine.invert(ledgerLogEntry)
      rollbackStack.push({
        description: `Rollback ledger edge "${upsertResult.edge.id}" (${upsertResult.edge.sourceEntityId} -> ${upsertResult.edge.targetEntityId})`,
        execute: async () => {
          if (ledgerInverse?.type === 'ledger:remove_edge') {
            ledgerStore.removeEdge(ledgerInverse.edgeId)
          } else if (ledgerInverse?.type === 'ledger:upsert_edge') {
            ledgerStore.upsertEdge(ledgerInverse.entry)
          }
        }
      })
    }

    // ------------------------------------------------------------------------
    // Step 4: index.md Update
    // ------------------------------------------------------------------------
    const prevIndexDoc =
      (await adapter.getDocument('index.md')) ?? (await adapter.getDocument('index'))
    const updatedIndexPayload = compileUpdatedIndexDocument(
      prevIndexDoc,
      validatedInput.sourceTitle,
      validatedInput.sourceType,
      validatedInput.summary,
      targetEntityNames
    )
    await adapter.saveDocument('index.md', updatedIndexPayload)

    const indexLogEntry: WorkspaceCommandLogEntry = {
      instanceId: 'index.md',
      instanceType: 'document',
      projectId: 'default',
      cursor: { seq: 4 },
      command: { type: 'editor:replace_document', payload: updatedIndexPayload },
      previousState: prevIndexDoc ? { documentPayload: prevIndexDoc } : undefined
    }
    const indexInverse = prevIndexDoc ? InverseCommandEngine.invert(indexLogEntry) : null

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
    // Step 5: log.md Append
    // ------------------------------------------------------------------------
    const prevLogDoc = (await adapter.getDocument('log.md')) ?? (await adapter.getDocument('log'))
    const updatedLogPayload = compileUpdatedLogDocument(
      prevLogDoc,
      validatedInput.sourceTitle,
      validatedInput.sourceType,
      validatedInput.claims.length,
      targetEntityNames,
      now
    )
    await adapter.saveDocument('log.md', updatedLogPayload)

    const logEntryForRollback: WorkspaceCommandLogEntry = {
      instanceId: 'log.md',
      instanceType: 'document',
      projectId: 'default',
      cursor: { seq: 5 },
      command: { type: 'editor:replace_document', payload: updatedLogPayload },
      previousState: prevLogDoc ? { documentPayload: prevLogDoc } : undefined
    }
    const logInverse = prevLogDoc ? InverseCommandEngine.invert(logEntryForRollback) : null

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
      action: 'Ingested Source',
      sourceTitle: validatedInput.sourceTitle,
      sourceType: validatedInput.sourceType,
      createdDocuments,
      updatedDocuments,
      edgesCreated,
      indexUpdated: true,
      logAppended: true
    }
  } catch (error: unknown) {
    // Unwind all mutations in LIFO reverse order (ADR-005)
    while (rollbackStack.length > 0) {
      const step = rollbackStack.pop()!
      try {
        await step.execute()
      } catch (rollbackError: unknown) {
        console.error(
          `[ingestSource] Rollback failure on step "${step.description}":`,
          rollbackError
        )
      }
    }
    throw error
  }
}

/**
 * LangChain tool wrapper for ingestSource.
 */
export const ingestSource = tool(
  async (input, config) => {
    try {
      const context = config.configurable as
        (ToolConnectionContext & { adapter?: WikiWorkspaceAdapter }) | undefined
      const adapter = context?.adapter ?? new LiveWikiWorkspaceAdapter(context)
      if (adapter instanceof LiveWikiWorkspaceAdapter) {
        await adapter.loadLedger()
      }
      return await executeIngestSource(input, adapter)
    } catch (err: unknown) {
      const { code, message, recommendFix } = extractErrorInfo(err)
      return {
        status: 'error' as const,
        action: 'Failed to ingest source',
        sourceTitle: input.sourceTitle,
        sourceType: input.sourceType,
        code,
        message,
        recommendFix
      }
    }
  },
  {
    name: 'ingestSource',
    description: `Atomically ingests a source document, updates target concept documents with inline claim badges, inserts relational ledger edges, updates index.md, and appends to log.md with transactional rollback parity.`,
    schema: IngestSourceInputSchema
  }
)
