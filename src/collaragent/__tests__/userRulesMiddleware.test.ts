import { describe, it, expect } from 'vitest'
import { SystemMessage } from 'langchain'
import { createUserRulesMiddleware } from '../middleware/user_rules.js'
import { dateMiddleware } from '../middleware/date.js'
import { createDeepAgent } from '../runtime/agent.js'

describe('UserRulesMiddleware & <user_rules> System Prompt Invariants', () => {
  it('wraps user rules inside <user_rules> tag and appends to systemPrompt', async () => {
    const rulesText = '- Always respond in Traditional Chinese (繁體中文).\n- Keep answers concise.'
    const middleware = createUserRulesMiddleware({ rules: rulesText })

    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalPrompt = ''
    const mockHandler: HandlerType = async (req) => {
      finalPrompt = req.systemPrompt || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const basePrompt = 'You are CollarAgent.'
    const mockRequest = {
      systemPrompt: basePrompt
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, mockHandler)

    expect(finalPrompt.startsWith(basePrompt)).toBe(true)
    expect(finalPrompt).toContain(
      '<user_rules>\n- Always respond in Traditional Chinese (繁體中文).\n- Keep answers concise.\n</user_rules>'
    )
  })

  it('handles SystemMessage correctly', async () => {
    const rulesText = '- Cite all sources using APA 7th edition.'
    const middleware = createUserRulesMiddleware({ rules: rulesText })

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalContent = ''
    const mockHandler: HandlerType = async (req) => {
      const sm = req.systemMessage as unknown as { content?: string } | undefined
      finalContent = typeof req.systemMessage === 'string' ? req.systemMessage : sm?.content || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const basePrompt = 'You are CollarAgent.'
    const mockRequest = {
      systemMessage: new SystemMessage(basePrompt)
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, mockHandler)

    expect(finalContent.startsWith(basePrompt)).toBe(true)
    expect(finalContent).toContain(
      '<user_rules>\n- Cite all sources using APA 7th edition.\n</user_rules>'
    )
  })

  it('no-ops without prompt mutation when rules are undefined or whitespace', async () => {
    const emptyMiddleware = createUserRulesMiddleware({ rules: '   \n  \t  ' })

    type WrapModelCallType = NonNullable<typeof emptyMiddleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalPrompt = ''
    const mockHandler: HandlerType = async (req) => {
      finalPrompt = req.systemPrompt || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const basePrompt = 'You are CollarAgent.'
    const mockRequest = {
      systemPrompt: basePrompt
    } as unknown as RequestType

    await emptyMiddleware.wrapModelCall!(mockRequest, mockHandler)

    expect(finalPrompt).toBe(basePrompt)
    expect(finalPrompt).not.toContain('<user_rules>')
  })

  it('maintains ordering: [Base Prompt] -> [<user_rules>] -> [## Runtime Context (Date)]', async () => {
    const userRules = '- Specific rule 1\n- Specific rule 2'
    const rulesMw = createUserRulesMiddleware({ rules: userRules })
    const dateMw = dateMiddleware()

    type WrapModelCallType = NonNullable<typeof rulesMw.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalPrompt = ''
    const basePrompt = 'You are CollarAgent.'

    // Simulate middleware chain: rulesMw -> dateMw -> handler
    const innerHandler: HandlerType = async (req) => {
      finalPrompt = req.systemPrompt || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const outerHandler: HandlerType = async (req) => {
      return dateMw.wrapModelCall!(req, innerHandler)
    }

    await rulesMw.wrapModelCall!(
      { systemPrompt: basePrompt } as unknown as RequestType,
      outerHandler
    )

    const baseIndex = finalPrompt.indexOf(basePrompt)
    const rulesIndex = finalPrompt.indexOf('<user_rules>')
    const dateIndex = finalPrompt.indexOf('## Runtime Context')

    expect(baseIndex).toBeGreaterThanOrEqual(0)
    expect(rulesIndex).toBeGreaterThan(baseIndex)
    expect(dateIndex).toBeGreaterThan(rulesIndex)
  })

  it('wires userRules into createDeepAgent successfully', () => {
    const agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      tools: [],
      userRules: '- Always format output nicely.',
      dynamicEnabled: false,
      workspaceReadOnly: true
    })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })
})
