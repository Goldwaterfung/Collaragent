export const COLLAR_CHECKPOINT_RESTORED_EVENT = 'collar:checkpoint-restored'

export interface CheckpointRestoredDetail {
  readonly threadId: string
  readonly bundleId: string
  readonly timestamp: number
}
