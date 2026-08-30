/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { createCommand, LexicalCommand, LexicalNode } from "lexical";
import { BlockType } from "./editorConfig";

/** 
 * Payload for general block insertion 
 */
export type InsertBlockPayload = {
  type: BlockType;
  targetNode?: LexicalNode;
};

/**
 * Payload for equations
 */
export type InsertEquationPayload = {
  equation: string;
  inline?: boolean;
};

// --- Command Definitions ---

export const INSERT_NEW_BLOCK_COMMAND: LexicalCommand<InsertBlockPayload> = 
  createCommand("INSERT_NEW_BLOCK_COMMAND");

export const INSERT_EQUATION_COMMAND: LexicalCommand<InsertEquationPayload> = 
  createCommand("INSERT_EQUATION_COMMAND");

export const INSERT_PAGE_BREAK_COMMAND: LexicalCommand<void> =
  createCommand("INSERT_PAGE_BREAK_COMMAND");

export const INSERT_COMMENT_COMMAND: LexicalCommand<void> = 
  createCommand("INSERT_COMMENT_COMMAND");
