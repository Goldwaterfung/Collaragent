import { z } from 'zod'
import { WorkspaceCommandLogEntrySchema, WorkspaceSnapshotSchema } from '../checkpoints/validators'
import type { WorkspaceCommandLogEntry, WorkspaceSnapshot } from '../checkpoints/types'

export class CheckpointService {
  private baseUrl: string

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    schema?: z.ZodType<T>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    })

    if (!response.ok) {
      let detail: unknown
      try {
        detail = await response.json()
      } catch {
        detail = await response.text()
      }
      throw new Error(`Checkpoint API error (${response.status}): ${JSON.stringify(detail)}`)
    }

    if (response.status === 204) {
      return null as unknown as T
    }

    const data = await response.json()
    return schema ? schema.parse(data) : (data as T)
  }

  async createWorkspaceSnapshot(payload: {
    instanceId: string
    instanceType: WorkspaceSnapshot['instanceType']
    projectId: string
    snapshot: unknown
    snapshotCursor: WorkspaceSnapshot['snapshotCursor']
  }): Promise<WorkspaceSnapshot> {
    return this.request(
      '/checkpoints/workspace/snapshots',
      { method: 'POST', body: JSON.stringify(payload) },
      WorkspaceSnapshotSchema
    )
  }

  async getWorkspaceSnapshot(
    snapshotId: string
  ): Promise<{ snapshot: WorkspaceSnapshot; payload?: unknown }> {
    const schema = z.object({
      snapshot: WorkspaceSnapshotSchema,
      payload: z.unknown().optional()
    })
    return this.request(`/checkpoints/workspace/snapshots/${snapshotId}`, { method: 'GET' }, schema)
  }

  async getWorkspaceLogs(instanceId: string): Promise<WorkspaceCommandLogEntry[]> {
    const schema = z.object({
      entries: z.array(WorkspaceCommandLogEntrySchema)
    })
    const data = await this.request(
      `/checkpoints/workspace/logs/${instanceId}`,
      { method: 'GET' },
      schema
    )
    return data.entries as WorkspaceCommandLogEntry[]
  }
}

export const checkpointService = new CheckpointService('/api')
