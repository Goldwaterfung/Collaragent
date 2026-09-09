import { describe, it, expect } from 'vitest'
import { createSkillsMiddleware, MANDATORY_SKILL_CONTRACT_PROMPT } from '../middleware/skills'
import { FilesystemBackend } from 'deepagents'
import { SystemMessage } from '@langchain/core/messages'
import { getBuiltinSkillsDir, getAllSkills, resolveSkillByName } from '../../main/handlers/skills'
import { ConfigManager } from '../../main/config/ConfigManager'
import path from 'node:path'

describe('CollarAgent SkillsMiddleware & Slash Command Ingestion', () => {
  it('defines the mandatory agent contract without line limit guardrail', () => {
    expect(MANDATORY_SKILL_CONTRACT_PROMPT).toContain('### MANDATORY AGENT CONTRACT:')
    expect(MANDATORY_SKILL_CONTRACT_PROMPT).toContain('Explicit Skill Invocations (<SKILL> tag)')
    expect(MANDATORY_SKILL_CONTRACT_PROMPT).toContain('Implicit Relevance')
    expect(MANDATORY_SKILL_CONTRACT_PROMPT).toContain('Strict Compliance')
    // Verify guardrail is removed per instruction
    expect(MANDATORY_SKILL_CONTRACT_PROMPT).not.toContain('limit=500')
  })

  it('augments the system message via wrapModelCall to enforce mandatory contract and slash commands', async () => {
    const builtinDir = path.resolve(__dirname, '../skills')
    const middleware = createSkillsMiddleware({
      backend: new FilesystemBackend({ rootDir: '/' }),
      sources: [builtinDir]
    })

    expect(middleware.wrapModelCall).toBeDefined()

    let passedSystemPrompt = ''
    let passedSystemMessageContent = ''

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    const mockHandler: HandlerType = async (req) => {
      passedSystemPrompt = req.systemPrompt || ''
      if (req.systemMessage) {
        const sm = req.systemMessage as unknown as { content?: string }
        passedSystemMessageContent =
          typeof req.systemMessage === 'string' ? req.systemMessage : sm.content || ''
      }
      return { content: 'test response' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const mockRequest = {
      systemPrompt: 'Base system prompt.',
      systemMessage: new SystemMessage('Base system prompt.')
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, mockHandler)

    expect(passedSystemPrompt).toBe('Base system prompt.')
    expect(passedSystemMessageContent).toContain('### MANDATORY AGENT CONTRACT:')
    expect(passedSystemMessageContent).toContain('Slash Commands & Skill Ingestion')
    expect(passedSystemMessageContent).toContain('<SKILL>The user requested you read and use')
  })

  it('locates the built-in skills directory correctly', () => {
    const dir = getBuiltinSkillsDir()
    expect(dir).toBeTruthy()
    expect(dir).toContain('skills')
  })

  it('lists built-in skills even when user source is empty', () => {
    const mockConfigManager = {
      getConfig: () => ({
        middleware: {
          skills: {
            enabled: true,
            source: ''
          }
        }
      })
    } as unknown as ConfigManager

    const { skills, errors } = getAllSkills(mockConfigManager)
    expect(errors).toEqual([])
    expect(skills.length).toBeGreaterThan(0)

    const skillNames = skills.map((s) => s.name)
    expect(skillNames).toContain('focused-execution-specialist')
    expect(skillNames).toContain('apa-research-execution-specialist')
    expect(skillNames).toContain('holistic-thinking-analyst')
  })

  it('resolves a skill by name case-insensitively', () => {
    const mockConfigManager = {
      getConfig: () => ({
        middleware: {
          skills: {
            enabled: true,
            source: ''
          }
        }
      })
    } as unknown as ConfigManager

    const resolved = resolveSkillByName('focused-execution-specialist', mockConfigManager)
    expect(resolved).toBeTruthy()
    expect(resolved?.name).toBe('focused-execution-specialist')
    expect(resolved?.sourcePath).toBe('builtin')
    expect(resolved?.skillMdPath).toContain('SKILL.md')

    const upperResolved = resolveSkillByName('FOCUSED-EXECUTION-SPECIALIST', mockConfigManager)
    expect(upperResolved).toBeTruthy()
    expect(upperResolved?.name).toBe('focused-execution-specialist')
  })
})
