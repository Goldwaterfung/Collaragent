import { describe, it, expect } from 'vitest'
import { createWorkspaceMiddleware } from '../middleware/workspace'
import { isWorkspaceTool, WORKSPACE_TOOL_NAMES } from '@shared/constants'
import { getCodeRecommendFix } from '../tools/WorkspaceTools'
import { WorkspaceErrorCode } from '@shared/errors/WorkspaceErrors'

describe('WorkspaceMiddleware & Tool Standards', () => {
  it('guarantees 100% unique tool names in activeTools (preventing provider 400 invalid_request_error)', () => {
    const middleware = createWorkspaceMiddleware({ readOnly: false })
    expect(middleware.tools).toBeDefined()

    const toolNames = (middleware.tools ?? []).map((t) => t.name)
    const uniqueToolNames = new Set(toolNames)

    // Critical assertion: zero duplicate tool names
    expect(toolNames.length).toBe(uniqueToolNames.size)
    expect(toolNames).toContain('compileGraph')
    expect(toolNames).toContain('lintWorkspace')
    expect(toolNames).toContain('readDocument')
    expect(toolNames).toContain('createDocument')
    expect(toolNames).toContain('editDocument')
    expect(toolNames).toContain('listWorkspaceItems')
    expect(toolNames).toContain('readGraph')
    expect(toolNames).toContain('writeGraph')
    expect(toolNames).toContain('writeMindMap')
    expect(toolNames).toContain('ingestSource')
    expect(toolNames).toContain('queryAndFileBack')
    expect(toolNames).toContain('pruneLedger')
    expect(toolNames).toContain('createProject')
    expect(toolNames).toContain('removeProject')
  })

  it('restricts activeTools to read-only tools when readOnly is true without duplicates', () => {
    const middleware = createWorkspaceMiddleware({ readOnly: true })
    const toolNames = (middleware.tools ?? []).map((t) => t.name)
    const uniqueToolNames = new Set(toolNames)

    expect(toolNames.length).toBe(uniqueToolNames.size)
    expect(toolNames).toEqual(['readDocument', 'listWorkspaceItems', 'readGraph', 'lintWorkspace'])
    expect(toolNames).not.toContain('createDocument')
    expect(toolNames).not.toContain('compileGraph')
    expect(toolNames).not.toContain('ingestSource')
    expect(toolNames).not.toContain('pruneLedger')
  })

  it('ensures all active tools conform to the isWorkspaceTool contract in WORKSPACE_TOOL_NAMES', () => {
    const middleware = createWorkspaceMiddleware({ readOnly: false })
    const toolNames = (middleware.tools ?? []).map((t) => t.name)

    for (const name of toolNames) {
      expect(isWorkspaceTool(name)).toBe(true)
      expect(WORKSPACE_TOOL_NAMES).toContain(name)
    }
  })

  it('provides structured actionable recommendations for all WORKSPACE_WIKI_* error codes', () => {
    const wikiErrorCodes = [
      WorkspaceErrorCode.WORKSPACE_WIKI_ENTITY_COLLISION,
      WorkspaceErrorCode.WORKSPACE_WIKI_UNRESOLVED_SYMBOL,
      WorkspaceErrorCode.WORKSPACE_WIKI_CIRCULAR_SUPERSEDENCE,
      WorkspaceErrorCode.WORKSPACE_WIKI_CYCLE_DETECTED,
      WorkspaceErrorCode.WORKSPACE_WIKI_COMPILATION_FAILED,
      WorkspaceErrorCode.WORKSPACE_WIKI_INVALID_LINK_SCHEMA,
      WorkspaceErrorCode.WORKSPACE_WIKI_ANCHOR_BLOCK_NOT_FOUND,
      WorkspaceErrorCode.WORKSPACE_WIKI_LEDGER_SYNC_FAILED,
      WorkspaceErrorCode.WORKSPACE_WIKI_MIGRATION_FAILED
    ]

    for (const code of wikiErrorCodes) {
      const fix = getCodeRecommendFix(code)
      expect(fix).toBeDefined()
      expect(typeof fix).toBe('string')
      expect(fix!.length).toBeGreaterThan(10)
    }
  })

  it('injects PRIMARY: Workspace Tools hierarchy and operational boundaries into systemPrompt', async () => {
    const middleware = createWorkspaceMiddleware({ readOnly: false })
    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let capturedPrompt = ''
    const handler: HandlerType = async (req) => {
      capturedPrompt = req.systemPrompt || ''
      return { content: 'ok' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    await middleware.wrapModelCall!(
      { systemPrompt: 'Initial base prompt' } as unknown as RequestType,
      handler
    )

    expect(capturedPrompt).toContain('PRIMARY: Workspace Tools (Studio Knowledge Surfaces)')
    expect(capturedPrompt).toContain('NEVER attempt to use filesystem tools')
    expect(capturedPrompt).toContain('listWorkspaceItems')
  })
})
