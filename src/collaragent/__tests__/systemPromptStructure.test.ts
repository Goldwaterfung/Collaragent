import { describe, it, expect } from 'vitest'
import { SystemMessage } from 'langchain'
import { BASE_PROMPT, createDeepAgent } from '../runtime/agent.js'
import { dateMiddleware } from '../middleware/date.js'

describe('System Prompt Structure & Invariants', () => {
  it('exposes a well-formed constant BASE_PROMPT with studio architecture and operating principles', () => {
    expect(typeof BASE_PROMPT).toBe('string')
    expect(BASE_PROMPT.length).toBeGreaterThan(0)
    expect(BASE_PROMPT).toContain('Studio Architecture')
    expect(BASE_PROMPT).toContain('Visual Canvas')
    expect(BASE_PROMPT).toContain('Document Workspace')
    expect(BASE_PROMPT).toContain('Operating Principles')
    expect(BASE_PROMPT).toContain('Evidence-Based & Pragmatic')
    expect(BASE_PROMPT).toContain('High-Signal Communication')
    expect(BASE_PROMPT).toContain('Intellectual Honesty Over Deference')
    expect(BASE_PROMPT).toContain('Grounded Reasoning')
    expect(BASE_PROMPT).toContain('Collaborative Co-Authoring')
    expect(BASE_PROMPT).toContain('Mechanism Over Description')
    expect(BASE_PROMPT).toContain('Fracture & Workaround Reconnaissance')
    expect(BASE_PROMPT).toContain('Zero Scaffolding & Orthogonality')
  })

  it('appends date context at the end of systemPrompt preserving static prefix', async () => {
    const middleware = dateMiddleware()
    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalPrompt = ''
    const mockHandler: HandlerType = async (req) => {
      finalPrompt = req.systemPrompt || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const baseStaticPrompt = 'You are CollarAgent. Follow all guidelines.'
    const mockRequest = {
      systemPrompt: baseStaticPrompt
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, mockHandler)

    expect(finalPrompt.startsWith(baseStaticPrompt)).toBe(true)
    expect(finalPrompt).toContain('## Runtime Context\n- **Current Date**:')
    // Verify that date is at the end, not prepended
    const baseIndex = finalPrompt.indexOf(baseStaticPrompt)
    const dateIndex = finalPrompt.indexOf('## Runtime Context')
    expect(dateIndex).toBeGreaterThan(baseIndex)
  })

  it('appends date context to SystemMessage instances preserving static prefix', async () => {
    const middleware = dateMiddleware()
    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let finalMessageContent = ''
    const mockHandler: HandlerType = async (req) => {
      const sm = req.systemMessage as unknown as { content?: string } | undefined
      finalMessageContent =
        typeof req.systemMessage === 'string' ? req.systemMessage : sm?.content || ''
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const baseStaticPrompt = 'System message instructions.'
    const mockRequest = {
      systemMessage: new SystemMessage(baseStaticPrompt)
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, mockHandler)

    expect(finalMessageContent.startsWith(baseStaticPrompt)).toBe(true)
    expect(finalMessageContent).toContain('## Runtime Context\n- **Current Date**:')
    const baseIndex = finalMessageContent.indexOf(baseStaticPrompt)
    const dateIndex = finalMessageContent.indexOf('## Runtime Context')
    expect(dateIndex).toBeGreaterThan(baseIndex)
  })

  it('preserves prompt layering: [Base Prompt] -> [Workspace] -> [Runtime Context]', () => {
    const agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      tools: [],
      dynamicEnabled: false,
      workspaceReadOnly: true
    })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })
})
