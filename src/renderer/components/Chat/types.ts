export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status?: 'pending' | 'completed' | 'error'
}
