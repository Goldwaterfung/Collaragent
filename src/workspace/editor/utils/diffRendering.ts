import { Block, DocumentPayload } from "@workspace/persistence/editorContent";
import { EditorCommand } from "@shared/commands";
import { LexicalEditor } from "lexical";
import { applyDocumentToEditor } from "./editorContentToLexical";

export interface DiffBlock extends Block {
    diffStatus: 'added' | 'removed' | 'updated' | 'none';
    oldBlock?: Block;
}

/**
 * Computes a "Combined State" that includes both current content (Version B) 
 * and staged changes with metadata. Since changes are applied immediately 
 * to Document B, we reconstruct Document A (the baseline) and then mark the diff.
 */
export function computeDiffState(
    current: DocumentPayload, // VERSION B (after changes)
    stagedCommands: EditorCommand[]
): { blocks: DiffBlock[]; comments: Record<string, any> } {
    // 1. Reconstruct Version A (Baseline)
    // We clone the current state and undo the staged commands in reverse order.
    let baselineBlocks: any[] = JSON.parse(JSON.stringify(current.blocks));
    
    for (const cmd of [...stagedCommands].reverse()) {
        const prev = (cmd as any).previousState;
        if (!prev) continue;

        switch (cmd.type) {
            case 'editor:insert_block':
                // Undo an insertion by removing it
                baselineBlocks.splice(cmd.index, 1);
                break;
            case 'editor:update_block':
                // Undo an update by restoring the previous block state
                const idx = baselineBlocks.findIndex(b => b.id === cmd.blockId);
                if (idx !== -1 && prev.block) {
                    baselineBlocks[idx] = prev.block;
                }
                break;
            case 'editor:remove_block':
                // Undo a removal by re-inserting the block
                if (prev.block && prev.index !== undefined) {
                    baselineBlocks.splice(prev.index, 0, prev.block);
                }
                break;
            case 'editor:replace_document':
                if (prev.documentPayload?.blocks) {
                    baselineBlocks = prev.documentPayload.blocks;
                }
                break;
        }
    }

    // 2. Now we have baseline blocks (Version A). 
    // We apply the diff annotations to them just like the old logic.
    let resultBlocks: DiffBlock[] = baselineBlocks.map(b => ({ ...b, diffStatus: 'none' }));
    
    const removedIds = new Set<string>();
    const updatedMap = new Map<string, any>();

    for (const cmd of stagedCommands) {
        if (cmd.type === 'editor:remove_block' && cmd.blockId) {
            removedIds.add(cmd.blockId);
        } else if (cmd.type === 'editor:update_block' && cmd.blockId) {
            updatedMap.set(cmd.blockId, cmd.changes);
        }
    }

    // Mark removals and updates
    resultBlocks = resultBlocks.map(block => {
        const blockId = block.id;
        if (blockId && removedIds.has(blockId)) {
            return { ...block, diffStatus: 'removed' };
        }
        if (blockId && updatedMap.has(blockId)) {
            return { 
                ...block, 
                ...updatedMap.get(blockId), 
                diffStatus: 'updated',
                oldBlock: { ...block }
            };
        }
        return block;
    });

    // Handle insertions
    const insertions = stagedCommands
        .filter((c): c is Extract<EditorCommand, { type: 'editor:insert_block' }> => c.type === 'editor:insert_block')
        .sort((a, b) => a.index - b.index);

    for (const ins of insertions) {
        resultBlocks.splice(ins.index, 0, {
            ...ins.block,
            diffStatus: 'added'
        });
    }

    return {
        blocks: resultBlocks,
        comments: current.comments || {}
    };
}

/**
 * Applies a Diff State to the editor.
 * Uses custom attributes or styles to highlight additions and removals.
 */
export function applyDiffToEditor(
    editor: LexicalEditor,
    diffState: { blocks: DiffBlock[]; comments: Record<string, any> }
) {
    // For Phase 1, we use a simple approach:
    // We hijack the applyDocumentToEditor and add styling hooks.
    // In a mature implementation, we'd use a custom Lexical node or Decorator.
    
    // We'll use CSS classes in the theme for .diff-added and .diff-removed.
    // We need to pass these statuses down to the node creation.
    
    // Let's modify editorContentToLexical to support an optional 'blockTransform'
    // but for now, we'll just implement a simplified version here.

    editor.update(() => {
        // This is a placeholder for the specialized diff rendering logic
        // which will need to integrate with the Theme.
        // For now, we'll just apply the document normally.
        applyDocumentToEditor(editor, diffState as any, { tag: 'diff-preview' });
    });
}
