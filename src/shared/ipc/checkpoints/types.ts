export type CheckpointBundleSummary = {
  id: string
  createdAt: string
  label?: string
  reason?: 'auto' | 'restore'
  threadId: string
  sessionId: string
  chatMessageId?: string
  projectId?: string
}

export type CheckpointCreateRequest = {
  threadId: string
  projectId: string
  includeInstances: 'active' | 'open' | 'all' | string[]
  activeInstanceId?: string
  openInstanceIds?: string[]
  label?: string
  reason?: 'auto' | 'restore'
}

export type CheckpointCreateResponse = {
  bundle: CheckpointBundleSummary
}

export type CheckpointRestoreRequest = {
  threadId: string
  bundleId: string
  createAutoCheckpoint?: boolean
  reason?: 'auto' | 'restore'
  projectId?: string
}

export type CheckpointRestoreResponse = {
  restored: true
}

export type CheckpointListRequest = {
  threadId: string
  projectId?: string
}

export type CheckpointListResponse = {
  bundles: CheckpointBundleSummary[]
}

export type CheckpointCancelRequest = {
  threadId?: string
}

export type CheckpointCancelResponse = {
  canceled: true
}
