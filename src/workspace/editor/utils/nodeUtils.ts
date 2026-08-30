/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  LexicalEditor,
  $createNodeSelection,
  $setSelection,
} from "lexical";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  HeadingTagType,
} from "@lexical/rich-text";
import { $createCodeNode } from "@lexical/code";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
  $createListNode,
  $createListItemNode,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $getNearestNodeOfType } from "@lexical/utils";
import { BlockType } from "./editorConfig";
import { $createPageBreakNode } from "../nodes/PageBreakNode";
import { $createEquationNode } from "../nodes/EquationNode";

/**
 * Handles block type changes (Heading, Quote, Code, Paragraph)
 */
export function setBlockType(
  editor: LexicalEditor,
  blockType: string,
  targetType: BlockType
): void {
  if (blockType !== targetType) {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (targetType === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else if (targetType === "h1" || targetType === "h2" || targetType === "h3" || targetType === "h4") {
          $setBlocksType(selection, () => $createHeadingNode(targetType as HeadingTagType));
        } else if (targetType === "quote") {
          $setBlocksType(selection, () => $createQuoteNode());
        } else if (targetType === "code") {
          $setBlocksType(selection, () => $createCodeNode());
        }
      }
    });
  }
}

/**
 * Handles list type toggling
 */
export function setListType(
  editor: LexicalEditor,
  blockType: string,
  targetType: "ul" | "ol"
): void {
  if (blockType !== targetType) {
    editor.dispatchCommand(
      targetType === "ol" ? INSERT_ORDERED_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
      undefined
    );
  } else {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  }
}

/**
 * Gets the block type of the current selection
 */
export function getSelectedBlockType(selection: any): string {
  if (!$isRangeSelection(selection)) {
    return "paragraph";
  }
  const anchorNode = selection.anchor.getNode();
  const element =
    anchorNode.getKey() === "root"
      ? anchorNode
      : anchorNode.getTopLevelElementOrThrow();

  if ($isListNode(element)) {
    const parentList = $getNearestNodeOfType(anchorNode, ListNode);
    return parentList ? parentList.getTag() : (element as ListNode).getTag();
  } else {
    return $isHeadingNode(element) ? element.getTag() : element.getType();
  }
}

/**
 * Inserts a new node after the target node and selects it
 */
export function insertAfterAndSelect(
  editor: LexicalEditor,
  targetNode: any,
  targetType: BlockType
): void {
  editor.update(() => {
    let newBlock;
    // Hoisted so the selection step below can target the EquationNode
    // directly, not the paragraph wrapper.
    let equationNode: ReturnType<typeof $createEquationNode> | undefined;

    if (targetType === "paragraph") {
      newBlock = $createParagraphNode();
    } else if (targetType === "h1" || targetType === "h2" || targetType === "h3" || targetType === "h4") {
      newBlock = $createHeadingNode(targetType as HeadingTagType);
    } else if (targetType === "quote") {
      newBlock = $createQuoteNode();
    } else if (targetType === "code") {
      newBlock = $createCodeNode();
    } else if (targetType === "ul") {
      newBlock = $createListNode("bullet");
      newBlock.append($createListItemNode());
    } else if (targetType === "ol") {
      newBlock = $createListNode("number");
      newBlock.append($createListItemNode());
    } else if (targetType === "pagebreak") {
      newBlock = $createPageBreakNode();
    } else if (targetType === "equation") {
      const wrapper = $createParagraphNode();
      equationNode = $createEquationNode("", true);
      wrapper.append(equationNode);
      newBlock = wrapper;
    }

    if (newBlock) {
      targetNode.insertAfter(newBlock);

      if (targetType === "equation" && equationNode) {
        // Select the EquationNode itself — this is what triggers
        // the inline KaTeX editor to open, just like ToolBarPlugin does.
        const selection = $createNodeSelection();
        selection.add(equationNode.getKey());
        $setSelection(selection);
      } else if (targetType === "pagebreak") {
        // PageBreakNode is a non-inline DecoratorNode — calling .select()
        // on it directly rolls back the entire update transaction (Lexical
        // cannot place a caret inside a decorator). Mirror PageBreakPlugin:
        // move the cursor to the next sibling block, or create a trailing
        // paragraph so the user can keep typing.
        const after = newBlock.getNextSibling();
        if (after) {
          after.selectStart();
        } else {
          const trailing = $createParagraphNode();
          newBlock.insertAfter(trailing);
          trailing.select();
        }
      } else {
        newBlock.select();
      }
    }
  });
}
