import { useCallback, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { DocumentPayload } from "@workspace/persistence/editorContent";
import { applyDocumentToEditor } from "../editor/utils/editorContentToLexical";
import { readDocumentFromEditor } from "../editor/utils/lexicalToEditorContent";
import { useInstanceContext } from "@workspace/contexts/instance/InstanceContext";
import { useSyncSession } from "@workspace/hooks/useSyncSession";
import { EditorCommand } from "@shared/commands";
import { DocumentDiffEngine } from "../../collaragent/runtime/DocumentDiffEngine";
import { computeDiffState } from "../editor/utils/diffRendering";

import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { TABLE } from "../editor/transformers/markdown/TableTransformer";

export default function DocumentWebSocketSyncPlugin() {
    const [editor] = useLexicalComposerContext();
    const { instanceId, wsPort, consumePendingMarkdown } = useInstanceContext();
    const lastSentDocRef = useRef<DocumentPayload | null>(null);
    const lastAppliedDocRef = useRef<string | null>(null);

    const handleSnapshot = useCallback((snapshot: any) => {
        // Check for pending local content (e.g. from drag-and-drop import)
        // If present, we prioritize it over the initial (likely empty) server snapshot
        const pendingMarkdown = consumePendingMarkdown(instanceId);

        if (pendingMarkdown) {
            // Initialize lastSentDocRef to empty so that the coming update from
            // $convertFromMarkdownString is treated as a fresh set of insertions.
            lastSentDocRef.current = { blocks: [] };
            editor.update(() => {
                $convertFromMarkdownString(pendingMarkdown, [TABLE, ...TRANSFORMERS], undefined, true);
            });
            return;
        }

        // Determine the payload based on incoming snapshot structure
        const payload = (snapshot.blocks ? snapshot : snapshot.payload) as DocumentPayload;
        if (!payload) return;

        lastSentDocRef.current = payload;

        const serialized = JSON.stringify(payload);
        if (lastAppliedDocRef.current === serialized) return;
        lastAppliedDocRef.current = serialized;

        // Preserve scroll position across full document replace (e.g. triggered by
        // checkpoint resume → requestSync → sync-snapshot). Lexical's root.clear()
        // + DOM rebuild resets scrollTop to 0 without this guard.
        const scrollContainer = findScrollContainer(editor.getRootElement());
        const savedScrollTop = scrollContainer?.scrollTop ?? 0;

        applyDocumentToEditor(editor, payload, { tag: 'sync' });

        // Restore after Lexical's async reconciliation settles.
        if (scrollContainer && savedScrollTop > 0) {
            requestAnimationFrame(() => {
                scrollContainer.scrollTop = savedScrollTop;
            });
        }
    }, [editor, instanceId, consumePendingMarkdown]);

    const handleRemoteCommand = useCallback((cmd: EditorCommand) => {
        if (cmd.type === 'editor:replace_document') {
            const payload = cmd.payload as DocumentPayload;
            const serialized = JSON.stringify(payload);
            if (lastAppliedDocRef.current === serialized) return;
            lastAppliedDocRef.current = serialized;

            lastSentDocRef.current = payload;
            applyDocumentToEditor(editor, payload, { tag: 'sync' });
        } else {
            // Granular command handling
            editor.update(() => {
                const currentDoc = readDocumentFromEditor(editor);
                const nextDoc = applyCommandToDoc(currentDoc, cmd);

                if (nextDoc) {
                    const serialized = JSON.stringify(nextDoc);
                    if (lastAppliedDocRef.current === serialized) return;
                    lastAppliedDocRef.current = serialized;

                    lastSentDocRef.current = nextDoc;
                    applyDocumentToEditor(editor, nextDoc, { tag: 'sync' });
                }
            }, { tag: 'sync' });
        }
    }, [editor]);

    const subscribeToLocal = useCallback((handler: (cmd: EditorCommand) => void) => {
        return editor.registerUpdateListener(({ editorState, tags }) => {
            if (tags.has('sync') || tags.has('diff') || tags.has('diff-preview')) return;

            editorState.read(() => {
                const doc = readDocumentFromEditor(editor);

                if (lastSentDocRef.current) {
                    const diff = DocumentDiffEngine.computeDocumentDiff(lastSentDocRef.current, doc);
                    diff.forEach(handler);
                }

                lastSentDocRef.current = doc;
            });
        });
    }, [editor]);

    const mapLocalToShared = useCallback((cmd: EditorCommand): EditorCommand => {
        return cmd;
    }, []);

    const [stagedCommands, setStagedCommands] = useState<EditorCommand[]>([]);
    const [isReviewing, setIsReviewing] = useState(false);

    const { client } = useSyncSession<EditorCommand, any, EditorCommand>({
        instanceId,
        path: 'ws/editor',
        host: wsPort ? `localhost:${wsPort}` : undefined,
        clientIdPrefix: 'ui-',
        onSnapshot: handleSnapshot,
        onRemoteCommand: handleRemoteCommand,
        onStagedChanges: (cmds) => {
            setStagedCommands(cmds);
            if (cmds.length === 0) setIsReviewing(false);
        },
        subscribeToLocal,
        mapLocalToShared
    });

    const handleReview = useCallback(() => {
        setIsReviewing(true);
        const currentDoc = lastSentDocRef.current;
        if (!currentDoc) {
            return;
        }

        const diffState = computeDiffState(currentDoc, stagedCommands);
        applyDocumentToEditor(editor, diffState as any, { tag: 'diff', diffMode: true });
    }, [editor, stagedCommands]);

    const handleDiscard = useCallback(() => {
        console.log("[EditorSyncPlugin] Undo clicked");
        client?.rejectChanges();
        setIsReviewing(false);
    }, [client]);

    const handleAccept = useCallback(() => {
        console.log("[EditorSyncPlugin] Keep clicked");
        client?.acceptChanges();
        setIsReviewing(false);
        // Clear diff styling by requesting a fresh sync of the clean document
        client?.requestSync();
    }, [client]);

    if (stagedCommands.length === 0) return null;

    return (
        <div className="proposal-banner" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            pointerEvents: 'auto',
            backgroundColor: 'var(--color-surface-100)',
            borderBottom: '1px solid var(--color-surface-200)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            fontSize: '13px',
            color: 'var(--ev-c-text-1)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontWeight: 600
                }}>Agent Edited</span>
                <span>{stagedCommands.length} {stagedCommands.length === 1 ? 'change' : 'changes'} applied.</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
                {!isReviewing && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            console.log("[EditorSyncPlugin] Review button clicked");
                            handleReview();
                        }}
                        style={{
                            padding: '4px 12px',
                            borderRadius: '4px',
                            border: '1px solid var(--color-primary)',
                            backgroundColor: 'var(--color-surface-50)',
                            cursor: 'pointer',
                            color: 'var(--color-primary)',
                            fontWeight: 500,
                            pointerEvents: 'auto'
                        }}
                    >
                        Review
                    </button>
                )}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleDiscard();
                    }}
                    style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: '1px solid var(--color-surface-300)',
                        backgroundColor: 'var(--color-surface-50)',
                        cursor: 'pointer',
                        color: 'var(--ev-c-text-2)',
                        fontWeight: 500,
                        pointerEvents: 'auto'
                    }}
                >
                    Undo Changes
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleAccept();
                    }}
                    style={{
                        padding: '4px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: '#16a34a', // A slightly more professional green
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        pointerEvents: 'auto'
                    }}
                >
                    Keep
                </button>
            </div>
        </div>
    );
}

