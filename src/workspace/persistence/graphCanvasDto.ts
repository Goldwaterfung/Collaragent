import { z } from 'zod'

const UUID_V4ISH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NODE_PREFIXED_UUID_PATTERN =
  /^node-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export function isCanonicalNodeId(value: string): boolean {
  return UUID_V4ISH_PATTERN.test(value) || NODE_PREFIXED_UUID_PATTERN.test(value)
}

function createUuid(): string {
  const randomUuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.()
  if (randomUuid) return randomUuid

  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 12).join('')}-${hex.slice(12, 16).join('')}`
}

export function generateCanonicalNodeId(): string {
  return createUuid()
}

const EndpointRefSchema = z.object({
  nodeId: z.string().min(1),
  portId: z.string().min(1).optional()
})

const GraphCanvasNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal('card'),
  name: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional()
})

const GraphCanvasRelationshipSchema = z.object({
  id: z.string().min(1),
  from: EndpointRefSchema,
  to: EndpointRefSchema,

  attrs: z.record(z.string(), z.unknown()).optional()
})

const NodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const GraphCanvasDTOSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('graph-canvas'),
  graph: z.object({
    nodes: z.record(z.string(), GraphCanvasNodeSchema),
    relationships: z.record(z.string(), GraphCanvasRelationshipSchema)
  }),
  layout: z.object({
    layoutByNodeId: z.record(z.string(), NodeLayoutSchema)
  }),
  meta: z
    .object({
      createdAt: z.string().optional(),
      updatedAt: z.string().optional()
    })
    .optional()
})

export type NodeLayout = z.infer<typeof NodeLayoutSchema>
export type GraphCanvasNodeDTO = z.infer<typeof GraphCanvasNodeSchema>
export type GraphCanvasRelationshipDTO = z.infer<typeof GraphCanvasRelationshipSchema>

export type GraphCanvasDTO = z.infer<typeof GraphCanvasDTOSchema>

export function isGraphCanvasDTO(value: unknown): value is GraphCanvasDTO {
  return GraphCanvasDTOSchema.safeParse(value).success
}

export function canonicalizeGraphCanvasDTO(value: unknown): GraphCanvasDTO {
  const parsed = GraphCanvasDTOSchema.parse(value)
  const assignedNodeIds = new Set<string>()

  const canonicalNodes: GraphCanvasDTO['graph']['nodes'] = {}
  const canonicalNodeIdBySource = new Map<string, string>()

  for (const [rawKey, rawNode] of Object.entries(parsed.graph.nodes)) {
    const sourceKey = rawKey.trim()
    const sourceNodeId = (rawNode.id || sourceKey).trim()

    let canonicalNodeId =
      canonicalNodeIdBySource.get(sourceKey) ?? canonicalNodeIdBySource.get(sourceNodeId)

    const sourceCandidate = sourceNodeId || sourceKey
    if (!canonicalNodeId) {
      canonicalNodeId = isCanonicalNodeId(sourceCandidate)
        ? sourceCandidate
        : generateCanonicalNodeId()
    }

    if (assignedNodeIds.has(canonicalNodeId)) {
      canonicalNodeId = generateCanonicalNodeId()
    }

    assignedNodeIds.add(canonicalNodeId)
    canonicalNodeIdBySource.set(sourceKey, canonicalNodeId)
    canonicalNodeIdBySource.set(sourceNodeId, canonicalNodeId)

    canonicalNodes[canonicalNodeId] = {
      ...rawNode,
      id: canonicalNodeId
    }
  }

  const canonicalLayoutByNodeId: GraphCanvasDTO['layout']['layoutByNodeId'] = {}
  for (const [layoutNodeId, layout] of Object.entries(parsed.layout.layoutByNodeId)) {
    const canonicalNodeId =
      canonicalNodeIdBySource.get(layoutNodeId) ??
      (isCanonicalNodeId(layoutNodeId) ? layoutNodeId : undefined)

    if (!canonicalNodeId) {
      continue
    }
    if (!canonicalNodes[canonicalNodeId]) {
      continue
    }

    canonicalLayoutByNodeId[canonicalNodeId] = layout
  }

  for (const canonicalNodeId of Object.keys(canonicalNodes)) {
    if (!canonicalLayoutByNodeId[canonicalNodeId]) {
      canonicalLayoutByNodeId[canonicalNodeId] = {
        x: 0,
        y: 0,
        width: 400,
        height: 300
      }
    }
  }

  const canonicalRelationships: GraphCanvasDTO['graph']['relationships'] = {}
  for (const [relationshipId, relationship] of Object.entries(parsed.graph.relationships)) {
    const fromNodeId =
      canonicalNodeIdBySource.get(relationship.from.nodeId) ??
      (isCanonicalNodeId(relationship.from.nodeId) ? relationship.from.nodeId : undefined)
    const toNodeId =
      canonicalNodeIdBySource.get(relationship.to.nodeId) ??
      (isCanonicalNodeId(relationship.to.nodeId) ? relationship.to.nodeId : undefined)

    if (!fromNodeId || !toNodeId || !canonicalNodes[fromNodeId] || !canonicalNodes[toNodeId]) {
      throw new Error(
        `[graph-migration] Invalid relationship endpoint during node-id canonicalization: ${relationshipId}`
      )
    }

    canonicalRelationships[relationshipId] = {
      ...relationship,
      from: {
        ...relationship.from,
        nodeId: fromNodeId
      },
      to: {
        ...relationship.to,
        nodeId: toNodeId
      }
    }
  }

  const canonicalDto: GraphCanvasDTO = {
    ...parsed,
    graph: {
      nodes: canonicalNodes,
      relationships: canonicalRelationships
    },
    layout: {
      layoutByNodeId: canonicalLayoutByNodeId
    },
    meta: parsed.meta
  }

  return canonicalDto
}

export function migrateGraphCanvasDTO(value: unknown): GraphCanvasDTO {
  return canonicalizeGraphCanvasDTO(value)
}
