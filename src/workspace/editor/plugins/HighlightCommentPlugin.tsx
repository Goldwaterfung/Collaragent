import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import type { LexicalEditor, LexicalNode, NodeKey } from "lexical";
import {
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode
} from "@lexical/mark";
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { INSERT_COMMENT_COMMAND } from "../utils/commands";

type CommentEntry = {
  id: string;
  storageId: string;
  text: string;
  excerpt: string;
  keys: NodeKey[];
};

type SelectionRect = {
  top: number;
  left: number;
  width: number;
  bottom: number;
};

const COMMENT_PREFIX = "comment:";
const FLOATING_OFFSET = 8;

type EditPopoverState = {
  commentId: string;
  rect: SelectionRect;
};

type PendingComment = {
  id: string;
  storageId: string;
};

const encodeCommentId = (id: string, text: string): string => {
  return `${COMMENT_PREFIX}${id}:${encodeURIComponent(text)}`;
};

const decodeCommentId = (
  rawId: string
): { id: string; text: string; storageId: string } | null => {
  if (!rawId.startsWith(COMMENT_PREFIX)) {
    return null;
  }
  const remainder = rawId.slice(COMMENT_PREFIX.length);
  const firstColonIndex = remainder.indexOf(":");
  if (firstColonIndex === -1) {
    return null;
  }
  const id = remainder.slice(0, firstColonIndex);
  const encodedText = remainder.slice(firstColonIndex + 1);
  try {
    return {
      id,
      text: decodeURIComponent(encodedText),
      storageId: rawId
    };
  } catch {
    return {
      id,
      text: encodedText,
      storageId: rawId
    };
  }
};

const generateCommentId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const collectCommentEntries = (root: LexicalNode): CommentEntry[] => {
  const order: string[] = [];
  const entries = new Map<string, CommentEntry>();

  const visit = (node: LexicalNode) => {
    if ($isMarkNode(node)) {
      const markText = node.getTextContent();
      const ids = node.getIDs();
      for (const rawId of ids) {
        const payload = decodeCommentId(rawId);
        if (payload === null) {
          continue;
        }
        let entry = entries.get(payload.id);
        if (entry === undefined) {
          entry = {
            id: payload.id,
            storageId: payload.storageId,
            text: payload.text,
            excerpt: markText,
            keys: [node.getKey()]
          };
          entries.set(payload.id, entry);
          order.push(payload.id);
        } else {
          entry.storageId = payload.storageId;
          entry.excerpt = `${entry.excerpt} ${markText}`.trim();
          entry.keys.push(node.getKey());
        }
      }
    }

    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (const child of children) {
        visit(child);
      }
    }
  };

  visit(root);

  return order.map((id) => entries.get(id)!);
};

function removeCommentById(editor: LexicalEditor, storageId: string) {
  editor.update(() => {
    const root = $getRoot();
    const removeMark = (node: LexicalNode) => {
      if ($isMarkNode(node) && node.hasID(storageId)) {
        const writable = node.deleteID(storageId);
        if ($isMarkNode(writable) && writable.getIDs().length === 0) {
          $unwrapMarkNode(writable);
        }
      }
      if ($isElementNode(node)) {
        const children = node.getChildren();
        for (const child of children) {
          removeMark(child);
        }
      }
    };
    removeMark(root);
  });
}

function getSelectionRect(): SelectionRect | null {
  if (typeof window === "undefined") {
    return null;
  }
  const domSelection = window.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0) {
    return null;
  }
  if (domSelection.isCollapsed) {
    return null;
  }
  const range = domSelection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    bottom: rect.bottom + window.scrollY
  };
}

function getElementRect(elem: HTMLElement): SelectionRect {
  const rect = elem.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    bottom: rect.bottom + window.scrollY
  };
}

function HighlightCommentPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [comments, setComments] = useState<CommentEntry[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pendingCommentState, setPendingCommentState] = useState<PendingComment | null>(null);
  const pendingCommentRef = useRef<PendingComment | null>(null);
  const setPendingComment = useCallback((next: PendingComment | null) => {
    pendingCommentRef.current = next;
    setPendingCommentState(next);
  }, []);
  const pendingComment = pendingCommentState;
  const previousNodesRef = useRef<Map<NodeKey, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editPopover, setEditPopover] = useState<EditPopoverState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const syncComments = useCallback(() => {
    const editorState = editor.getEditorState();
    editorState.read(() => {
      const root = $getRoot();
      const collected = collectCommentEntries(root);
      setComments(collected);

      const selection = $getSelection();
      const hasPending = pendingCommentRef.current !== null;
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        if (!hasPending) {
          setSelectionRect(null);
          setIsAdding(false);
          setDraftComment("");
        }
      }
    });
  }, [editor]);

  useEffect(() => {
    syncComments();
    return editor.registerUpdateListener(() => {
      syncComments();
    });
  }, [editor, syncComments]);

  useEffect(() => {
    const unregister = mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            const rect = getSelectionRect();
            setSelectionRect(rect);
          } else {
            if (pendingCommentRef.current === null) {
              setSelectionRect(null);
              setIsAdding(false);
              setDraftComment("");
            }
          }
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );

    if (typeof window !== "undefined") {
      const handleReposition = () => {
        const editorState = editor.getEditorState();
        editorState.read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            setSelectionRect(getSelectionRect());
          } else {
            if (pendingCommentRef.current === null) {
              setSelectionRect(null);
            }
          }
        });
      };
      window.addEventListener("scroll", handleReposition, true);
      window.addEventListener("resize", handleReposition);
      return () => {
        unregister();
        window.removeEventListener("scroll", handleReposition, true);
        window.removeEventListener("resize", handleReposition);
      };
    }

    return unregister;
  }, [editor]);

  useEffect(() => {
    const previousNodes = previousNodesRef.current;
    previousNodes.forEach((_, key) => {
      const elem = editor.getElementByKey(key);
      if (elem !== null) {
        elem.removeAttribute("data-comment-id");
        elem.removeAttribute("title");
        elem.classList.remove("comment-highlight");
        elem.classList.remove("comment-highlight-active");
      }
    });

    const nextNodes = new Map<NodeKey, string>();
    for (const entry of comments) {
      for (const key of entry.keys) {
        const elem = editor.getElementByKey(key);
        if (elem !== null) {
          elem.setAttribute("data-comment-id", entry.id);
          elem.setAttribute("title", entry.text);
          elem.classList.add("comment-highlight");
          if (entry.id === activeCommentId) {
            elem.classList.add("comment-highlight-active");
          }
          nextNodes.set(key, entry.id);
        }
      }
    }

    previousNodesRef.current = nextNodes;
  }, [editor, comments, activeCommentId]);

  useEffect(() => {
    if (isAdding && textareaRef.current !== null) {
      textareaRef.current.focus({ preventScroll: true });
    }
  }, [isAdding]);

  useEffect(() => {
    if (isEditing && editTextareaRef.current !== null) {
      editTextareaRef.current.focus({ preventScroll: true });
      editTextareaRef.current.select();
    }
  }, [isEditing]);

  const resetEditState = useCallback(() => {
    setEditPopover(null);
    setIsEditing(false);
    setEditDraft("");
  }, []);

  const handleStartAdd = useCallback(() => {
    if (pendingComment !== null) {
      return;
    }

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        const commentId = generateCommentId();
        const storageId = encodeCommentId(commentId, "");

        setPendingComment({ id: commentId, storageId });
        setActiveCommentId(commentId);
        setDraftComment("");
        setIsAdding(true);
        resetEditState();

        if (selectionRect === null) {
          const rect = getSelectionRect();
          setSelectionRect(rect);
        }

        editor.update(() => {
          const currentSelection = $getSelection();
          if ($isRangeSelection(currentSelection)) {
            $wrapSelectionInMarkNode(
              currentSelection,
              currentSelection.isBackward(),
              storageId
            );
          }
        });
      }
    });
  }, [editor, pendingComment, selectionRect, resetEditState]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_COMMENT_COMMAND,
      () => {
        handleStartAdd();
        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, handleStartAdd]);

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (rootElement === null) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        resetEditState();
        return;
      }
      const commentElement = target.closest<HTMLElement>("[data-comment-id]");
      if (commentElement === null) {
        resetEditState();
        return;
      }

      const commentId = commentElement.getAttribute("data-comment-id");
      if (commentId === null) {
        resetEditState();
        return;
      }

      const rect = getElementRect(commentElement);
      setActiveCommentId(commentId);
      setEditPopover({ commentId, rect });
      setIsEditing(false);
      setEditDraft("");
    };

    rootElement.addEventListener("click", handleClick);
    return () => {
      rootElement.removeEventListener("click", handleClick);
    };
  }, [editor, resetEditState]);

  useEffect(() => {
    if (editPopover === null) {
      return;
    }

    const updateRect = () => {
      setEditPopover((current) => {
        if (current === null) {
          return current;
        }
        const entry = comments.find((item) => item.id === current.commentId);
        if (entry === undefined) {
          return null;
        }
        const firstKey = entry.keys[0];
        const elem = editor.getElementByKey(firstKey);
        if (elem === null) {
          return null;
        }
        const nextRect = getElementRect(elem);
        const { rect } = current;
        if (
          rect.top === nextRect.top &&
          rect.left === nextRect.left &&
          rect.width === nextRect.width &&
          rect.bottom === nextRect.bottom
        ) {
          return current;
        }
        return { commentId: current.commentId, rect: nextRect };
      });
    };

    updateRect();

    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [editPopover, comments, editor]);

  useEffect(() => {
    if (editPopover === null) {
      return;
    }
    const exists = comments.some((entry) => entry.id === editPopover.commentId);
    if (!exists) {
      resetEditState();
    }
  }, [comments, editPopover, resetEditState]);

  const handleSubmit = useCallback(() => {
    if (pendingComment === null) {
      return;
    }

    const trimmed = draftComment.trim();
    if (trimmed.length === 0) {
      return;
    }

    const { id, storageId } = pendingComment;
    const nextStorageId = encodeCommentId(id, trimmed);

    editor.update(() => {
      const root = $getRoot();

      const updateMark = (node: LexicalNode) => {
        if ($isMarkNode(node) && node.hasID(storageId)) {
          node.deleteID(storageId);
          node.addID(nextStorageId);
        }
        if ($isElementNode(node)) {
          const children = node.getChildren();
          for (const child of children) {
            updateMark(child);
          }
        }
      };

      updateMark(root);
    });

    setPendingComment(null);
    setActiveCommentId(id);
    editor.focus();
    setDraftComment("");
    setIsAdding(false);
    setSelectionRect(null);
  }, [draftComment, editor, pendingComment]);

  const handleEditStart = useCallback(
    (entry: CommentEntry) => {
      setActiveCommentId(entry.id);
      setIsEditing(true);
      setEditDraft(entry.text);
    },
    []
  );

  const handleEditSubmit = useCallback(() => {
    if (editPopover === null) {
      return;
    }
    const entry = comments.find((item) => item.id === editPopover.commentId);
    if (entry === undefined) {
      resetEditState();
      return;
    }

    const trimmed = editDraft.trim();
    if (trimmed.length === 0) {
      return;
    }

    if (trimmed === entry.text.trim()) {
      setIsEditing(false);
      setEditDraft("");
      return;
    }

    const nextStorageId = encodeCommentId(entry.id, trimmed);
    const previousStorageId = entry.storageId;

    editor.update(() => {
      const root = $getRoot();

      const updateMark = (node: LexicalNode) => {
        if ($isMarkNode(node) && node.hasID(previousStorageId)) {
          node.deleteID(previousStorageId);
          node.addID(nextStorageId);
        }
        if ($isElementNode(node)) {
          const children = node.getChildren();
          for (const child of children) {
            updateMark(child);
          }
        }
      };

      updateMark(root);
    });

    editor.focus();
    setActiveCommentId(entry.id);
    setIsEditing(false);
    setEditDraft("");
  }, [comments, editDraft, editPopover, editor, resetEditState]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditDraft("");
  }, []);

  const handleCancel = useCallback(() => {
    if (pendingComment !== null) {
      removeCommentById(editor, pendingComment.storageId);
    }
    setPendingComment(null);
    setIsAdding(false);
    setDraftComment("");
    setSelectionRect(null);
    resetEditState();
  }, [editor, pendingComment, resetEditState]);

  const handleDelete = useCallback(
    (entry: CommentEntry) => {
      removeCommentById(editor, entry.storageId);
      if (activeCommentId === entry.id) {
        setActiveCommentId(null);
      }
      if (editPopover !== null && editPopover.commentId === entry.id) {
        resetEditState();
      }
      if (pendingComment !== null && pendingComment.id === entry.id) {
        setPendingComment(null);
        setIsAdding(false);
        setDraftComment("");
        setSelectionRect(null);
      }
    },
    [editor, activeCommentId, pendingComment, editPopover, resetEditState]
  );


  const floatingMenu = useMemo(() => {
    if (selectionRect === null || typeof document === "undefined" || !isAdding) {
      return null;
    }

    const style = {
      top: selectionRect.bottom + FLOATING_OFFSET,
      left: selectionRect.left + selectionRect.width / 2
    } as const;

    return createPortal(
      <div
        className="comment-floating-menu comment-floating-menu--expanded"
        style={style}
      >
        <div className="comment-floating-form">
          <textarea
            ref={textareaRef}
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
            placeholder="Add comment"
            rows={3}
          />
          <div className="comment-floating-actions">
            <button
              type="button"
              className="comment-floating-save"
              onClick={handleSubmit}
              disabled={draftComment.trim().length === 0}
            >
              Save
            </button>
            <button
              type="button"
              className="comment-floating-cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }, [selectionRect, isAdding, draftComment, handleSubmit, handleCancel]);

  const editPopoverElement = useMemo(() => {
    if (editPopover === null || typeof document === "undefined") {
      return null;
    }

    const entry = comments.find((item) => item.id === editPopover.commentId);
    if (entry === undefined) {
      return null;
    }

    const style = {
      top: editPopover.rect.bottom + FLOATING_OFFSET,
      left: editPopover.rect.left + editPopover.rect.width / 2
    } as const;

    return createPortal(
      <div
        className={`comment-floating-menu comment-edit-popover${isEditing ? " comment-floating-menu--expanded" : ""}`}
        style={style}
      >
        {isEditing ? (
          <div className="comment-floating-form">
            <textarea
              ref={editTextareaRef}
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              rows={3}
            />
            <div className="comment-floating-actions">
              <button
                type="button"
                className="comment-floating-save"
                onClick={handleEditSubmit}
                disabled={editDraft.trim().length === 0}
              >
                Save
              </button>
              <button
                type="button"
                className="comment-floating-cancel"
                onClick={handleEditCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="comment-popover-content">
            <div className="comment-popover-text">{entry.text}</div>
            <div className="comment-popover-actions">
              <button
                type="button"
                className="comment-popover-action"
                onClick={() => handleEditStart(entry)}
                aria-label="Edit comment"
              >
                Edit
              </button>
              <button
                type="button"
                className="comment-popover-action comment-popover-action--danger"
                onClick={() => handleDelete(entry)}
                aria-label="Delete comment"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>,
      document.body
    );
  }, [editPopover, comments, isEditing, editDraft, handleEditSubmit, handleEditCancel, handleEditStart]);

  return (
    <>
      {floatingMenu}
      {editPopoverElement}
    </>
  );
}

export default HighlightCommentPlugin;
