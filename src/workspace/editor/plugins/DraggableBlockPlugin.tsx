/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import * as React from "react";
import {
  type DragEvent as ReactDragEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { eventFiles } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  type LexicalEditor
} from "lexical";

import { isHTMLElement } from "../utils/guard";
import { Point } from "../utils/point";
import { Rect } from "../utils/rect";

const SPACE = 24;
const TARGET_LINE_HALF_HEIGHT = 2;
const DRAGGABLE_BLOCK_MENU_CLASSNAME = "draggable-block-menu";
const DRAG_DATA_FORMAT = "application/x-lexical-drag-block";
const TEXT_BOX_HORIZONTAL_PADDING = 36;

const Downward = 1;
const Upward = -1;
const Indeterminate = 0;

let prevIndex = Infinity;

function getCurrentIndex(keysLength: number): number {
  if (keysLength === 0) {
    return Infinity;
  }
  if (prevIndex >= 0 && prevIndex < keysLength) {
    return prevIndex;
  }

  return Math.floor(keysLength / 2);
}

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
    let index = getCurrentIndex(topLevelNodeKeys.length);
    let direction = Indeterminate;

    while (index >= 0 && index < topLevelNodeKeys.length) {
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

      const {
        reason: { isOnBottomSide, isOnTopSide },
        result
      } = rect.contains(point);

      if (result) {
        blockElem = elem;
        prevIndex = index;
        break;
      }

      if (direction === Indeterminate) {
        if (isOnTopSide) {
          direction = Upward;
        } else if (isOnBottomSide) {
          direction = Downward;
        } else {
          // stop search block element
          direction = Infinity;
        }
      }

      index += direction;
    }
  });

  return blockElem;
}

function isOnMenu(element: HTMLElement): boolean {
  return !!element.closest(`.${DRAGGABLE_BLOCK_MENU_CLASSNAME}`);
}

function getElementScale(element: HTMLElement): { scaleX: number; scaleY: number } {
  const rect = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;

  // When a parent applies CSS transforms (e.g. Canvas zoom via scale()),
  // getBoundingClientRect() is in viewport (scaled) pixels but offsetWidth/Height
  // are in the element's local (unscaled) layout pixels.
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

  // Convert viewport deltas into local (unscaled) coordinates for the portal.
  const top =
    (targetRect.top - anchorElementRect.top) / scaleY +
    (lineHeight - floatingHeight) / 2;

  // Keep the visual spacing constant under zoom.
  const left = SPACE / scaleX;

  floatingElem.style.opacity = "1";
  floatingElem.style.transform = `translate(${left}px, ${top}px)`;
}

function setDragImage(
  dataTransfer: DataTransfer,
  draggableBlockElem: HTMLElement
) {
  const { transform } = draggableBlockElem.style;

  // Remove dragImage borders
  draggableBlockElem.style.transform = "translateZ(0)";
  dataTransfer.setDragImage(draggableBlockElem, 0, 0);

  setTimeout(() => {
    draggableBlockElem.style.transform = transform;
  });
}

function setTargetLine(
  targetLineElem: HTMLElement,
  targetBlockElem: HTMLElement,
  mouseY: number,
  anchorElem: HTMLElement
) {
  const targetStyle = window.getComputedStyle(targetBlockElem);
  const { scaleX, scaleY } = getElementScale(anchorElem);

  const targetRect = targetBlockElem.getBoundingClientRect();
  const anchorRect = anchorElem.getBoundingClientRect();

  const targetBlockElemHeight = targetRect.height;
  const targetBlockElemTop = targetRect.top;

  let lineTop = (targetBlockElemTop - anchorRect.top) / scaleY;
  // At the bottom of the target
  if (mouseY - targetBlockElemTop > targetBlockElemHeight / 2) {
    lineTop +=
      targetBlockElemHeight / scaleY + parseFloat(targetStyle.marginBottom);
  } else {
    lineTop -= parseFloat(targetStyle.marginTop);
  }

  const top = lineTop - TARGET_LINE_HALF_HEIGHT / scaleY;
  const left = (TEXT_BOX_HORIZONTAL_PADDING - SPACE) / scaleX;

  targetLineElem.style.transform = `translate(${left}px, ${top}px)`;
  const anchorWidthLocal = anchorElem.offsetWidth;
  targetLineElem.style.width = `${anchorWidthLocal - ((TEXT_BOX_HORIZONTAL_PADDING - SPACE) / scaleX) * 2
    }px`;
  targetLineElem.style.opacity = ".4";
}