/**
 * Reducer for apply granular editor commands to a DocumentPayload.
 */
function applyCommandToDoc(doc: DocumentPayload, cmd: EditorCommand): DocumentPayload | null {
    if (cmd.type === 'editor:insert_block') {
        const blocks = [...doc.blocks];
        blocks.splice(cmd.index, 0, cmd.block);
        return { ...doc, blocks };
    }
    if (cmd.type === 'editor:update_block') {
        const blocks = doc.blocks.map(b => b.id === cmd.blockId ? { ...b, ...cmd.changes } : b);
        return { ...doc, blocks };
    }
    if (cmd.type === 'editor:remove_block') {
        const blocks = doc.blocks.filter(b => b.id !== cmd.blockId);
        return { ...doc, blocks };
    }
    if (cmd.type === 'editor:update_comments') {
        return { ...doc, comments: cmd.comments };
    }
    return null;
}

/**
 * Walks up the DOM from a Lexical root element to find the nearest scrollable
 * ancestor. Lexical itself does not expose the scroll container, so we traverse
 * the parent chain and check for overflow-y scroll/auto.
 */
function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
    let el = node?.parentElement ?? null;
    while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        const overflow = style.overflowY;
        if (overflow === 'auto' || overflow === 'scroll') {
            return el;
        }
        el = el.parentElement;
    }
    return null;
}
