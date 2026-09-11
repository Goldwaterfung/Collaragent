import { createMiddleware, SystemMessage } from 'langchain'

export interface UserRulesMiddlewareOptions {
  rules?: string
}

/**
 * Middleware for injecting user-defined rules (<user_rules>) into the system prompt.
 *
 * Appends user rules before volatile runtime context (such as dateMiddleware)
 * to enforce user behavioral constraints while preserving prompt prefix KV caching.
 */
export function createUserRulesMiddleware(options: UserRulesMiddlewareOptions = {}) {
  const rawRules = options.rules?.trim()

  return createMiddleware({
    name: 'UserRulesMiddleware',

    wrapModelCall(request, handler) {
      if (!rawRules) {
        return handler(request)
      }

      const rulesSection = `<user_rules>\n${rawRules}\n</user_rules>`

      if (request.systemPrompt !== undefined) {
        const currentSystemPrompt = request.systemPrompt || ''
        const newSystemPrompt = currentSystemPrompt
          ? `${currentSystemPrompt}\n\n${rulesSection}`
          : rulesSection
        return handler({ ...request, systemPrompt: newSystemPrompt })
      }

      if (request.systemMessage !== undefined) {
        const sysMsg = request.systemMessage
        let newSysMsg = sysMsg
        if (typeof sysMsg.concat === 'function') {
          newSysMsg = sysMsg.concat(`\n\n${rulesSection}`)
        } else if (typeof sysMsg.content === 'string') {
          newSysMsg = new SystemMessage({
            content: `${sysMsg.content}\n\n${rulesSection}`
          })
        }
        return handler({ ...request, systemMessage: newSysMsg })
      }

      return handler({ ...request, systemPrompt: rulesSection })
    }
  })
}
