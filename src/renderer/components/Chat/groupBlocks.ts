import { MessageBlock, ToolCall } from '../../types/ui';

export interface BlockGroup {
    inProgressTodos: any[];
    blocks: MessageBlock[];
}

/**
 * Groups message blocks by the `write_todos` tool calls interspersed between them.
 *
 * Each time a `write_todos` call is encountered, it acts as a divider:
 * - The current accumulated blocks are flushed as a group, tagged with the
 *   `in_progress` todos that were active *before* this update.
 * - A new group starts, tagged with the `in_progress` todos from this call.
 *
 * This means the number of groups equals the number of `write_todos` calls,
 * not the number of todo items.
 */
export function groupBlocksByTodos(blocks: MessageBlock[] | undefined, toolCalls: ToolCall[] | undefined): BlockGroup[] {
    const groups: BlockGroup[] = [];
    let currentTodos: any[] = [];
    let currentBlocks: MessageBlock[] = [];

    if (!blocks) return [];

    blocks.forEach((block) => {
        if (block.type === 'tool') {
            const tool = toolCalls?.find(t => t.id === block.toolId);
            if (tool?.name === 'write_todos') {
                // Flush current group before updating todos
                if (currentBlocks.length > 0) {
                    groups.push({
                        inProgressTodos: currentTodos.filter(t => t.status === 'in_progress'),
                        blocks: currentBlocks
                    });
                }
                // Update todos for the next group
                currentTodos = (tool.args as any)?.todos as any[] || [];
                currentBlocks = [block]; // include the write_todos block (hidden by WorkspaceCard)
                return;
            }
        }
        currentBlocks.push(block);
    });

    // Flush the final group
    if (currentBlocks.length > 0 || groups.length === 0) {
        groups.push({
            inProgressTodos: currentTodos.filter(t => t.status === 'in_progress'),
            blocks: currentBlocks
        });
    }

    return groups;
}
