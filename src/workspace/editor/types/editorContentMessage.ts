import type { DocumentPayload } from "@workspace/persistence/editorContent.ts";

export type HelloMessage = {
  type: "hello";
  clientId?: string;
};

export type SubscribeMessage = {
  type: "subscribe";
  instanceId: string;
  clientId?: string;
};

export type UpdateMessage = {
  type: "update";
  instanceId: string;
  clientId?: string;
  payload: DocumentPayload;
};

export type RequestSyncMessage = {
  type: "requestSync";
  instanceId: string;
  clientId?: string;
};

export type WatchInstancesMessage = {
  type: "watchInstances";
  clientId?: string;
};

export type InstancesSyncMessage = {
  type: "instancesSync";
  instances: Array<{
    instanceId: string;
    updatedAt?: string;
    metadata?: Record<string, any>;
  }>;
};

export type InstanceCreatedMessage = {
  type: "instanceCreated";
  instance: { id: string; name: string; type: string; projectId?: string; updatedAt?: string; metadata?: Record<string, any> };
};

export type InstanceUpdatedMessage = {
  type: "instanceUpdated";
  instance: { id: string; name: string; type: string; projectId?: string; updatedAt?: string; metadata?: Record<string, any> };
};

export type InstanceDeletedMessage = {
  type: "instanceDeleted";
  instanceId: string;
};

export type EditorClientMessage =
  | HelloMessage
  | SubscribeMessage
  | UpdateMessage
  | RequestSyncMessage
  | WatchInstancesMessage;

export type EditorServerMessage = InstancesSyncMessage | { 
  type: "sync"; 
  instanceId: string; 
  payload: DocumentPayload; 
  from?: string | null;
  name?: string;
  instanceType?: 'document' | 'canvas';
  metadata?: Record<string, any>;
} | InstanceCreatedMessage | InstanceUpdatedMessage | InstanceDeletedMessage;

export type EditorMessage = EditorClientMessage | EditorServerMessage;

export function isInstancesSyncMessage(message: unknown): message is InstancesSyncMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const m = message as Partial<InstancesSyncMessage>;
  if (m.type !== "instancesSync" || !Array.isArray(m.instances)) {
    return false;
  }

  return m.instances.every((item) => typeof item?.instanceId === "string");
}
