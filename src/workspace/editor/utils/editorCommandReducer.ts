import type { EditorCommand } from "@shared/commands";
import type { Block, DocumentPayload } from "@workspace/persistence/editorContent";

function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((block) => ({
    ...block,
    children: block.children ? block.children.map((run) => ({ ...run })) : undefined,
  }));
}

function normalizePayload(payload: DocumentPayload): DocumentPayload {
  return {
    blocks: cloneBlocks(payload.blocks ?? []),
    comments: payload.comments ? { ...payload.comments } : undefined,
  };
}

export function applyEditorCommand(payload: DocumentPayload, command: EditorCommand): DocumentPayload {
  const next = normalizePayload(payload);

  switch (command.type) {
    case "editor:replace_document":
      return normalizePayload(command.payload as DocumentPayload);

    case "editor:update_block": {
      const idx = next.blocks.findIndex((block) => block.id === command.blockId);
      if (idx === -1) return next;
      next.blocks[idx] = { ...next.blocks[idx], ...(command.changes as Partial<Block>) };
      return next;
    }

    case "editor:insert_block": {
      const insertIndex = Math.max(0, Math.min(command.index, next.blocks.length));
      next.blocks.splice(insertIndex, 0, command.block as Block);
      return next;
    }

    case "editor:remove_block": {
      next.blocks = next.blocks.filter((block) => block.id !== command.blockId);
      if (next.blocks.length === 0) {
        next.blocks = [{ id: "initial-paragraph", type: "paragraph", content: "" } as Block];
      }
      return next;
    }

    case "editor:update_comments": {
      next.comments = { ...command.comments };
      return next;
    }

    default:
      return next;
  }
}

export function applyEditorCommands(
  payload: DocumentPayload,
  commands: EditorCommand[],
): DocumentPayload {
  return commands.reduce((doc, command) => applyEditorCommand(doc, command), payload);
}
