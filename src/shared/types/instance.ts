export type NormalizedInstanceSummary = {
  instanceId: string
  projectId?: string
  updatedAt?: string
  name?: string
  type?: 'document' | 'canvas' | 'ledger'
  metadata?: Record<string, unknown>
}
