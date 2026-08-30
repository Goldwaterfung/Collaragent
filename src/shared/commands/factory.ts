import { nanoid } from 'nanoid';
import { 
  AddNodeCommand, 
  UpdateNodeCommand, 
  RemoveNodeCommand, 
  AddRelationshipCommand, 
  RemoveRelationshipCommand 
} from './types';
import { NodeEntity, RelationshipEntity, NodeId, RelationshipId } from '@workspace/canvas/domain';

export const Commands = {
  addNode(
    entity: Omit<NodeEntity, 'id'> & { id?: string },
    position: { x: number; y: number } = { x: 0, y: 0 }
  ): AddNodeCommand {
    const id = (entity.id || nanoid()) as NodeId;
    return {
      type: 'graph:add_node',
      nodeId: id,
      entity: { ...entity, id } as NodeEntity,
      position
    };
  },

  updateNode(
    nodeId: string,
    changes: Partial<Omit<NodeEntity, 'id'>>
  ): UpdateNodeCommand {
    return {
      type: 'graph:update_node',
      nodeId: nodeId as NodeId,
      changes
    };
  },

  removeNode(nodeId: string): RemoveNodeCommand {
    return {
      type: 'graph:remove_node',
      nodeId: nodeId as NodeId
    };
  },

  addRelationship(
    relationship: Omit<RelationshipEntity, 'id'> & { id?: string }
  ): AddRelationshipCommand {
    const id = (relationship.id || nanoid()) as RelationshipId;
    return {
      type: 'graph:add_relationship',
      relationshipId: id,
      relationship: { ...relationship, id } as RelationshipEntity
    };
  },

  removeRelationship(relationshipId: string): RemoveRelationshipCommand {
    return {
      type: 'graph:remove_relationship',
      relationshipId: relationshipId as RelationshipId
    };
  }
};
