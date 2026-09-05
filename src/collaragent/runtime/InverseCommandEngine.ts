import { WorkspaceCommandLogEntry } from '@shared/checkpoints/types'
import { Command } from '@shared/commands'
import { NodeEntity, RelationshipEntity } from '@shared/canvas'

export class InverseCommandEngine {
  /**
   * Computes the "Undo" command for a given log entry using its captured previous state.
   */
  static invert(entry: WorkspaceCommandLogEntry): Command | null {
    const { command, previousState } = entry
    const cmd = command as Command | null | undefined
    if (!cmd || typeof cmd !== 'object' || !('type' in cmd)) return null

    switch (cmd.type) {
      // --- Canvas Inversions ---

      case 'graph:add_node':
        return {
          type: 'graph:remove_node',
          nodeId: cmd.nodeId
        }

      case 'graph:remove_node':
        if (previousState?.removedEntity && previousState?.layout) {
          return {
            type: 'graph:add_node',
            nodeId: cmd.nodeId,
            entity: previousState.removedEntity as NodeEntity,
            position: { x: previousState.layout.x, y: previousState.layout.y }
          }
        }
        return null

      case 'graph:update_node':
        if (previousState?.node) {
          return {
            type: 'graph:update_node',
            nodeId: cmd.nodeId,
            changes: previousState.node as Partial<Omit<NodeEntity, 'id'>>
          }
        }
        return null

      case 'graph:update_node_layout':
        if (previousState?.layout) {
          return {
            type: 'graph:update_node_layout',
            nodeId: cmd.nodeId,
            layout: previousState.layout
          }
        }
        return null

      case 'graph:add_relationship':
        return {
          type: 'graph:remove_relationship',
          relationshipId: cmd.relationshipId
        }

      case 'graph:remove_relationship':
        if (previousState?.removedRelationships && previousState.removedRelationships.length > 0) {
          return {
            type: 'graph:add_relationship',
            relationshipId: cmd.relationshipId,
            relationship: previousState.removedRelationships[0] as RelationshipEntity
          }
        }
        return null

      case 'graph:update_relationship':
        if (previousState?.removedRelationships && previousState.removedRelationships.length > 0) {
          const prevRel = previousState.removedRelationships[0] as RelationshipEntity | undefined
          return {
            type: 'graph:update_relationship',
            relationshipId: cmd.relationshipId,
            changes:
              prevRel && typeof prevRel === 'object' && 'attrs' in prevRel && prevRel.attrs
                ? (prevRel.attrs as Partial<Omit<RelationshipEntity, 'id'>>)
                : {}
          }
        }
        return null

      // --- Editor Inversions ---

      case 'editor:insert_block':
        return {
          type: 'editor:remove_block',
          blockId: (cmd.block as { id: string }).id
        }

      case 'editor:remove_block':
        if (previousState?.block && previousState.index !== undefined) {
          return {
            type: 'editor:insert_block',
            index: previousState.index,
            block: previousState.block
          }
        }
        return null

      case 'editor:update_block':
        if (previousState?.block && typeof previousState.block === 'object') {
          // Extract only the fields that were modified (stored in previousState.block)
          const blockObj = previousState.block as Record<string, unknown>
          const { id: _id, ...changes } = blockObj
          return {
            type: 'editor:update_block',
            blockId: cmd.blockId,
            changes
          }
        }
        return null

      case 'editor:replace_document':
        if (previousState?.documentPayload) {
          return {
            type: 'editor:replace_document',
            payload: previousState.documentPayload
          }
        }
        return null

      case 'editor:update_comments': {
        const docPayload = previousState?.documentPayload as
          { comments?: Record<string, unknown> } | undefined
        if (docPayload?.comments) {
          return {
            type: 'editor:update_comments',
            comments: docPayload.comments
          }
        }
        return null
      }

      default:
        console.warn(
          `[InverseCommandEngine] No inversion rule for command type: ${(cmd as { type?: string }).type}`
        )
        return null
    }
  }
}
