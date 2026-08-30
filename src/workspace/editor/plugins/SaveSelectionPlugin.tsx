import { useState, useEffect, useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister, registerNestedElementResolver } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $getNodeByKey,
  type NodeKey,
  type NodeMutation
} from "lexical";
import {
  $createMarkNode,
  $isMarkNode,
  $wrapSelectionInMarkNode,
  $unwrapMarkNode,
  $getMarkIDs,
  MarkNode
} from "@lexical/mark";

const SELECTION_MARK_ID = "SOME_UNIQUE_ID";

type MarkNodeMap = Map<string, Set<NodeKey>>;

type MutationRecord = Map<NodeKey, NodeMutation>;

export default function SaveSelectionPlugin(): null {
  const [editor] = useLexicalComposerContext();
  const markNodeMap = useMemo<MarkNodeMap>(() => new Map(), []);
  const [activeIDs, setActiveIDs] = useState<string[]>([]);

  useEffect(() => {
    const handleBlur = () => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }

        const { anchor, focus } = selection;
        if (anchor.key === focus.key && anchor.offset === focus.offset) {
          return;
        }

        const isBackward = selection.isBackward();

        // Wrap content in a MarkNode so we can restore selection later.
        $wrapSelectionInMarkNode(selection, isBackward, SELECTION_MARK_ID);

        // Make selection collapsed at the end.
        if (isBackward) {
          focus.set(anchor.key, anchor.offset, anchor.type);
        } else {
          anchor.set(focus.key, focus.offset, focus.type);
        }
      });
      const nativeSelection = window.getSelection();
      nativeSelection?.empty();
      nativeSelection?.removeAllRanges();
    };

    const handleFocus = () => {
      const markNodeKeys = markNodeMap.get(SELECTION_MARK_ID);
      if (markNodeKeys === undefined) {
        return;
      }

      editor.update(() => {
        for (const key of markNodeKeys) {
          const node = $getNodeByKey(key);
          if ($isMarkNode(node)) {
            node.deleteID(SELECTION_MARK_ID);
            if (node.getIDs().length === 0) {
              $unwrapMarkNode(node);
            }
          }
        }
      });
    };

    const unregisterRootListener = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        rootElement?.addEventListener("blur", handleBlur);
        rootElement?.addEventListener("focus", handleFocus);
        rootElement?.addEventListener("click", handleFocus);

        prevRootElement?.removeEventListener("blur", handleBlur);
        prevRootElement?.removeEventListener("focus", handleFocus);
        prevRootElement?.removeEventListener("click", handleFocus);
      }
    );

    return () => {
      unregisterRootListener();
      const rootElement = editor.getRootElement();
      rootElement?.removeEventListener("blur", handleBlur);
      rootElement?.removeEventListener("focus", handleFocus);
      rootElement?.removeEventListener("click", handleFocus);
    };
  }, [editor, markNodeMap]);

  useEffect(() => {
    const changedElems: HTMLElement[] = [];
    for (const id of activeIDs) {
      const keys = markNodeMap.get(id);
      if (keys === undefined) {
        continue;
      }

      for (const key of keys) {
        const elem = editor.getElementByKey(key);
        if (elem !== null) {
          elem.classList.add("selected");
          changedElems.push(elem);
        }
      }
    }
    return () => {
      for (const changedElem of changedElems) {
        changedElem.classList.remove("selected");
      }
    };
  }, [activeIDs, editor, markNodeMap]);

  useEffect(() => {
    const markNodeKeysToIDs = new Map<NodeKey, string[]>();

    return mergeRegister(
      registerNestedElementResolver(
        editor,
        MarkNode,
        (from) => {
          return $createMarkNode(from.getIDs());
        },
        (from, to) => {
          // Merge the IDs
          const ids = from.getIDs();
          ids.forEach((id) => {
            to.addID(id);
          });
        }
      ),
      editor.registerMutationListener(MarkNode, (mutations: MutationRecord) => {
        editor.getEditorState().read(() => {
          for (const [key, mutation] of mutations) {
            const node = $getNodeByKey(key);
            let ids: string[] = [];

            if (mutation === "destroyed") {
              ids = markNodeKeysToIDs.get(key) ?? [];
            } else if ($isMarkNode(node)) {
              ids = node.getIDs();
            }

            for (const id of ids) {
              let markNodeKeys = markNodeMap.get(id);
              markNodeKeysToIDs.set(key, ids);

              if (mutation === "destroyed") {
                if (markNodeKeys !== undefined) {
                  markNodeKeys.delete(key);
                  if (markNodeKeys.size === 0) {
                    markNodeMap.delete(id);
                  }
                }
              } else {
                if (markNodeKeys === undefined) {
                  markNodeKeys = new Set<NodeKey>();
                  markNodeMap.set(id, markNodeKeys);
                }
                if (!markNodeKeys.has(key)) {
                  markNodeKeys.add(key);
                }
              }
            }
          }
        });
      }),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          let hasActiveIds = false;

          if ($isRangeSelection(selection)) {
            const anchorNode = selection.anchor.getNode();

            if ($isTextNode(anchorNode)) {
              const commentIDs = $getMarkIDs(
                anchorNode,
                selection.anchor.offset
              );
              if (commentIDs !== null) {
                setActiveIDs(commentIDs);
                hasActiveIds = true;
              }
            }
          }
          if (!hasActiveIds) {
            setActiveIDs((prevActiveIds) =>
              prevActiveIds.length === 0 ? prevActiveIds : []
            );
          }
        });
      })
    );
  }, [editor, markNodeMap]);

  return null;
}
