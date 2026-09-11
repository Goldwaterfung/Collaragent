import { createMiddleware, SystemMessage } from 'langchain'

/**
 * Middleware for injecting the current date and time into the system prompt.
 *
 * Appends runtime context to the end of the system prompt to preserve
 * static prefix caching for upstream prompts, workspace definitions, and subagents.
 */
export function dateMiddleware() {
  return createMiddleware({
    name: 'DateMiddleware',

    wrapModelCall(request, handler) {
      const now = new Date()
      // Format: Monday, March 2, 2026
      const formattedDate = now.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })

      const dateSection = `## Runtime Context\n- **Current Date**: ${formattedDate}`

      if (request.systemPrompt !== undefined) {
        const currentSystemPrompt = request.systemPrompt || ''
        const newSystemPrompt = currentSystemPrompt
          ? `${currentSystemPrompt}\n\n${dateSection}`
          : dateSection
        return handler({ ...request, systemPrompt: newSystemPrompt })
      }

      if (request.systemMessage !== undefined) {
        const sysMsg = request.systemMessage
        let newSysMsg = sysMsg
        if (typeof sysMsg.concat === 'function') {
          newSysMsg = sysMsg.concat(`\n\n${dateSection}`)
        } else if (typeof sysMsg.content === 'string') {
          newSysMsg = new SystemMessage({
            content: `${sysMsg.content}\n\n${dateSection}`
          })
        }
        return handler({ ...request, systemMessage: newSysMsg })
      }

      return handler({ ...request, systemPrompt: dateSection })
    }
  })
}
