import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DocumentSchema, BlockSchema, type Block, type DocumentPayload } from "@workspace/persistence/editorContent";
import { getDocumentPayload } from "./getDocument";
import { DocumentDiffEngine } from "@collaragent/runtime";
import { connectToEditor, type ConnectionOverrides } from "@workspace/sync/ClientConnection";

const USAGE = `Usage: npx tsx app/wstools/editDocument.ts --mode=<replace|insert|remove> --index <n> [block.json] [--type=<h1|h2|h3|h4|paragraph>] [--text=<content>] [--align=<left|center|right>]

Modes:
  replace   Replace the block at --index (default).
  insert    Insert a new block after the block at --index.
  remove    Remove the block at --index.
`;
// Note: for insert mode, pass --index=-1 to insert before the first block (prepend),
// or --index equal to the current blocks.length to append.

async function loadBlockFromFile(path: string): Promise<Block> {
  const raw = await fs.readFile(path, "utf8");
  const json = JSON.parse(raw);
  return BlockSchema.parse(json);
}

export type EditDocumentOptions = {
  index: number;
  block?: Block;
} & ConnectionOverrides;

/**
 * Replace a single block at `index` in the live instance.
 * Uses granular diff sync over the standardized WebSocket protocol.
 */
export async function editDocumentMessage({ index, block, ...overrides }: EditDocumentOptions) {
  const instanceId = overrides.instanceId || "default";
  const { payload: existing } = await getDocumentPayload(overrides);

  const payload: DocumentPayload = DocumentSchema.parse({ ...existing });

  if (!Number.isInteger(index) || index < 0 || index >= payload.blocks.length) {
    throw new Error(`--index must be an integer between 0 and ${payload.blocks.length - 1}`);
  }

  const newBlocks = payload.blocks.slice();
  newBlocks[index] = BlockSchema.parse(block);

  const newPayload = DocumentSchema.parse({ ...payload, blocks: newBlocks });

  const client = await connectToEditor(instanceId, overrides);
  try {
    const commands = DocumentDiffEngine.computeDocumentDiff(payload, newPayload);
    if (commands.length > 0) {
      await client.sendBatch(commands.map(cmd => ({ ...cmd, staged: false })));
    }
  } finally {
    client.disconnect();
  }

  return { instanceId, clientId: client.getClientId() };
}

function parseNumberArg(argv: string[], name: string) {
  for (const arg of argv) {
    if (arg.startsWith(`--${name}=`)) {
      const val = arg.slice((`--${name}=`).length);
      return Number.parseInt(val, 10);
    }
  }
  return undefined;
}

function parseFlag(argv: string[], name: string) {
  for (const arg of argv) {
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice((`--${name}=`).length);
    }
  }
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }

  const mode = (parseFlag(argv, "mode") || "replace") as "replace" | "insert" | "remove";

  const index = parseNumberArg(argv, "index");
  if (index === undefined || Number.isNaN(index)) {
    throw new Error("--index is required and must be an integer");
  }

  // If a positional non-option argument is provided, treat it as a JSON file
  const firstArg = argv.find((a) => !a.startsWith("-"));

  let block: Block | undefined;

  if (firstArg && firstArg !== undefined) {
    // Try to load from file
    try {
      block = await loadBlockFromFile(firstArg);
    } catch (err) {
      // Fall back to parsing flags below if loading fails
      block = undefined;
    }
  }

  if ((mode === "replace" || mode === "insert") && !block) {
    // Build a minimal block from flags: --type, --text, --align
    const type = parseFlag(argv, "type") ?? "paragraph";
    const text = parseFlag(argv, "text") ?? "";
    const align = parseFlag(argv, "align");

    const candidate: Block = {
      type: type as any,
      align: (align as any) || undefined,
      content: text,
    } as Block;

    block = BlockSchema.parse(candidate);
  }

  if (mode === "remove") {
    const { payload: existing } = await getDocumentPayload();
    const payload = DocumentSchema.parse({ ...existing });

    if (!Number.isInteger(index) || index < 0 || index >= payload.blocks.length) {
      throw new Error(`--index must be an integer between 0 and ${payload.blocks.length - 1}`);
    }

    const newBlocks = payload.blocks.slice();
    newBlocks.splice(index, 1);

    if (newBlocks.length === 0) {
      newBlocks.push({ type: "paragraph", content: "" } as Block);
    }

    const newPayload = DocumentSchema.parse({ ...payload, blocks: newBlocks });

    const client = await connectToEditor("default");
    try {
      const commands = DocumentDiffEngine.computeDocumentDiff(payload, newPayload);
      if (commands.length > 0) {
        await client.sendBatch(commands.map(cmd => ({ ...cmd, staged: false })));
      }
    } finally {
      client.disconnect();
    }
    return;
  }

  if (mode === "insert") {
    if (!block) throw new Error("Insert mode requires a block (file or flags)");
    const { payload: existing } = await getDocumentPayload();
    const payload = DocumentSchema.parse({ ...existing });

    if (!Number.isInteger(index) || index < -1 || index > payload.blocks.length) {
      throw new Error(`--index must be an integer between -1 and ${payload.blocks.length} (inclusive) for insert`);
    }

    const newBlocks = payload.blocks.slice();
    if (index === -1) {
      newBlocks.splice(0, 0, BlockSchema.parse(block));
    } else if (index === payload.blocks.length) {
      newBlocks.push(BlockSchema.parse(block));
    } else {
      newBlocks.splice(index + 1, 0, BlockSchema.parse(block));
    }

    const newPayload = DocumentSchema.parse({ ...payload, blocks: newBlocks });

    const client = await connectToEditor("default");
    try {
      const commands = DocumentDiffEngine.computeDocumentDiff(payload, newPayload);
      if (commands.length > 0) {
        await client.sendBatch(commands.map(cmd => ({ ...cmd, staged: false })));
      }
    } finally {
      client.disconnect();
    }
    return;
  }

  // default: replace
  await editDocumentMessage({ index, block });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Failed to edit document:", err);
    process.exitCode = 1;
  });
}
