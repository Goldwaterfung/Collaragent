import { z } from 'zod';
import { InstanceTypeSchema, InstanceUpdateSchema, GraphCanvasDTOSchema, DocumentSchema } from './instances';

// --- API DTOs ---

// POST /api/instances
export const CreateInstanceRequestSchema = z.object({
  name: z.string().min(1).max(100),
  projectId: z.string().min(1),
  type: InstanceTypeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateInstanceRequest = z.infer<typeof CreateInstanceRequestSchema>;

// PATCH /api/instances/:id
export { InstanceUpdateSchema };
export type UpdateInstanceRequest = z.infer<typeof InstanceUpdateSchema>;

export const CreateInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('created'),
});
export type CreateInstanceResponse = z.infer<typeof CreateInstanceResponseSchema>;

// GET /api/instances (List)
export const InstanceSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  type: InstanceTypeSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).transform((data) => ({
  ...data,
  instanceId: data.id,
}));
export type InstanceSummary = z.infer<typeof InstanceSummarySchema>;

export const ListInstancesResponseSchema = z.object({
  instances: z.array(InstanceSummarySchema),
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).optional().default([]),
});
export type ListInstancesResponse = z.infer<typeof ListInstancesResponseSchema>;

// GET /api/instances/:id
export const GetInstanceByIdSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  name: z.string(),
  type: InstanceTypeSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.union([GraphCanvasDTOSchema, DocumentSchema]).optional(),
});
export type GetInstanceById = z.infer<typeof GetInstanceByIdSchema>;
