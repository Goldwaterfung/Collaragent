import type { ToolCall } from './types'
import type { SubagentTask } from '../../types/ui'
import type { SubagentSessionData } from '@shared/agents/types'

/**
 * Type-safe parser to rehydrate SubagentTask and its nested SubagentSessionData
 * from a ToolCall entity.
 */
export function parseSubagentTaskFromToolCall(tc: ToolCall): SubagentTask {
  const desc = typeof tc.args['description'] === 'string' ? tc.args['description'] : ''

  const subType =
    typeof tc.args['subagent_type'] === 'string'
      ? tc.args['subagent_type']
      : tc.name === 'task'
        ? 'general-purpose'
        : 'custom'

  let resultStr: string | undefined
  let session: SubagentSessionData | undefined

  if (tc.result && typeof tc.result === 'object') {
    const resObj = tc.result as Record<string, unknown>
    if ('summary' in resObj && typeof resObj['summary'] === 'string') {
      resultStr = resObj['summary']
      session = tc.result as SubagentSessionData
    } else {
      resultStr = JSON.stringify(tc.result)
    }
  } else if (typeof tc.result === 'string') {
    resultStr = tc.result
    try {
      const parsed = JSON.parse(tc.result) as unknown
      if (parsed && typeof parsed === 'object' && parsed !== null && 'summary' in parsed) {
        const parsedObj = parsed as Record<string, unknown>
        if (typeof parsedObj['summary'] === 'string') {
          resultStr = parsedObj['summary']
          session = parsed as SubagentSessionData
        }
      }
    } catch {
      // plain text result
    }
  }

  const isCompleted = tc.status === 'completed' || !!resultStr

  return {
    id: tc.id,
    toolName: tc.name as 'task' | 'dynamic_task',
    subagentType: subType,
    description: desc,
    status: tc.status === 'error' ? 'error' : isCompleted ? 'completed' : 'running',
    result: resultStr,
    session,
    startedAt: Date.now(),
    completedAt: isCompleted ? Date.now() : undefined
  }
}
