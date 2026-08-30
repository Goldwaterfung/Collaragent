export interface InstanceContentStore {
  readContent(instanceId: string): Promise<any>;
  writeContent(instanceId: string, content: any): Promise<void>;
  deleteContent(instanceId: string): Promise<void>;
}
