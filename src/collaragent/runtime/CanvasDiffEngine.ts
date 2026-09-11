import { CanvasSnapshot } from '@workspace/canvas/domain/types'
import { CanvasCommand } from '@shared/commands'
import { createCardinalPorts } from '@workspace/canvas/domain/portUtils'
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@shared/constants'
import { WriteGraphSpec, applyGraphSpec } from '@workspace/wstools/graphSchemaConverter'
import {
  GraphCanvasDTO,
  GraphCanvasNodeDTO,
  GraphCanvasRelationshipDTO,
  NodeLayout
} from '@workspace/persistence/graphCanvasDto'
import { asNodeId, asRelationshipId, asPortId } from '@shared/canvas/entities'

export class CanvasDiffEngine {
  /**
   * Computes the list of commands needed to transition from `currentGraph` to the state described by `spec`.
   */
  static computeDiff(
    snapshot: CanvasSnapshot | null | undefined,
    spec: WriteGraphSpec
  ): CanvasCommand[] {
    // 1. Convert Current Domain Graph -> DTO (for the legacy converter to work)
    const currentDto = this.domainToDto(snapshot)

    // 2. Calculate Projected DTO using existing logic
    // This handles layout, auto-positioning, and merge/replace logic
    const projectedDto = applyGraphSpec(currentDto, spec)

    // 3. Diff DTOs (Projected vs Current) to generate Atomic Commands
    return this.diffDtos(currentDto, projectedDto)
  }

  /**
   * Computes the list of commands needed to transition directly from `currentGraph` snapshot to `projectedDto`.
   */
  static computeDiffFromDto(
    snapshot: CanvasSnapshot | null | undefined,
    projectedDto: GraphCanvasDTO
  ): CanvasCommand[] {
    const currentDto = this.domainToDto(snapshot)
    return this.diffDtos(currentDto, projectedDto)
  }

  /**
   * Diffs two GraphCanvasDTO instances and generates atomic CanvasCommands.
   */
  public static diffDtos(
    currentDto: GraphCanvasDTO | null,
    projectedDto: GraphCanvasDTO
  ): CanvasCommand[] {
    const commands: CanvasCommand[] = []
    const currentLayoutByNodeId = currentDto?.layout?.layoutByNodeId ?? {}

    // --- RELATIONSHIPS ---
    const currentRels = currentDto ? currentDto.graph.relationships : {}
    const projectedRels = projectedDto.graph.relationships

    // A. Remove Relationships first, before node removals.
    for (const relId of Object.keys(currentRels)) {
      if (!projectedRels[relId]) {
        commands.push({
          type: 'graph:remove_relationship',
          relationshipId: asRelationshipId(relId)
        })
      }
    }

    // --- NODES ---
    const currentNodes = currentDto ? currentDto.graph.nodes : {}
    const projectedNodes = projectedDto.graph.nodes

    // B. Remove Nodes
    for (const nodeId of Object.keys(currentNodes)) {
      if (!projectedNodes[nodeId]) {
        commands.push({
          type: 'graph:remove_node',
          nodeId: asNodeId(nodeId)
        })
      }
    }

    // B. Add/Update Nodes
    for (const nodeId of Object.keys(projectedNodes)) {
      const projNode = projectedNodes[nodeId]
      const currNode = currentNodes[nodeId]
      const layout = projectedDto.layout.layoutByNodeId[nodeId]

      if (!currNode) {
        // ADD
        commands.push({
          type: 'graph:add_node',
          nodeId: asNodeId(nodeId),
          entity: {
            id: asNodeId(nodeId),
            type: 'card',
            name: projNode.name,
            attrs: projNode.attrs || {},
            ports: createCardinalPorts(
              asNodeId(nodeId),
              layout?.width ?? DEFAULT_NODE_WIDTH,
              layout?.height ?? DEFAULT_NODE_HEIGHT
            )
          },
          position: {
            x: layout?.x ?? 0,
            y: layout?.y ?? 0
          }
        })
      } else {
        // UPDATE (Check name and attrs)
        const attrsChanged =
          JSON.stringify(currNode.attrs || {}) !== JSON.stringify(projNode.attrs || {})
        if (currNode.name !== projNode.name || attrsChanged) {
          commands.push({
            type: 'graph:update_node',
            nodeId: asNodeId(nodeId),
            changes: {
              name: projNode.name,
              attrs: projNode.attrs || {}
            }
          })
        }
        // Check layout update (Movement and Dimensions)
        if (layout && currNode) {
          const currLayout = currentLayoutByNodeId[nodeId]
          const posChanged = !currLayout || currLayout.x !== layout.x || currLayout.y !== layout.y
          const sizeChanged = Boolean(
            currLayout &&
            ((layout.width !== undefined && currLayout.width !== layout.width) ||
              (layout.height !== undefined && currLayout.height !== layout.height))
          )

          if (posChanged || sizeChanged) {
            commands.push({
              type: 'graph:update_node_layout',
              nodeId: asNodeId(nodeId),
              layout: {
                x: layout.x,
                y: layout.y,
                ...(sizeChanged ? { width: layout.width, height: layout.height } : {})
              }
            })
          }
        }
      }
    }

    // C. Add / Update Relationships
    for (const relId of Object.keys(projectedRels)) {
      const projRel = projectedRels[relId]
      const currRel = currentRels[relId]

      if (!currRel) {
        commands.push({
          type: 'graph:add_relationship',
          relationshipId: asRelationshipId(relId),
          relationship: {
            id: asRelationshipId(relId),
            from: {
              nodeId: asNodeId(projRel.from.nodeId),
              ...(projRel.from.portId ? { portId: asPortId(projRel.from.portId) } : {})
            },
            to: {
              nodeId: asNodeId(projRel.to.nodeId),
              ...(projRel.to.portId ? { portId: asPortId(projRel.to.portId) } : {})
            },
            attrs: projRel.attrs || {}
          }
        })
      } else {
        const attrsChanged =
          JSON.stringify(currRel.attrs || {}) !== JSON.stringify(projRel.attrs || {})
        if (attrsChanged) {
          commands.push({
            type: 'graph:update_relationship',
            relationshipId: asRelationshipId(relId),
            changes: {
              attrs: projRel.attrs || {}
            }
          })
        }
      }
    }

    return commands
  }

