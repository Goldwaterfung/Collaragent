import { EditorCommand } from "@shared/commands";
import { DocumentPayload } from "@workspace/persistence/editorContent";

export class DocumentDiffEngine {
    
    /**
     * Computes the list of commands needed to transition from `current` to `target` document state.
     * Supports additions, removals, updates, and reordering.
     */
    static computeDocumentDiff(
        current: DocumentPayload,
        target: DocumentPayload
    ): EditorCommand[] {
        const commands: EditorCommand[] = [];
        const currentBlocks = [...(current.blocks || [])]; // We'll simulate changes on this list
        const targetBlocks = target.blocks || [];

        // 1. Initial Content Sync: Ensure all blocks have IDs.
        // If a block in target has no ID, it's treated as a positional block (risky but handled).

        // 2. Removal Step (Pruning): Remove blocks from current that are not in target.
        // We use a set for O(1) lookups.
        const targetIds = new Set(targetBlocks.map(b => b.id).filter(Boolean));
        for (let i = currentBlocks.length - 1; i >= 0; i--) {
            const block = currentBlocks[i];
            if (block.id && !targetIds.has(block.id)) {
                commands.push({ type: 'editor:remove_block', blockId: block.id });
                currentBlocks.splice(i, 1);
            }
        }

        // 3. Move & Insert Step: Walk target and align current.
        // We use a simulation of the current state to track where things are as we emit commands.
        for (let i = 0; i < targetBlocks.length; i++) {
            const targetBlock = targetBlocks[i];
            const currentBlock = currentBlocks[i];

            // If IDs match, it's the correct block at the correct position.
            if (currentBlock && targetBlock.id === currentBlock.id && targetBlock.id !== undefined) {
                // Check for content updates
                if (JSON.stringify(currentBlock) !== JSON.stringify(targetBlock)) {
                    const { id, ...changes } = targetBlock;
                    commands.push({ type: 'editor:update_block', blockId: targetBlock.id!, changes });
                }
                continue;
            }

            // Mismatch: Either targetBlock is new, or it's at the wrong position.
            const existingIdx = targetBlock.id ? currentBlocks.findIndex((b, idx) => idx > i && b.id === targetBlock.id) : -1;

            if (existingIdx !== -1) {
                // MOVE: Block exists later in the sequence. 
                // We emit a remove and an insert to reposition it.
                const blockToMove = currentBlocks[existingIdx];
                commands.push({ type: 'editor:remove_block', blockId: blockToMove.id! });
                commands.push({ type: 'editor:insert_block', index: i, block: targetBlock });

                // Synchronize our simulation
                currentBlocks.splice(existingIdx, 1);
                currentBlocks.splice(i, 0, targetBlock);
            } else {
                // INSERT: New block OR we can't find it by ID (possibly ID-less).
                commands.push({ type: 'editor:insert_block', index: i, block: targetBlock });
                currentBlocks.splice(i, 0, targetBlock);
            }

            // Note: After insertion/move, we have targetBlock at currentBlocks[i].
            // We already used targetBlock (which has the latest content) in the insertion command,
            // so no separate update_block is needed for this specific block in this turn.
        }

        // 4. Comments handling
        if (JSON.stringify(current.comments) !== JSON.stringify(target.comments)) {
            commands.push({
                type: 'editor:update_comments',
                comments: target.comments || {}
            });
        }

        return commands;
    }
}
