import type { ClaimBadge } from '@shared/wiki'
import type { ExtractedClaimBadge } from './LinkExtractor'

/**
 * Union representing wiki claim badges within documents and workspace instances.
 */
export type WikiClaimBadge = ClaimBadge | ExtractedClaimBadge
export type { ExtractedClaimBadge }
