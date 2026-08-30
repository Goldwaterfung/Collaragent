/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

export const BLOCK_TYPE_TO_BLOCK_NAME = {
  paragraph: "Normal",
  h1: "Large Heading",
  h2: "Small Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  ol: "Numbered List",
  ul: "Bulleted List",
  quote: "Quote",
  code: "Code Block",
  pagebreak: "Page Break",
  equation: "Equation",
} as const;

export type BlockType = keyof typeof BLOCK_TYPE_TO_BLOCK_NAME;

export const SUPPORTED_BLOCK_TYPES = new Set<string>([
  "paragraph",
  "quote",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "pagebreak",
  "equation",
]);
