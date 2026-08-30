import { TRANSFORMERS as LEXICAL_TRANSFORMERS, Transformer } from "@lexical/markdown";
import { TABLE } from "./TableTransformer";
import { EQUATION, BLOCK_EQUATION } from "./EquationTransformer";

export const TRANSFORMERS: Transformer[] = [
  ...LEXICAL_TRANSFORMERS,
  TABLE,
  EQUATION,
  BLOCK_EQUATION,
];
