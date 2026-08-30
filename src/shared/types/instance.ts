export type NormalizedInstanceSummary = {
  instanceId: string;
  projectId?: string;
  updatedAt?: string;
  name?: string;
  type?: 'document' | 'canvas';
  metadata?: Record<string, any>;
};
