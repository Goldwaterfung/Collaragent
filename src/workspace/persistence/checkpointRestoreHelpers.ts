import type { InstanceType, WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import type { Command, EditorCommand } from '@shared/commands'
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from '@shared/constants'
import type { DocumentPayload } from '@shared/schemas/instances'
import { canonicalizeGraphCanvasDTO, type GraphCanvasDTO } from './graphCanvasDto'
import { applyEditorCommands } from '../editor/utils/editorCommandReducer'

export function selectWorkspaceCommands(
  entries: WorkspaceCommandLogEntry[],
  snapshotSeq: number,
  targetSeq: number
): WorkspaceCommandLogEntry[] {
  return entries.filter((entry) => entry.cursor.seq > snapshotSeq && entry.cursor.seq <= targetSeq)
}

export function applyWorkspaceCommands(
  payload: unknown,
  instanceType: InstanceType,
  entries: WorkspaceCommandLogEntry[]
): unknown {
  if (entries.length === 0) return payload

  if (instanceType === 'graph-canvas') {
    return applyCanvasCommands(
      payload,
      entries.map((entry) => entry.command as Command)
    )
  }

  if (instanceType === 'document') {
    const base = normalizeDocumentPayload(payload)
    return applyEditorCommands(
      base,
      entries.map((entry) => entry.command as EditorCommand)
    )
  }

  return payload
}

function isDocumentPayload(val: unknown): val is DocumentPayload {
  return (
    typeof val === 'object' &&
    val !== null &&
    'blocks' in val &&
    Array.isArray((val as { blocks: unknown }).blocks)
  )
}

function normalizeDocumentPayload(payload: unknown): DocumentPayload {
  if (isDocumentPayload(payload)) {
    return payload
  }
  return { blocks: [{ id: 'initial-paragraph', type: 'paragraph', content: '' }] }
}

function applyCanvasCommands(payload: unknown, commands: Command[]): GraphCanvasDTO {
  const base = normalizeCanvasPayload(payload)
  const next = cloneCanvasPayload(base)

  for (const command of commands) {
    applyCanvasCommand(next, command)
  }

  return canonicalizeGraphCanvasDTO(next)
}

function isGraphCanvasDTO(val: unknown): val is GraphCanvasDTO {
  return (
    typeof val === 'object' &&
    val !== null &&
    'type' in val &&
    (val as { type: unknown }).type === 'graph-canvas'
  )
}

function normalizeCanvasPayload(payload: unknown): GraphCanvasDTO {
  if (isGraphCanvasDTO(payload)) {
    return canonicalizeGraphCanvasDTO(payload)
  }

  return {
    schemaVersion: 1,
    type: 'graph-canvas',
    graph: { nodes: {}, relationships: {} },
    layout: { layoutByNodeId: {} },
    meta: {}
  }
}

function cloneCanvasPayload(payload: GraphCanvasDTO): GraphCanvasDTO {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as GraphCanvasDTO
}

function applyCanvasCommand(payload: GraphCanvasDTO, command: Command): void {
  switch (command.type) {
    case 'graph:add_node':
      payload.graph.nodes[command.nodeId] = {
        id: command.nodeId,
        type: 'card',
        name: command.entity.name,
        attrs: command.entity.attrs || {}
      }
      payload.layout.layoutByNodeId[command.nodeId] = {
        x: command.position.x,
        y: command.position.y,
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT
      }
      break
    case 'graph:update_node':
      if (payload.graph.nodes[command.nodeId]) {
        Object.assign(payload.graph.nodes[command.nodeId], command.changes)
      }
      break
    case 'graph:update_node_layout':
      if (!payload.layout.layoutByNodeId[command.nodeId]) {
        payload.layout.layoutByNodeId[command.nodeId] = {
          x: 0,
          y: 0,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT
        }
      }
      Object.assign(payload.layout.layoutByNodeId[command.nodeId], command.layout)
      break
    case 'graph:remove_node': {
      delete payload.graph.nodes[command.nodeId]
      delete payload.layout.layoutByNodeId[command.nodeId]
      // Cascade delete all connected relationships to preserve graph integrity
      for (const [relId, rel] of Object.entries(payload.graph.relationships)) {
        if (rel.from.nodeId === command.nodeId || rel.to.nodeId === command.nodeId) {
          delete payload.graph.relationships[relId]
        }
      }
      break
    }
    case 'graph:add_relationship':
      payload.graph.relationships[command.relationshipId] = {
        id: command.relationshipId,
        from: {
          nodeId: command.relationship.from.nodeId,
          portId: command.relationship.from.portId
        },
        to: {
          nodeId: command.relationship.to.nodeId,
          portId: command.relationship.to.portId
        },
        attrs: command.relationship.attrs || {}
      }
      break
    case 'graph:update_relationship':
      if (payload.graph.relationships[command.relationshipId]) {
        const rel = payload.graph.relationships[command.relationshipId]
        Object.assign(rel, command.changes)
      }
      break
    case 'graph:remove_relationship':
      delete payload.graph.relationships[command.relationshipId]
      break
    default:
      break
  }
}
