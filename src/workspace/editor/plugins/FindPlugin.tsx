import React, { useCallback, useEffect, useRef, useState, useMemo, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $nodesOfType, TextNode, LexicalEditor } from 'lexical';

/**
 * Match type for keeping track of finding matches.
 */
type FindMatch = {
    nodeKey: string;
    startOffset: number;
    endOffset: number;
};

/**
 * Slice represents a piece of text that belongs to a specific TextNode.
 */
type NodeSlice = {
    nodeKey: string;
    start: number;
    end: number;
};

/**
 * Escapes characters that have specific meaning in RegExp.
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a document-wide string and indexes each TextNode's slice.
 */
function buildDocumentIndex(editor: LexicalEditor): {
    fullText: string;
    slices: NodeSlice[];
} {
    let fullText = '';
    const slices: NodeSlice[] = [];

    editor.getEditorState().read(() => {
        const textNodes = $nodesOfType(TextNode);
        for (const node of textNodes) {
            const text = node.getTextContent();
            const start = fullText.length;
            const end = start + text.length;
            slices.push({
                nodeKey: node.getKey(),
                start,
                end,
            });
            fullText += text;
        }
    });

    return { fullText, slices };
}

/**
 * Given a full string and the slices, finds matching nodes and offsets.
 */
function findMatches(
    fullText: string,
    slices: NodeSlice[],
    query: string
): FindMatch[] {
    if (!query.trim()) return [];

    const foundMatches: FindMatch[] = [];
    const regex = new RegExp(escapeRegExp(query), 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(fullText)) !== null) {
        const globalStart = match.index;
        const globalEnd = match.index + match[0].length;

        // Find all nodes that are involved in this match range
        for (const slice of slices) {
            if (slice.start < globalEnd && globalStart < slice.end) {
                // This node has a piece of the match
                const startOffset = Math.max(0, globalStart - slice.start);
                const endOffset = Math.min(slice.end - slice.start, globalEnd - slice.start);
                foundMatches.push({
                    nodeKey: slice.nodeKey,
                    startOffset,
                    endOffset,
                });
            }
        }
    }

    return foundMatches;
}

/**
 * Scrolls the node into view.
 */
