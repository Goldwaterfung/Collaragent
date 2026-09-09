import { TRANSFORMERS as LEXICAL_TRANSFORMERS, Transformer } from '@lexical/markdown'
import { TABLE } from './TableTransformer'
import { EQUATION, BLOCK_EQUATION } from './EquationTransformer'
import { CLAIM_BADGE_TRANSFORMER } from './ClaimBadgeTransformer'

export const TRANSFORMERS: Transformer[] = [
  ...LEXICAL_TRANSFORMERS,
  TABLE,
  EQUATION,
  BLOCK_EQUATION,
  CLAIM_BADGE_TRANSFORMER
]