  private static domainToDto(snapshot: CanvasSnapshot | null | undefined): GraphCanvasDTO | null {
    if (!snapshot || !snapshot.graph) return null
    const snapRecord = snapshot as unknown as Record<string, unknown>
    const graph = snapRecord.graph as Record<string, unknown> | undefined
    if (!graph) return null

    const sourceLayout = (snapRecord.layoutByNodeId || snapRecord.layout || {}) as Record<
      string,
      unknown
    >

    // Convert Domain Graph back to DTO structure for the Converter
    const nodes: Record<string, GraphCanvasNodeDTO> = {}
    const sourceNodes = (graph.nodes || graph.nodesById || {}) as Record<string, unknown>

    for (const [id, nodeVal] of Object.entries(sourceNodes)) {
      if (!nodeVal || typeof nodeVal !== 'object') continue
      const node = nodeVal as Record<string, unknown>
      nodes[id] = {
        id: String(node.id ?? id),
        type: 'card',
        name: typeof node.name === 'string' ? node.name : String(node.id ?? id),
        attrs:
          node.attrs && typeof node.attrs === 'object'
            ? (node.attrs as Record<string, unknown>)
            : {}
      }
    }

    const relationships: Record<string, GraphCanvasRelationshipDTO> = {}
    const sourceRels = (graph.relationships || graph.relationshipsById || {}) as Record<
      string,
      unknown
    >

    for (const [id, relVal] of Object.entries(sourceRels)) {
      if (!relVal || typeof relVal !== 'object') continue
      const rel = relVal as Record<string, unknown>
      const fromObj = rel.from as Record<string, unknown> | undefined
      const toObj = rel.to as Record<string, unknown> | undefined

      relationships[id] = {
        id: String(rel.id ?? id),
        from: {
          nodeId: String(fromObj?.nodeId ?? ''),
          ...(fromObj?.portId ? { portId: String(fromObj.portId) } : {})
        },
        to: {
          nodeId: String(toObj?.nodeId ?? ''),
          ...(toObj?.portId ? { portId: String(toObj.portId) } : {})
        },
        attrs:
          rel.attrs && typeof rel.attrs === 'object' ? (rel.attrs as Record<string, unknown>) : {}
      }
    }

    // Map layout
    const layoutByNodeId: Record<string, NodeLayout> = {}
    for (const [id, lVal] of Object.entries(sourceLayout)) {
      if (!lVal || typeof lVal !== 'object') continue
      const l = lVal as Record<string, unknown>
      layoutByNodeId[id] = {
        x: typeof l.x === 'number' ? l.x : 0,
        y: typeof l.y === 'number' ? l.y : 0,
        width: typeof l.width === 'number' && l.width > 0 ? l.width : DEFAULT_NODE_WIDTH,
        height: typeof l.height === 'number' && l.height > 0 ? l.height : DEFAULT_NODE_HEIGHT
      }
    }

    return {
      schemaVersion: 1,
      type: 'graph-canvas',
      graph: { nodes, relationships },
      layout: { layoutByNodeId },
      meta: {}
    }
  }
}
