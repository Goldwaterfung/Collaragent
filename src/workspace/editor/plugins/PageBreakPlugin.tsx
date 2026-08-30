import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_EDITOR,
    $createParagraphNode,
} from "lexical";
import { $createPageBreakNode, PageBreakNode } from "../nodes/PageBreakNode";
import { INSERT_PAGE_BREAK_COMMAND } from "../utils/commands";

export default function PageBreakPlugin(): null {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        // Ensure the node is registered
        if (!editor.hasNodes([PageBreakNode])) {
            throw new Error("PageBreakPlugin: PageBreakNode is not registered on the editor.");
        }

        // Register the insert command
        const unregisterCommand = editor.registerCommand(
            INSERT_PAGE_BREAK_COMMAND,
            () => {
                editor.update(() => {
                    const selection = $getSelection();
                    if (!$isRangeSelection(selection)) return;

                    // Use getTopLevelElementOrThrow() + insertAfter instead of
                    // $insertNodes, which internally *splits* the anchor block even
                    // when the cursor is at its end. That split creates a phantom
                    // empty paragraph between the page break and whatever block
                    // follows, making it look like the next block's type changed.
                    const anchorNode = selection.anchor.getNode();
                    const topLevelBlock = anchorNode.getTopLevelElementOrThrow();

                    const pageBreak = $createPageBreakNode();
                    topLevelBlock.insertAfter(pageBreak);

                    // Position cursor: if there is already a block after the break,
                    // move into it (its type is preserved). Otherwise append a fresh
                    // paragraph so the user can keep typing on the "new page".
                    const after = pageBreak.getNextSibling();
                    if (!after) {
                        const paragraph = $createParagraphNode();
                        pageBreak.insertAfter(paragraph);
                        paragraph.select();
                    } else {
                        // Move cursor to the start of the existing next block
                        pageBreak.selectNext();
                    }
                });
                return true;
            },
            COMMAND_PRIORITY_EDITOR,
        );

        // Register Ctrl+Enter / Cmd+Enter keyboard shortcut
        const unregisterKeyDown = editor.registerRootListener(
            (rootElement: HTMLElement | null, prevRootElement: HTMLElement | null) => {
                const handler = (e: KeyboardEvent) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        editor.dispatchCommand(INSERT_PAGE_BREAK_COMMAND, undefined);
                    }
                };

                if (prevRootElement) {
                    prevRootElement.removeEventListener("keydown", handler);
                }
                if (rootElement) {
                    rootElement.addEventListener("keydown", handler);
                }
            },
        );

        return () => {
            unregisterCommand();
            unregisterKeyDown();
        };
    }, [editor]);

    return null;
}
