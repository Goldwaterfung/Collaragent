export type InstanceSummary = {
  instanceId?: string;
  projectId?: string;
  updatedAt?: string;
  name?: string;
  type?: 'document' | 'canvas';
  metadata?: Record<string, any>;
};

import { NormalizedInstanceSummary } from "@shared/types/instance";

export type { NormalizedInstanceSummary };

export const DEFAULT_INSTANCE_ID = "";

export function sortSummariesByName<T extends InstanceSummary>(instances: readonly T[]): T[] {
  return [...instances].sort((a, b) => {
    const nameA = (a.name || a.instanceId || "").toLowerCase();
    const nameB = (b.name || b.instanceId || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

export function normalizeInstanceIds(
  instances: readonly InstanceSummary[],
  defaultInstanceId: string = DEFAULT_INSTANCE_ID,
): string[] {
  const sorted = sortSummariesByName(instances);
  const ids = sorted
    .map((item) => (typeof item.instanceId === "string" ? item.instanceId.trim() : ""))
    .filter((id): id is string => id.length > 0 && id !== defaultInstanceId);
  // Do not force defaultInstanceId if it is empty or "default"
  return ids;
}

export function normalizeInstanceSummaries(
  instances: readonly InstanceSummary[],
  defaultInstanceId: string = DEFAULT_INSTANCE_ID,
): NormalizedInstanceSummary[] {
  const sorted = sortSummariesByName(instances);
  const seen = new Set<string>();
  const normalized: NormalizedInstanceSummary[] = [];

  for (const summary of sorted) {
    const id = typeof summary.instanceId === "string" ? summary.instanceId.trim() : "";
    if (id.length === 0 || id === defaultInstanceId || id === "default") continue;

    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      instanceId: id,
      projectId: summary.projectId,
      updatedAt: summary.updatedAt,
      name: summary.name,
      type: summary.type,
      metadata: summary.metadata,
    });
  }

  return normalized;
}

export function normalizeInstanceIdList(
  ids: readonly string[],
  defaultInstanceId: string = DEFAULT_INSTANCE_ID,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id || id === defaultInstanceId || id === "default" || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function areInstanceIdListsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