function scrollToMatch(editor: LexicalEditor, match: FindMatch): void {
    const el = editor.getElementByKey(match.nodeKey);
    if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

type SharedFindState = {
    isOpen: boolean;
    query: string;
};

let sharedFindState: SharedFindState = {
    isOpen: false,
    query: '',
};

const sharedFindListeners = new Set<() => void>();

function updateSharedFindState(next: Partial<SharedFindState>): void {
    const nextState = { ...sharedFindState, ...next };
    if (nextState.isOpen === sharedFindState.isOpen && nextState.query === sharedFindState.query) {
        return;
    }
    sharedFindState = nextState;
    sharedFindListeners.forEach((listener) => listener());
}

function subscribeSharedFind(listener: () => void): () => void {
    sharedFindListeners.add(listener);
    return () => {
        sharedFindListeners.delete(listener);
    };
}

function getSharedFindSnapshot(): SharedFindState {
    return sharedFindState;
}

/**
 * Manages the "find" state and highlights.
 */
type FindPluginProps = {
    isActive?: boolean;
};

export default function FindPlugin({ isActive = true }: FindPluginProps): React.JSX.Element | null {
    const [editor] = useLexicalComposerContext();
    const { isOpen, query } = useSyncExternalStore(
        subscribeSharedFind,
        getSharedFindSnapshot,
        getSharedFindSnapshot
    );
    const [matches, setMatches] = useState<FindMatch[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const highlightedKeys = useRef<Set<string>>(new Set());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const applyHighlights = useCallback((foundMatches: FindMatch[], activeIndex: number) => {
        // 1. Clear previous highlights
        highlightedKeys.current.forEach((key) => {
            const el = editor.getElementByKey(key);
            if (el) {
                el.classList.remove('find-highlight', 'find-highlight-active');
            }
        });
        highlightedKeys.current.clear();

        // 2. Map nodes to matches for easier active highlighting
        // Since one match might span multiple nodes, or one node might have multiple matches,
        // we take a simplistic approach: highlight nodes that have matches.
        const nodesWithMatches = new Set<string>();
        foundMatches.forEach((m) => nodesWithMatches.add(m.nodeKey));

        // Determine the node key of the "active" match
        const activeMatchKey = foundMatches[activeIndex]?.nodeKey || null;

        nodesWithMatches.forEach((key) => {
            const el = editor.getElementByKey(key);
            if (el) {
                el.classList.add('find-highlight');
                if (key === activeMatchKey) {
                    el.classList.add('find-highlight-active');
                }
                highlightedKeys.current.add(key);
            }
        });
    }, [editor]);

    const handleClose = useCallback(() => {
        updateSharedFindState({ isOpen: false, query: '' });
        setMatches([]);
        setCurrentIndex(0);
        applyHighlights([], 0);
    }, [applyHighlights]);

    // Handle keyboard shortcut
    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Cmd+F or Ctrl+F
            if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                e.preventDefault();
                updateSharedFindState({ isOpen: true });
            }
            if (e.key === 'Escape') {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleClose, isActive]);

    const runSearch = useCallback((q: string) => {
        if (!q.trim()) {
            setMatches([]);
            setCurrentIndex(0);
            applyHighlights([], 0);
            return;
        }

        const { fullText, slices } = buildDocumentIndex(editor);
        const found = findMatches(fullText, slices, q);
        setMatches(found);
        setCurrentIndex(0);
        applyHighlights(found, 0);

        if (found.length > 0) {
            scrollToMatch(editor, found[0]);
        }
    }, [editor, applyHighlights]);

    const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        updateSharedFindState({ query: val });
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(val), 200);
    }, [runSearch]);


    const goToMatch = useCallback((direction: 1 | -1) => {
        if (matches.length === 0) return;
        setCurrentIndex((prev) => {
            const next = (prev + direction + matches.length) % matches.length;
            applyHighlights(matches, next);
            scrollToMatch(editor, matches[next]);
            return next;
        });
    }, [editor, matches, applyHighlights]);

    // Keep search in sync if document changes
    useEffect(() => {
        return () => {
            clearTimeout(debounceRef.current);
        };
    }, []);

    useEffect(() => {
        if (!isActive || !isOpen || !query.trim()) return;
        return editor.registerUpdateListener(() => {
            clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => runSearch(query), 200);
        });
    }, [editor, isActive, isOpen, query, runSearch]);

    useEffect(() => {
        if (!isActive) {
            applyHighlights([], 0);
            return;
        }

        if (!isOpen) {
            setMatches([]);
            setCurrentIndex(0);
            applyHighlights([], 0);
            return;
        }

        runSearch(query);
        setTimeout(() => inputRef.current?.focus(), 10);
    }, [isActive, isOpen, query, runSearch, applyHighlights]);

    const floatingPanel = useMemo(() => {
        if (!isOpen || !isActive) return null;

        return createPortal(
            <div className="find-panel" role="search" aria-label="Find in document">
                <input
                    ref={inputRef}
                    className="find-input"
                    type="text"
                    value={query}
                    onChange={handleQueryChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            goToMatch(e.shiftKey ? -1 : 1);
                        }
                    }}
                    placeholder="Find…"
                    autoComplete="off"
                />
                <span className="find-counter">
                    {matches.length === 0
                        ? (query.trim() ? '0 results' : '')
                        : `${currentIndex + 1} / ${matches.length}`}
                </span>
                <button
                    type="button"
                    className="find-nav-btn"
                    onClick={() => goToMatch(-1)}
                    disabled={matches.length === 0}
                    aria-label="Previous match"
                >
                    ▲
                </button>
                <button
                    type="button"
                    className="find-nav-btn"
                    onClick={() => goToMatch(1)}
                    disabled={matches.length === 0}
                    aria-label="Next match"
                >
                    ▼
                </button>
                <button
                    type="button"
                    className="find-close-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClose();
                    }}
                    aria-label="Close find"
                >
                    ✕
                </button>
            </div>,
            document.body
        );
    }, [isOpen, isActive, query, matches, currentIndex, goToMatch, handleClose, handleQueryChange]);


    return floatingPanel;
}