function hideTargetLine(targetLineElem: HTMLElement | null) {
  if (targetLineElem) {
    targetLineElem.style.opacity = "0";
    targetLineElem.style.transform = "translate(-10000px, -10000px)";
  }
}

function useDraggableBlockMenu(
  editor: LexicalEditor,
  anchorElem: HTMLElement,
  isEditable: boolean
): React.JSX.Element {
  const scrollerElem = anchorElem.parentElement;

  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  const [
    draggableBlockElem,
    setDraggableBlockElem
  ] = useState<HTMLElement | null>(null);

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
    function onDragover(event: DragEvent): boolean {
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const { clientY, target } = event;
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event);
      const targetLineElem = targetLineRef.current;
      if (targetBlockElem === null || targetLineElem === null) {
        return false;
      }
      setTargetLine(targetLineElem, targetBlockElem, clientY, anchorElem);
      // Prevent default event to be able to trigger onDrop events
      event.preventDefault();
      return true;
    }

    function onDrop(event: DragEvent): boolean {
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const { dataTransfer, clientY, target } = event;
      const dragData = dataTransfer?.getData(DRAG_DATA_FORMAT) || "";
      let draggedNode = $getNodeByKey(dragData);

      // Handle Card Drop (application/x-careerapp-node)
      if (!draggedNode) {
        const nodeData = dataTransfer?.getData("application/x-careerapp-node");
        if (nodeData) {
          try {
            const node = JSON.parse(nodeData);
            // Create a text node with the link format [[node.id]]
            draggedNode = $createTextNode(`[[${node.id}]]`);
          } catch (e) {
            // Ignore
          }
        }
      }

      if (!draggedNode) {
        return false;
      }
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event);
      if (!targetBlockElem) {
        return false;
      }
      const targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) {
        return false;
      }
      if (targetNode === draggedNode) {
        return true;
      }
      const { height, top } = targetBlockElem.getBoundingClientRect();
      const shouldInsertAfter = clientY - top > height / 2;
      if (shouldInsertAfter) {
        targetNode.insertAfter(draggedNode);
      } else {
        targetNode.insertBefore(draggedNode);
      }
      setDraggableBlockElem(null);

      return true;
    }

    return mergeRegister(
      editor.registerCommand(
        DRAGOVER_COMMAND,
        (event) => {
          return onDragover(event);
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          return onDrop(event);
        },
        COMMAND_PRIORITY_HIGH
      )
    );
  }, [anchorElem, editor]);

  function onDragStart(event: ReactDragEvent<HTMLDivElement>): void {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !draggableBlockElem) {
      return;
    }
    setDragImage(dataTransfer, draggableBlockElem);
    let nodeKey = "";
    // Use an active editor context. This matters when multiple compatible
    // editors are on the page, since EditorState.read() doesn't provide one.
    editor.update(
      () => {
        const node = $getNearestNodeFromDOMNode(draggableBlockElem);
        if (node) {
          nodeKey = node.getKey();
        }
      },
      { discrete: true }
    );
    dataTransfer.setData(DRAG_DATA_FORMAT, nodeKey);
    dataTransfer.effectAllowed = 'copyMove';
    event.stopPropagation();
  }

  function onDragEnd(): void {
    hideTargetLine(targetLineRef.current);
  }

  return createPortal(
    <>
      <div
        className="icon draggable-block-menu"
        draggable={true}
        ref={menuRef}
        onDragEnd={onDragEnd}
        onDragStart={onDragStart}
      >
        <div className={isEditable ? "icon" : ""} />
      </div>
      <div className="draggable-block-target-line" ref={targetLineRef} />
    </>,
    anchorElem
  );
}

export default function DraggableBlockPlugin({
  anchorElem = document.body
}: {
  anchorElem?: HTMLElement;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  return useDraggableBlockMenu(editor, anchorElem, editor._editable);
}
