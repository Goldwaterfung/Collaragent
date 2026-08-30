import { 
  CreateInstanceRequest, 
  CreateInstanceResponseSchema, 
  ListInstancesResponseSchema, 
  ListInstancesResponse,
  InstanceSummary,
  UpdateInstanceRequest,
  GetInstanceByIdSchema,
  GetInstanceById
} from '../schemas/requests';
import { InstanceUpdateSchema } from '../schemas/instances';
import { NodeId, RelationshipId, asNodeId, asRelationshipId } from '@workspace/canvas/domain';
import { z } from 'zod';

// Event payload type for instance open events
export type InstanceOpenPayload = {
  instanceId?: string;
  instanceName?: string;
  projectName?: string;
};

// Typed Application Errors
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class InstanceService {
  private baseUrl: string;
  private instanceOpenListeners = new Set<(p: InstanceOpenPayload) => void>();

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {},
    responseSchema?: z.ZodType<T>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }
        throw new ApiError(
          response.status,
          `${options.method || 'GET'} ${endpoint} failed: ${response.statusText}`,
          errorData
        );
      }

      // If we don't expect a body (e.g. 204), return null as unknown as T
      if (response.status === 204) {
        return null as unknown as T;
      }

      const data = await response.json();

      if (responseSchema) {
        return responseSchema.parse(data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof z.ZodError) {
        throw new ApiError(500, 'Response Validation Error', error.issues);
      }
      throw new NetworkError((error as Error).message);
    }
  }

  async getAll(): Promise<InstanceSummary[]> {
    const data = await this.request(
      '/instances', 
      { method: 'GET' },
      ListInstancesResponseSchema
    ) as ListInstancesResponse;
    return data.instances;
  }

  async create(payload: CreateInstanceRequest): Promise<string> {
    const data = await this.request(
      '/instances',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      CreateInstanceResponseSchema
    );
    return data.id;
  }

  async getById(id: string): Promise<GetInstanceById> { 
    return this.request(
      `/instances/${id}`, 
      { method: 'GET' },
      GetInstanceByIdSchema
    );
  }

  async update(id: string, payload: UpdateInstanceRequest): Promise<void> {
    // Validate payload at runtime to catch any invalid data
    const validatedPayload = InstanceUpdateSchema.parse(payload);
    
    await this.request(
      `/instances/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(validatedPayload)
      }
    );
  }

  async delete(id: string): Promise<void> {
    await this.request(`/instances/${id}`, { method: 'DELETE' });
  }

  // Domain Helper Methods
  createNodeId(): NodeId {
    return asNodeId(crypto.randomUUID());
  }

  createRelationshipId(): RelationshipId {
    return asRelationshipId(crypto.randomUUID());
  }

  async findUniqueName(baseName: string, projectId: string): Promise<string> {
    const instances = await this.getAll();
    const existingNames = new Set(
      instances
        .filter(i => i.projectId === projectId)
        .map(i => i.name.toLowerCase().trim())
    );
    
    const normalizedBase = baseName.toLowerCase().trim();
    if (!existingNames.has(normalizedBase)) {
      return baseName;
    }
    
    let counter = 1;
    while (existingNames.has(`${normalizedBase} (${counter})`)) {
      counter++;
    }
    return `${baseName} (${counter})`;
  }

  async createDocumentWithUniqueName(baseName: string, projectId: string, metadata?: Record<string, any>): Promise<{ instanceId: string; name: string }> {
    const name = await this.findUniqueName(baseName, projectId);
    const instanceId = await this.create({
      name,
      type: 'document',
      projectId,
      metadata
    });
    return { instanceId, name };
  }

  /**
   * Finds an existing instance by its name within a specific project.
   */
  async findByName(name: string, projectId: string): Promise<InstanceSummary | undefined> {
    const instances = await this.getAll();
    return instances.find(
      (i) => i.name === name && i.projectId === projectId && i.type === 'document'
    );
  }

  // Instance open event bus (replaces global DOM events)
  subscribeToOpen(listener: (p: InstanceOpenPayload) => void) {
    this.instanceOpenListeners.add(listener);
    return () => this.instanceOpenListeners.delete(listener);
  }

  emitOpen(payload: InstanceOpenPayload) {
    for (const l of Array.from(this.instanceOpenListeners)) {
      try {
        l(payload);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('instanceService.subscribeToOpen listener error', err);
      }
    }
  }
}

export const instanceService = new InstanceService('/api');
