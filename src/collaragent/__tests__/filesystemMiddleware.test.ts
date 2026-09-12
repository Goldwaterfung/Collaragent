import { describe, it, expect, vi } from 'vitest'
import {
  createFilesystemMiddleware,
  COLLARAGENT_FILESYSTEM_TOOL_DESCRIPTIONS,
  FILESYSTEM_SYSTEM_PROMPT
} from '../middleware/filesystem.js'
import { ToolMessage, SystemMessage } from 'langchain'

describe('FilesystemMiddleware tool descriptions & boundaries', () => {
  it('supplies disambiguating tool descriptions for ls, read_file, write_file, edit_file, and delete by default', () => {
    const middleware = createFilesystemMiddleware()
    expect(middleware.tools).toBeDefined()

    const toolsByName = new Map((middleware.tools ?? []).map((t) => [t.name, t]))

    // ls must guide towards listWorkspaceItems
    const lsTool = toolsByName.get('ls')
    expect(lsTool).toBeDefined()
    expect(lsTool!.description).toContain('listWorkspaceItems')
    expect(lsTool!.description).toContain('DO NOT use this tool to discover workspace documents')

    // read_file must guide towards readDocument or readGraph
    const readFileTool = toolsByName.get('read_file')
    expect(readFileTool).toBeDefined()
    expect(readFileTool!.description).toContain('readDocument')
    expect(readFileTool!.description).toContain(
      'DO NOT use this tool to read studio workspace documents'
    )

    // write_file must guide towards createDocument or writeGraph
    const writeFileTool = toolsByName.get('write_file')
    expect(writeFileTool).toBeDefined()
    expect(writeFileTool!.description).toContain('createDocument')
    expect(writeFileTool!.description).toContain(
      'DO NOT use this tool to create or overwrite studio workspace documents'
    )

    // edit_file must guide towards editDocument
    const editFileTool = toolsByName.get('edit_file')
    expect(editFileTool).toBeDefined()
    expect(editFileTool!.description).toContain('editDocument')
    expect(editFileTool!.description).toContain(
      'DO NOT use this tool to modify studio workspace documents'
    )

    // delete must guide towards removeProject or editDocument
    const deleteTool = toolsByName.get('delete')
    expect(deleteTool).toBeDefined()
    expect(deleteTool!.description).toContain('removeProject')
    expect(deleteTool!.description).toContain(
      'DO NOT use this tool to delete studio workspace documents'
    )
  })

  it('allows caller to override specific tool descriptions', () => {
    const customDescription = 'Custom overridden ls description'
    const middleware = createFilesystemMiddleware({
      customToolDescriptions: {
        ls: customDescription
      }
    })

    const toolsByName = new Map((middleware.tools ?? []).map((t) => [t.name, t]))
    expect(toolsByName.get('ls')?.description).toBe(customDescription)
    // Non-overridden tools keep CollarAgent disambiguation defaults
    expect(toolsByName.get('read_file')?.description).toContain('readDocument')
  })

  it('injects SECONDARY filesystem tools prompt into systemPrompt via wrapModelCall', async () => {
    const middleware = createFilesystemMiddleware()
    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let capturedPrompt = ''
    const handler: HandlerType = async (req) => {
      capturedPrompt = req.systemPrompt || ''
      return { content: 'ok' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const mockRequest = {
      systemPrompt: 'Existing base prompt',
      runtime: {},
      state: {}
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, handler)

    expect(capturedPrompt).toContain('SECONDARY: Filesystem Tools (Host OS / Codebase Only)')
    expect(capturedPrompt).toContain('NEVER use filesystem tools')
    expect(capturedPrompt).toContain('createDocument')
    expect(capturedPrompt.startsWith('Existing base prompt')).toBe(true)
  })

  it('injects SECONDARY filesystem tools prompt into SystemMessage instances via wrapModelCall', async () => {
    const middleware = createFilesystemMiddleware()
    expect(middleware.wrapModelCall).toBeDefined()

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let capturedMessageContent = ''
    const handler: HandlerType = async (req) => {
      const msg = req.systemMessage as SystemMessage | undefined
      capturedMessageContent = typeof msg?.content === 'string' ? msg.content : ''
      return { content: 'ok' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    const mockRequest = {
      systemMessage: new SystemMessage('Existing system message'),
      runtime: {},
      state: {}
    } as unknown as RequestType

    await middleware.wrapModelCall!(mockRequest, handler)

    expect(capturedMessageContent).toContain(
      'SECONDARY: Filesystem Tools (Host OS / Codebase Only)'
    )
    expect(capturedMessageContent).toContain('NEVER use filesystem tools')
    expect(capturedMessageContent.startsWith('Existing system message')).toBe(true)
  })

  it('appends caller-provided systemPrompt alongside FILESYSTEM_SYSTEM_PROMPT', async () => {
    const callerPrompt = 'Caller custom filesystem instructions'
    const middleware = createFilesystemMiddleware({ systemPrompt: callerPrompt })

    type WrapModelCallType = NonNullable<typeof middleware.wrapModelCall>
    type RequestType = Parameters<WrapModelCallType>[0]
    type HandlerType = Parameters<WrapModelCallType>[1]

    let capturedPrompt = ''
    const handler: HandlerType = async (req) => {
      capturedPrompt = req.systemPrompt || ''
      return { content: 'ok' } as unknown as Awaited<ReturnType<HandlerType>>
    }

    await middleware.wrapModelCall!(
      { systemPrompt: 'Base', runtime: {}, state: {} } as unknown as RequestType,
      handler
    )

    expect(capturedPrompt).toContain('SECONDARY: Filesystem Tools (Host OS / Codebase Only)')
    expect(capturedPrompt).toContain(callerPrompt)
  })

  it('bypasses eviction for workspace tools (e.g. readDocument) even if payload exceeds 80KB', async () => {
    const middleware = createFilesystemMiddleware()
    expect(middleware.wrapToolCall).toBeDefined()

    const largePayload = 'X'.repeat(100000)
    const mockToolMessage = new ToolMessage({
      content: largePayload,
      tool_call_id: 'call_readDoc_test_456'
    })

    const handler = vi.fn().mockResolvedValue(mockToolMessage)
    const request = {
      toolCall: {
        name: 'readDocument',
        args: { instanceName: 'TestDoc' },
        id: 'call_readDoc_test_456'
      },
      runtime: {} as unknown as Parameters<
        NonNullable<typeof middleware.wrapToolCall>
      >[0]['runtime'],
      state: {} as unknown as Parameters<NonNullable<typeof middleware.wrapToolCall>>[0]['state']
    }

    const result = await middleware.wrapToolCall!(request, handler)

    expect(handler).toHaveBeenCalledWith(request)
    expect(result).toBe(mockToolMessage)
    if (ToolMessage.isInstance(result)) {
      expect(result.content).toBe(largePayload)
    }
  })
})
