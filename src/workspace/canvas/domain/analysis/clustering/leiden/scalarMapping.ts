export type ScalarMappingResult = {
  weight: number;
  sign: 1 | -1;
  layer: string;
};

const DEFAULT_LAYER = 'default';
const MIN_WEIGHT = 1e-6;
const MAX_WEIGHT = 1e6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFinitePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function toSign(value: unknown): 1 | -1 {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 1;
    return value < 0 ? -1 : 1;
  }

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '-1' || v === 'negative' || v === 'neg' || v === 'false' || v === 'no') return -1;
    if (v === '+1' || v === '1' || v === 'positive' || v === 'pos' || v === 'true' || v === 'yes') return 1;
    return 1;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : -1;
  }

  return 1;
}

function toLayer(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_LAYER;
  const trimmed = value.trim();
  return trimmed ? trimmed : DEFAULT_LAYER;
}

/**
 * Converts free-form relationship attrs into stable numeric clustering scalars.
 *
 * Conventions (all optional):
 * - attrs.weight: number | numeric string (default 1)
 * - attrs.sign: -1/+1 | 'negative'/'positive' | boolean (default +1)
 * - attrs.layer: string (default 'default')
 */
export function mapRelationshipAttrsToScalars(
  attrs: Record<string, unknown> | undefined,
): ScalarMappingResult {
  const weightRaw = toFinitePositiveNumber(attrs?.weight);
  const sign = toSign(attrs?.sign);
  const layer = toLayer(attrs?.layer);

  const weight = clamp(weightRaw ?? 1, MIN_WEIGHT, MAX_WEIGHT);

  return { weight, sign, layer };
}
