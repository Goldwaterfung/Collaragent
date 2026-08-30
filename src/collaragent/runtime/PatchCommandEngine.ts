import { EditorCommand } from "@shared/commands";
import { convertBlocksToPatchView, convertHtmlToBlocks } from "@workspace/editor/schemas/htmlContentConversion";
import type { Block } from "@workspace/persistence/editorContent";

export interface PatchOperation {
  action: 'update' | 'insert' | 'delete';
  blockId: string;
  anchor?: 'before' | 'after';
  newHtml?: string;
}

export interface PatchCommandResult {
  commands: EditorCommand[];
  updatedContent: string;
  updatedLines: string[];
  stats: {
    hunksApplied: number;
    blocksUpdated: number;
    blocksInserted: number;
    blocksRemoved: number;
  };
}

export interface PatchCommandFailure {
  applied: false;
  code:
    | "INVALID_PATCH"
    | "PATCH_CONTEXT_MISMATCH";
  message: string;
  hunkIndex?: number;
  header?: string;
}

export type PatchCommandEngineResult =
  | ({ applied: true } & PatchCommandResult)
  | PatchCommandFailure;

/** Extract data-block-id attribute value from a patch-view HTML line. */
function extractBlockId(line: string): string | undefined {
  const match = line.match(/data-block-id="([^"]+)"/);
  return match?.[1];
}

/** Normalize line endings and split into an array. */
function normalizeLines(content: string): string[] {
  if (!content) return [];
  return content.replace(/\r\n/g, "\n").split("\n");
}

function serializeBlock(block: Block): string {
  return convertBlocksToPatchView([block]);
}

/** Parse HTML fragments into one or more Blocks. */
function htmlToBlocks(html: string): Block[] {
  return convertHtmlToBlocks(html);
}

function createBlockId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function createUniqueBlockId(existingIds: Set<string>): string {
  let nextId = createBlockId();

  while (existingIds.has(nextId)) {
    nextId = createBlockId();
  }

  return nextId;
}

function findBlockIndex(lines: string[], blockId: string): number {
  return lines.findIndex((line) => extractBlockId(line) === blockId);
}

export class PatchCommandEngine {
  /**
   * Applies structured JSON patch operations against the current patch_view.
   * Trust the block IDs provided and perform block-level edits without strict text matching.
   */
  static compile(
    currentContent: string,
    operations: PatchOperation[]
  ): PatchCommandEngineResult {
    try {
      const workingLines = normalizeLines(currentContent).filter((line) => line.trim() !== "");
      const commands: EditorCommand[] = [];
      let blocksUpdated = 0;
      let blocksInserted = 0;
      let blocksRemoved = 0;

      const existingIds = new Set(workingLines.map((line) => extractBlockId(line)).filter(Boolean) as string[]);

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        
        if (op.action === "update") {
          const index = findBlockIndex(workingLines, op.blockId);
          if (index === -1) {
            return {
              applied: false,
              code: "PATCH_CONTEXT_MISMATCH",
              message: `Could not find block ${op.blockId} for update (Operation index ${i}).`,
              hunkIndex: i,
            };
          }

          if (!op.newHtml) {
            throw new Error(`Operation ${i}: newHtml is required for update action.`);
          }

          const newBlocks = htmlToBlocks(op.newHtml);
          if (newBlocks.length === 0) {
            throw new Error(`Operation ${i}: update newHtml contained no valid blocks.`);
          }

          // Case: updating one block with one or more new blocks
          // 1. First new block replaces the targeted block.
          const firstBlock = newBlocks[0];
          firstBlock.id = op.blockId;
          const { id: _id, ...changes } = firstBlock;
          commands.push({ type: "editor:update_block", blockId: op.blockId, changes });
          workingLines[index] = serializeBlock(firstBlock);
          blocksUpdated++;

          // 2. Subsequent blocks are inserted after the targeted block.
          for (let b = 1; b < newBlocks.length; b++) {
            const nextBlock = newBlocks[b];
            nextBlock.id = createUniqueBlockId(existingIds);
            existingIds.add(nextBlock.id);
            const insertIndex = index + b;
            commands.push({ type: "editor:insert_block", index: insertIndex, block: nextBlock });
            workingLines.splice(insertIndex, 0, serializeBlock(nextBlock));
            blocksInserted++;
          }
          continue;
        }

        if (op.action === "delete") {
          const index = findBlockIndex(workingLines, op.blockId);
          if (index === -1) {
            return {
              applied: false,
              code: "PATCH_CONTEXT_MISMATCH",
              message: `Could not find block ${op.blockId} for delete (Operation index ${i}).`,
              hunkIndex: i,
            };
          }

          commands.push({ type: "editor:remove_block", blockId: op.blockId });
          workingLines.splice(index, 1);
          existingIds.delete(op.blockId);
          blocksRemoved++;
          continue;
        }

        if (op.action === "insert") {
          if (!op.anchor || !op.blockId) {
            throw new Error(`Operation ${i}: insert requires both blockId (anchorId) and anchor ('before'|'after').`);
          }
          if (!op.newHtml) {
            throw new Error(`Operation ${i}: newHtml is required for insert action.`);
          }

          const referenceIndex = findBlockIndex(workingLines, op.blockId);
          if (referenceIndex === -1) {
            return {
              applied: false,
              code: "PATCH_CONTEXT_MISMATCH",
              message: `Could not find reference block ${op.blockId} for insert (Operation index ${i}).`,
              hunkIndex: i,
            };
          }

          const newBlocks = htmlToBlocks(op.newHtml);
          if (newBlocks.length === 0) {
            throw new Error(`Operation ${i}: insert newHtml contained no valid blocks.`);
          }

          let insertIndex = op.anchor === "before" ? referenceIndex : referenceIndex + 1;
          for (const block of newBlocks) {
            block.id = createUniqueBlockId(existingIds);
            existingIds.add(block.id);
            commands.push({ type: "editor:insert_block", index: insertIndex, block });
            workingLines.splice(insertIndex, 0, serializeBlock(block));
            insertIndex++;
            blocksInserted++;
          }
          continue;
        }
      }

      return {
        applied: true,
        commands,
        updatedContent: workingLines.join("\n"),
        updatedLines: workingLines,
        stats: {
          hunksApplied: operations.length,
          blocksUpdated,
          blocksInserted,
          blocksRemoved,
        },
      };
    } catch (error) {
      return {
        applied: false,
        code: "INVALID_PATCH",
        message: error instanceof Error ? error.message : "Failed to compile patch.",
      };
    }
  }
}

