/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import * as React from "react";
import {
  useEffect,
  useRef,
  useState,
  useCallback
} from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNearestNodeFromDOMNode,
  $getRoot,
  COMMAND_PRIORITY_EDITOR,
  type LexicalEditor
} from "lexical";

import { isHTMLElement } from "../utils/guard";
import { Point } from "../utils/point";
import { Rect } from "../utils/rect";
import { BLOCK_TYPE_TO_BLOCK_NAME, SUPPORTED_BLOCK_TYPES, BlockType } from "../utils/editorConfig";
import { insertAfterAndSelect } from "../utils/nodeUtils";
import { INSERT_NEW_BLOCK_COMMAND, InsertBlockPayload } from "../utils/commands";
import DropDown, { DropDownItem } from "../ui/DropDown";

const SPACE = 6;
const INSERT_BLOCK_MENU_CLASSNAME = "insert-block-menu";

function getTopLevelNodeKeys(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() => $getRoot().getChildrenKeys());
}

function getBlockElement(
  anchorElem: HTMLElement,
  editor: LexicalEditor,
  event: MouseEvent
): HTMLElement | null {
  const anchorElementRect = anchorElem.getBoundingClientRect();
  const topLevelNodeKeys = getTopLevelNodeKeys(editor);

  let blockElem: HTMLElement | null = null;

  editor.getEditorState().read(() => {
    let index = 0;
    while (index < topLevelNodeKeys.length) {
      const key = topLevelNodeKeys[index];
      const elem = editor.getElementByKey(key);
      if (elem === null) {
        break;
      }
      const point = new Point(event.x, event.y);
      const domRect = Rect.fromDOM(elem);
      const { marginBottom, marginTop } = window.getComputedStyle(elem);

      const rect = domRect.generateNewRect({
        bottom: domRect.bottom + parseFloat(marginBottom),
        left: anchorElementRect.left,
        right: anchorElementRect.right,
        top: domRect.top - parseFloat(marginTop)
      });

      if (rect.contains(point).result) {
        blockElem = elem;
        break;
      }

      index++;
    }
  });

  return blockElem;
}

function isOnMenu(element: HTMLElement): boolean {
  return (
    !!element.closest(`.${INSERT_BLOCK_MENU_CLASSNAME}`) ||
    !!element.closest(".draggable-block-menu") ||
    !!element.closest(".dropdown")  // DropDown portals its panel to document.body
  );
}

function getElementScale(element: HTMLElement): { scaleX: number; scaleY: number } {
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const scaleX = width > 0 ? rect.width / width : 1;
  const scaleY = height > 0 ? rect.height / height : 1;
  return {
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
  };
}

function setMenuPosition(
  targetElem: HTMLElement | null,
  floatingElem: HTMLElement,
  anchorElem: HTMLElement
) {
  if (!targetElem) {
    floatingElem.style.opacity = "0";
    floatingElem.style.transform = "translate(-10000px, -10000px)";
    return;
  }

  const { scaleX, scaleY } = getElementScale(anchorElem);
  const targetRect = targetElem.getBoundingClientRect();
  const targetStyle = window.getComputedStyle(targetElem);
  const anchorElementRect = anchorElem.getBoundingClientRect();

  const lineHeight = parseInt(targetStyle.lineHeight, 10) || 0;
  const floatingHeight = floatingElem.offsetHeight;

  const top = (targetRect.top - anchorElementRect.top) / scaleY + (lineHeight - floatingHeight) / 2;
  const left = SPACE / scaleX;

  floatingElem.style.opacity = "1";
  floatingElem.style.transform = `translate(${left}px, ${top}px)`;
}

export default function InsertBlockPlugin({
  anchorElem = document.body
}: {
  anchorElem?: HTMLElement;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());

  useEffect(() => {
    return editor.registerEditableListener((nextIsEditable) => {
      setIsEditable(nextIsEditable);
    });
  }, [editor]);

  const scrollerElem = anchorElem.parentElement;
  const menuRef = useRef<HTMLDivElement>(null);
  const [draggableBlockElem, setDraggableBlockElem] = useState<HTMLElement | null>(null);
  // Stable ref so insertNewBlock always has the last confirmed block,
  // even when mouse moves over the portalled dropdown panel and clears the state.
  const targetBlockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const target = event.target;
      if (!isHTMLElement(target)) {
        setDraggableBlockElem(null);
        return;
      }
      if (isOnMenu(target)) {
        return;
      }

      const _draggableBlockElem = getBlockElement(anchorElem, editor, event);
      setDraggableBlockElem(_draggableBlockElem);
      if (_draggableBlockElem !== null) {
        targetBlockRef.current = _draggableBlockElem;
      }
    }

    function onMouseLeave() {
      setDraggableBlockElem(null);
    }

    scrollerElem?.addEventListener("mousemove", onMouseMove);
    scrollerElem?.addEventListener("mouseleave", onMouseLeave);

    return () => {
      scrollerElem?.removeEventListener("mousemove", onMouseMove);
      scrollerElem?.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [scrollerElem, anchorElem, editor]);

  useEffect(() => {
    if (menuRef.current) {
      setMenuPosition(draggableBlockElem, menuRef.current, anchorElem);
    }
  }, [anchorElem, draggableBlockElem]);

  useEffect(() => {
    return editor.registerCommand<InsertBlockPayload>(
      INSERT_NEW_BLOCK_COMMAND,
      (payload) => {
        const { type, targetNode } = payload;
        if (targetNode) {
          insertAfterAndSelect(editor, targetNode, type);
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  const insertNewBlock = useCallback((type: BlockType) => {
    // Use the stable ref — draggableBlockElem state may be null by the time
    // the user clicks an item inside the portalled dropdown panel.
    const blockElem = targetBlockRef.current;
    if (blockElem) {
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(blockElem);
        if (node) {
          editor.dispatchCommand(INSERT_NEW_BLOCK_COMMAND, {
            type,
            targetNode: node
          });
        }
      });
    }
  }, [editor]);

  if (!isEditable) {
    return null;
  }

  return createPortal(
    <div
      className={INSERT_BLOCK_MENU_CLASSNAME}
      ref={menuRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 10,
      }}
    >
      <DropDown
        buttonClassName="icon plus"
        buttonAriaLabel="Insert block below"
        hideChevron
      >
        {Array.from(SUPPORTED_BLOCK_TYPES).map((type) => (
          <DropDownItem
            key={type}
            className="item"
            onClick={() => insertNewBlock(type as BlockType)}
            title={BLOCK_TYPE_TO_BLOCK_NAME[type as BlockType]}
          >
            <span className={`icon block-type ${type}`} />
            <span className="text">{BLOCK_TYPE_TO_BLOCK_NAME[type as BlockType]}</span>
          </DropDownItem>
        ))}
      </DropDown>
    </div>,
    anchorElem
  );
}
