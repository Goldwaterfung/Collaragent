import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { unpack } from 'msgpackr'
import { type ClaimRelation, type RelationalLedgerEntry } from '@shared/wiki'
import { WorkspaceError, WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'
import { RelationalLedgerStore } from './RelationalLedgerStore'
import './RelationalLedgerStorage'

/**
 * Maps legacy relationship label/type strings to typed ClaimRelation enum values.
 */
export function mapLegacyRelationToClaimRelation(label: unknown): ClaimRelation {
  if (typeof label !== 'string') return 'relates_to'
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  switch (normalized) {
    case 'supports':
    case 'support':
    case 'proves':
    case 'evidence':
      return 'supports'
    case 'contradicts':
    case 'contradict':
    case 'disproves':
    case 'opposes':
      return 'contradicts'
    case 'supersedes':
    case 'supersede':
    case 'replaces':
      return 'supersedes'
    case 'details':
    case 'detail':
    case 'elaborates':
    case 'expands':
      return 'details'
    case 'derived_from':
    case 'derived':
    case 'derives_from':
      return 'derived_from'
    case 'cites':
    case 'cite':
    case 'citation':
    case 'references':
    case 'reference':
      return 'cites'
    case 'relates_to':
    case 'related_to':
    case 'relates':
    default:
      return 'relates_to'
  }
}

/**
 * Resolves human-readable entity name from a legacy node object.
 */
function extractNodeName(node: unknown, fallbackId: string): string {
  if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>
    if (typeof record.name === 'string' && record.name.trim().length > 0) {
      return record.name.trim()
    }
    if (typeof record.title === 'string' && record.title.trim().length > 0) {
      return record.title.trim()
    }
    if (typeof record.attrs === 'object' && record.attrs !== null) {
      const attrs = record.attrs as Record<string, unknown>
      if (typeof attrs.name === 'string' && attrs.name.trim().length > 0) {
        return attrs.name.trim()
      }
      if (typeof attrs.title === 'string' && attrs.title.trim().length > 0) {
        return attrs.title.trim()
      }
    }
  }
  return fallbackId
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ensureUuid(id: unknown): string {
  if (typeof id === 'string' && UUID_PATTERN.test(id)) {
    return id
  }
  return crypto.randomUUID()
}

/**
 * Bootstraps a legacy canvas snapshot JSON into typed RelationalLedgerEntry records.
 */
export function bootstrapLegacyCanvasToLedger(
  canvasSnapshot: unknown,
  ledgerStore: RelationalLedgerStore
): RelationalLedgerEntry[] {
  if (typeof canvasSnapshot !== 'object' || canvasSnapshot === null) {
    return []
  }

  const snapshotObj = canvasSnapshot as Record<string, unknown>
  const graphObj =
    typeof snapshotObj.graph === 'object' && snapshotObj.graph !== null
      ? (snapshotObj.graph as Record<string, unknown>)
      : snapshotObj

  const rawNodes =
    typeof graphObj.nodes === 'object' && graphObj.nodes !== null
      ? (graphObj.nodes as Record<string, unknown>)
      : {}

  const rawRelationships =
    typeof graphObj.relationships === 'object' && graphObj.relationships !== null
      ? (graphObj.relationships as Record<string, unknown>)
      : typeof graphObj.edges === 'object' && graphObj.edges !== null
        ? (graphObj.edges as Record<string, unknown>)
        : {}

  const synthesizedEntries: RelationalLedgerEntry[] = []

  const relationshipList: Array<{ id: string; val: unknown }> = Array.isArray(rawRelationships)
    ? rawRelationships.map((r, i) => ({ id: `rel-${i}`, val: r }))
    : Object.entries(rawRelationships).map(([id, val]) => ({ id, val }))

  for (const item of relationshipList) {
    if (typeof item.val !== 'object' || item.val === null) continue
    const relRecord = item.val as Record<string, unknown>

    let fromNodeId = ''
    let toNodeId = ''

    if (typeof relRecord.from === 'object' && relRecord.from !== null) {
      const fromObj = relRecord.from as Record<string, unknown>
      if (typeof fromObj.nodeId === 'string') fromNodeId = fromObj.nodeId
    } else if (typeof relRecord.from === 'string') {
      fromNodeId = relRecord.from
    } else if (typeof relRecord.source === 'string') {
      fromNodeId = relRecord.source
    }

    if (typeof relRecord.to === 'object' && relRecord.to !== null) {
      const toObj = relRecord.to as Record<string, unknown>
      if (typeof toObj.nodeId === 'string') toNodeId = toObj.nodeId
    } else if (typeof relRecord.to === 'string') {
      toNodeId = relRecord.to
    } else if (typeof relRecord.target === 'string') {
      toNodeId = relRecord.target
    }

    if (!fromNodeId || !toNodeId) continue

    const fromNode = (rawNodes as Record<string, unknown>)[fromNodeId]
    const toNode = (rawNodes as Record<string, unknown>)[toNodeId]

    const sourceEntityName = extractNodeName(fromNode, fromNodeId)
    const targetEntityName = extractNodeName(toNode, toNodeId)

    let rawLabel: unknown = undefined
    if (typeof relRecord.attrs === 'object' && relRecord.attrs !== null) {
      const attrs = relRecord.attrs as Record<string, unknown>
      rawLabel = attrs.label ?? attrs.rel ?? attrs.type
    }
    if (rawLabel === undefined) {
      rawLabel = relRecord.label ?? relRecord.type
    }

    const mappedRel = mapLegacyRelationToClaimRelation(rawLabel)
    const edgeId = ensureUuid(relRecord.id ?? item.id)

    const entry: RelationalLedgerEntry = {
      id: edgeId,
      sourceEntityId: sourceEntityName,
      targetEntityId: targetEntityName,
      rel: mappedRel,
      provenance: 'canvas_relational',
      status: 'active',
      meta: {
        createdAt:
          typeof relRecord.createdAt === 'string' ? relRecord.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'user'
      }
    }

    ledgerStore.upsertEdge(entry)
    synthesizedEntries.push(entry)
  }

  return synthesizedEntries
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Inspects a workspace directory and automatically bootstraps ledger-default.json
 * from existing canvas instances if it does not yet exist.
 */
export async function bootstrapWorkspaceDirectory(
  workspacePath: string,
  ledgerStore: RelationalLedgerStore
): Promise<{ bootstrapped: boolean; entriesCount: number }> {
  try {
    const candidates = [
      path.join(workspacePath, '.collar', 'instances'),
      path.join(workspacePath, 'instances'),
      workspacePath
    ]

    let instancesDir: string | null = null
    for (const cand of candidates) {
      if (await isDirectory(cand)) {
        instancesDir = cand
        break
      }
    }

    if (!instancesDir) {
      return { bootstrapped: false, entriesCount: 0 }
    }

    const ledgerFilePath = path.join(instancesDir, 'ledger-default.json')
    const ledgerMsgpackPath = path.join(instancesDir, 'ledger-default.msgpack')

    // If ledger file already exists, load and return
    if (await pathExists(ledgerFilePath)) {
      await ledgerStore.loadFromFile(ledgerFilePath)
      return {
        bootstrapped: false,
        entriesCount: ledgerStore.getAllEdges().length
      }
    }
    if (await pathExists(ledgerMsgpackPath)) {
      return {
        bootstrapped: false,
        entriesCount: ledgerStore.getAllEdges().length
      }
    }

    // Locate manifest.json if present
    const manifestCandidates = [
      path.join(workspacePath, 'manifest.json'),
      path.join(workspacePath, '.collar', 'manifest.json'),
      path.join(path.dirname(instancesDir), 'manifest.json')
    ]
    let manifestPath: string | null = null
    let manifestObj: Record<string, unknown> | null = null

    for (const mCand of manifestCandidates) {
      if (await pathExists(mCand)) {
        try {
          const raw = await fs.readFile(mCand, 'utf8')
          const parsed = JSON.parse(raw) as unknown
          if (parsed !== null && typeof parsed === 'object') {
            manifestPath = mCand
            manifestObj = parsed as Record<string, unknown>
            break
          }
        } catch {
          // ignore manifest parse error
        }
      }
    }

    // If manifest already registers ledger-default, return
    if (manifestObj && manifestObj.instances && typeof manifestObj.instances === 'object') {
      const instancesMap = manifestObj.instances as Record<string, unknown>
      if (instancesMap['ledger-default']) {
        return {
          bootstrapped: false,
          entriesCount: ledgerStore.getAllEdges().length
        }
      }
    }

    let totalSynthesized = 0
    const processedInstanceIds = new Set<string>()

    // Helper to read and bootstrap a canvas snapshot from file
    const processCanvasFile = async (filePath: string): Promise<void> => {
      let parsed: unknown = null
      if (filePath.endsWith('.msgpack')) {
        const raw = await fs.readFile(filePath)
        parsed = unpack(raw)
      } else if (filePath.endsWith('.json')) {
        const raw = await fs.readFile(filePath, 'utf8')
        parsed = JSON.parse(raw)
      }
      if (parsed) {
        const synthesized = bootstrapLegacyCanvasToLedger(parsed, ledgerStore)
        totalSynthesized += synthesized.length
      }
    }

    // 1. Check canvas instances registered in manifest.json
    if (manifestObj && manifestObj.instances && typeof manifestObj.instances === 'object') {
      const instancesMap = manifestObj.instances as Record<string, unknown>
      for (const [instId, instVal] of Object.entries(instancesMap)) {
        if (typeof instVal === 'object' && instVal !== null) {
          const rec = instVal as Record<string, unknown>
          const type = typeof rec.type === 'string' ? rec.type : ''
          if (type === 'canvas' || type === 'graph-canvas') {
            processedInstanceIds.add(instId)
            const nestedMsgpack = path.join(instancesDir, instId, 'content.msgpack')
            const flatMsgpack = path.join(instancesDir, `${instId}.msgpack`)
            const flatJson = path.join(instancesDir, `${instId}.json`)

            if (await pathExists(nestedMsgpack)) {
              await processCanvasFile(nestedMsgpack)
            } else if (await pathExists(flatMsgpack)) {
              await processCanvasFile(flatMsgpack)
            } else if (await pathExists(flatJson)) {
              await processCanvasFile(flatJson)
            } else if (rec.content !== undefined && rec.content !== null) {
              const synthesized = bootstrapLegacyCanvasToLedger(rec.content, ledgerStore)
              totalSynthesized += synthesized.length
            }
          }
        }
      }
    }

    // 2. Scan instances directory for any loose canvas files not yet processed
    const entries = await fs.readdir(instancesDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(instancesDir, entry.name)

      if (entry.isDirectory()) {
        const id = entry.name
        if (!processedInstanceIds.has(id)) {
          const nestedContentMsgpack = path.join(fullPath, 'content.msgpack')
          const nestedContentJson = path.join(fullPath, 'content.json')
          if (await pathExists(nestedContentMsgpack)) {
            await processCanvasFile(nestedContentMsgpack)
            processedInstanceIds.add(id)
          } else if (await pathExists(nestedContentJson)) {
            await processCanvasFile(nestedContentJson)
            processedInstanceIds.add(id)
          }
        }
      } else if (entry.isFile()) {
        const baseName = path.basename(entry.name, path.extname(entry.name))
        if (!processedInstanceIds.has(baseName)) {
          const isCanvasFilename =
            entry.name.startsWith('canvas-') ||
            entry.name === 'canvas.json' ||
            entry.name === 'canvas.msgpack' ||
            entry.name === 'instances_canvas.json'
          if (
            isCanvasFilename &&
            (entry.name.endsWith('.json') || entry.name.endsWith('.msgpack'))
          ) {
            await processCanvasFile(fullPath)
            processedInstanceIds.add(baseName)
          }
        }
      }
    }

    if (totalSynthesized > 0) {
      await ledgerStore.saveToFile(ledgerFilePath)

      // Update manifest.json if present (Spec §7.8 Step 4)
      if (manifestPath && manifestObj) {
        if (!manifestObj.instances || typeof manifestObj.instances !== 'object') {
          manifestObj.instances = {}
        }
        const instancesMap = manifestObj.instances as Record<string, unknown>
        const projectIds =
          manifestObj.projects && typeof manifestObj.projects === 'object'
            ? Object.keys(manifestObj.projects as Record<string, unknown>)
            : []
        const defaultProjectId = projectIds.length > 0 ? projectIds[0] : 'default'
        const nowIso = new Date().toISOString()
        instancesMap['ledger-default'] = {
          id: 'ledger-default',
          projectId: defaultProjectId,
          type: 'ledger',
          name: 'ledger-default',
          metadata: { isHidden: true, isSystem: true },
          createdAt: nowIso,
          updatedAt: nowIso
        }
        await fs.writeFile(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8')
      }
    }

    return {
      bootstrapped: totalSynthesized > 0,
      entriesCount: ledgerStore.getAllEdges().length
    }
  } catch (err) {
    throw new WorkspaceError(
      WorkspaceErrorCode.WORKSPACE_WIKI_MIGRATION_FAILED,
      `Failed to bootstrap legacy archive to relational ledger: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }
}
