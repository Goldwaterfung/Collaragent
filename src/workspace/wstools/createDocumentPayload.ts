import process from "node:process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  AlignEnum,
  BlockTypeEnum,
  DocumentSchema,
  InlineRunSchema,
  type Align,
  type Block,
  type BlockType,
  type DocumentPayload,
  type InlineRun,
} from "@workspace/persistence/editorContent";

export type CreateDocumentPayloadOptions = {
  heading?: string;
  paragraphs?: string[];
  blocks?: Block[];
};

/**
 * Creates a document payload from a heading and a list of paragraphs.
 * @param options The options to use to create the document payload.
 * @returns The document payload.
 */
export function createDocumentPayload(options: CreateDocumentPayloadOptions = {}): DocumentPayload {
  const { heading, paragraphs = [], blocks = [] } = options;

  const derivedBlocks: Block[] = blocks.slice();

  if (derivedBlocks.length === 0) {
    if (heading && heading.trim().length > 0) {
      derivedBlocks.push({
        type: "h1",
        align: "center",
        children: [
          {
            text: heading.trim(),
            bold: true,
          },
        ],
      });
    }

    for (const paragraph of paragraphs) {
      const text = paragraph.trim();
      if (!text) continue;
      derivedBlocks.push({
        type: "paragraph",
        children: [
          {
            text,
          },
        ],
      });
    }
  }

  if (derivedBlocks.length === 0) {
    derivedBlocks.push({
      type: "paragraph",
      content: "Empty document",
    });
  }

  return DocumentSchema.parse({ blocks: derivedBlocks });
}

type BlockDraft = {
  type: BlockType;
  align?: Align;
  runs?: InlineRun[];
  content?: string;
};

export type CreateDocumentCliArgs = {
  blocks: BlockDraft[];
  outputPath?: string;
  help?: boolean;
};

export const CREATE_DOCUMENT_CLI_HELP = `Usage: npx tsx app/wstools/createDocumentPayload.ts [options]\n\nOptions:\n  --block "type=<h1|h2|h3|h4|paragraph>;align=<left|center|right>;text=<content>"\n                        Add a block (repeatable). Alignment/text are optional.\n  --run "text=<content>;bold;italic;underline"\n                        Attach an inline run to the most recent block.\n  --output <path>        Write JSON payload to file instead of stdout\n  -h, --help             Show this help message\n\nExamples:\n  npx tsx app/wstools/createDocumentPayload.ts \\\n    --block "type=h1;align=center" \\\n    --run "text=Doc Title;bold" \\\n    --block "type=paragraph;align=left" \\\n    --run "text=First paragraph."\n\n  npx tsx app/wstools/createDocumentPayload.ts \\\n    --block "type=paragraph" \\\n    --run "text=Normal " \\\n    --run "text=Bold;bold" \\\n    --run "text= Italic;italic"\n`;

function parseBoolean(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (value === "" || value.toLowerCase() === "true" || value === "1") return true;
  if (value.toLowerCase() === "false" || value === "0") return false;
  return true;
}

function parseKeyValueList(input: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const parts = input.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const [key, rawValue] = part.split("=", 2).map((segment) => segment.trim());
    if (!key) continue;
    if (rawValue === undefined || rawValue === "") {
      result[key] = true;
    } else {
      result[key] = rawValue;
    }
  }
  return result;
}

function coerceBlockType(value: string | boolean | undefined): BlockType {
  if (typeof value !== "string") {
    throw new Error("Block requires a valid type (h1, h2, h3, h4, paragraph)");
  }
  const trimmed = value.trim();
  if (!BlockTypeEnum.options.includes(trimmed as BlockType)) {
    throw new Error(`Unsupported block type: ${trimmed}`);
  }
  return trimmed as BlockType;
}

function coerceAlign(value: string | boolean | undefined): Align | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!AlignEnum.options.includes(trimmed as Align)) {
    throw new Error(`Unsupported alignment: ${trimmed}`);
  }
  return trimmed as Align;
}

function parseRun(input: string): InlineRun {
  const kv = parseKeyValueList(input);
  const text = typeof kv.text === "string" ? kv.text : undefined;
  if (!text) {
    throw new Error("Run requires a text value, e.g. --run 'text=Hello;bold'");
  }
  const runCandidate = {
    text,
    bold: parseBoolean(kv.bold),
    italic: parseBoolean(kv.italic),
    underline: parseBoolean(kv.underline),
  } satisfies InlineRun;
  return InlineRunSchema.parse(runCandidate);
}

function parseBlock(input: string): BlockDraft {
  const kv = parseKeyValueList(input);
  const type = coerceBlockType(kv.type);
  const align = coerceAlign(kv.align);
  const content = typeof kv.text === "string" ? kv.text : undefined;

  const block: BlockDraft = {
    type,
    align,
    content,
  };

  return block;
}

export function parseCreateDocumentCliArgs(argv: string[]): CreateDocumentCliArgs {
  const result: CreateDocumentCliArgs = {
    blocks: [],
  };

  let currentBlock: BlockDraft | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (arg.startsWith("--output=")) {
      result.outputPath = arg.slice("--output=".length);
      continue;
    }
    if (arg === "--output" && i + 1 < argv.length) {
      result.outputPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--block=")) {
      currentBlock = parseBlock(arg.slice("--block=".length));
      result.blocks.push(currentBlock);
      continue;
    }
    if (arg === "--block" && i + 1 < argv.length) {
      currentBlock = parseBlock(argv[i + 1]);
      result.blocks.push(currentBlock);
      i += 1;
      continue;
    }

    if (arg.startsWith("--run=")) {
      if (!currentBlock) {
        throw new Error("--run must follow a --block declaration");
      }
      const run = parseRun(arg.slice("--run=".length));
      currentBlock.runs = currentBlock.runs ? [...currentBlock.runs, run] : [run];
      continue;
    }
    if (arg === "--run" && i + 1 < argv.length) {
      if (!currentBlock) {
        throw new Error("--run must follow a --block declaration");
      }
      const run = parseRun(argv[i + 1]);
      currentBlock.runs = currentBlock.runs ? [...currentBlock.runs, run] : [run];
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function draftsToBlocks(blocks: BlockDraft[]): Block[] {
  return blocks.map((block) => {
    if (block.runs && block.runs.length > 0) {
      const children = block.runs.map((r) => InlineRunSchema.parse(r));
      return {
        type: block.type,
        align: block.align,
        children,
      } satisfies Block;
    }
    return {
      type: block.type,
      align: block.align,
      content: block.content ?? "",
    } satisfies Block;
  });
}

export function createDocumentPayloadFromCliArgs(argv: string[]) {
  const parsed = parseCreateDocumentCliArgs(argv);
  if (parsed.help) {
    return {
      helpRequested: true,
      outputPath: parsed.outputPath,
    } as const;
  }

  const blocks = draftsToBlocks(parsed.blocks);
  const payload = createDocumentPayload({ blocks });

  return {
    helpRequested: false,
    outputPath: parsed.outputPath,
    payload,
  } as const;
}

async function runCli() {
  const argv = process.argv.slice(2);
  const { payload, outputPath, helpRequested } = createDocumentPayloadFromCliArgs(argv);

  if (helpRequested) {
    process.stdout.write(CREATE_DOCUMENT_CLI_HELP);
    return;
  }

  if (!payload) {
    throw new Error("Failed to build document payload from CLI arguments");
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  if (outputPath) {
    await fs.writeFile(outputPath, serialized, "utf8");
    process.stdout.write(`Payload written to ${outputPath}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((err) => {
    console.error("Failed to create document payload:", err);
    process.exitCode = 1;
  });
}
