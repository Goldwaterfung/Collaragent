/**
 * Canonical reasoning/thinking levels used across the app.
 *
 * These mirror pi-ai's `ModelThinkingLevel` vocabulary and are the single
 * source of truth shared by the renderer UI, IPC contracts, and the main
 * process configuration/model managers.
 */
export const REASONING_EFFORT_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const

export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number]
