import { z } from 'zod';

// --- SHARED DEFINITIONS ---
export const InstanceTypeSchema = z.enum(['document', 'canvas']);

// --- GRAPH CANVAS SCHEMA ---

export const EndpointRefSchema = z.object({
  nodeId: z.string().trim().min(1),
  portId: z.string().trim().min(1).optional(),
});

export const GraphCanvasNodeSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal('card'),
  name: z.string().trim().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

export const GraphCanvasRelationshipSchema = z.object({
  id: z.string().trim().min(1),
  from: EndpointRefSchema,
  to: EndpointRefSchema,
  attrs: z.record(z.string(), z.unknown()).optional(),
});

export const NodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const GraphCanvasDTOSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('graph-canvas'),
  graph: z.object({
    nodes: z.record(z.string(), GraphCanvasNodeSchema), 
    relationships: z.record(z.string(), GraphCanvasRelationshipSchema),
  }),
  layout: z.object({
    layoutByNodeId: z.record(z.string(), NodeLayoutSchema),
  }),
  meta: z
    .object({
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .optional(),
});


// --- DOCUMENT CONTENT SCHEMA ---

const blockTypeValues = ["h1", "h2", "h3", "h4", "paragraph", "list-item", "code", "quote", "table", "page-break"] as const;
const alignValues = ["left", "center", "right", "justify"] as const;
const listTypeValues = ["bullet", "number"] as const;

export const BlockTypeEnum = z.enum(blockTypeValues);
export const AlignEnum = z.enum(alignValues);
export const ListTypeEnum = z.enum(listTypeValues);

export const CommentSchema = z.object({
  id: z.string().describe("The unique ID of the comment."),
  author: z.string().describe("The author of the comment."),
  content: z.string().describe("The content of the comment."),
});

export const InlineRunSchema = z.object({
  text: z.string().describe("The text content of the run."),
  bold: z.boolean().optional().describe("Whether the text is bold."),
  italic: z.boolean().optional().describe("Whether the text is italic."),
  underline: z.boolean().optional().describe("Whether the text is underlined."),
  fontSize: z.string().optional().describe("The font size of the text (e.g., '15px')."),
  fontFamily: z.string().optional().describe("The font family of the text."),
  color: z.string().optional().describe("The text color."),
  backgroundColor: z.string().optional().describe("The background color of the text."),
  commentIds: z.array(z.string()).optional().describe("An array of comment IDs associated with this text run."),
  equation: z.string().optional().describe("The LaTeX equation."),
  inline: z.boolean().optional().describe("Whether the equation is inline."),
});

export const TableCellSchema = z.object({
  children: z.array(InlineRunSchema).optional(),
  colSpan: z.number().optional(),
  rowSpan: z.number().optional(),
  headerState: z.number().optional(),
  width: z.number().optional(),
  backgroundColor: z.string().optional().nullable(),
});

export const TableRowSchema = z.object({
  cells: z.array(TableCellSchema),
  height: z.number().optional(),
});

export const BlockSchema = z.object({
  id: z.string().optional().describe("The unique ID of the block."),
  type: BlockTypeEnum.describe("The type of the block."),
  align: AlignEnum.optional().describe("The alignment of the block."),
  children: z.array(InlineRunSchema).optional().describe("The children of the block."),
  listType: ListTypeEnum.optional().describe("The list type (bullet or number) for list-item blocks."),
  indent: z.number().optional().describe("The indentation level of the block."),
  language: z.string().optional().describe("The programming language for code blocks."),
  content: z.string().optional().describe("The content of the block."),
  tableRows: z.array(TableRowSchema).optional().describe("The rows for table blocks."),
}).refine(
  (b) => b.type === "page-break" || typeof b.content === "string" || (Array.isArray(b.children) && b.children.length >= 0) || (Array.isArray(b.tableRows) && b.tableRows.length >= 0),
  {
    message: "Each block must include either `content`, `children` or `tableRows`.",
    path: ["children"],
  },
);

export const DocumentSchema = z.object({
  blocks: z.array(BlockSchema).min(1, "At least one block is required").describe("The blocks in the document."),
  comments: z.record(z.string(), CommentSchema).optional().describe("The comments in the document."),
});

export const EMPTY_DOCUMENT = DocumentSchema.parse({
  blocks: [{ id: "initial-paragraph", type: "paragraph", content: "" }],
});

export const DocumentInstancePayloadSchema = z.union([
  DocumentSchema,
  GraphCanvasDTOSchema,
]);


// --- UPDATE PAYLOADS ---

export const InstanceUpdateSchema = z.object({
  name: z.string().optional(),
  projectId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Payload is discriminated by instance type usually, but here strict union
  payload: z.union([GraphCanvasDTOSchema, DocumentSchema, z.any()]).optional(),
});


// --- EXPORTED TYPES ---
export type Comment = z.infer<typeof CommentSchema>;
export type InlineRun = z.infer<typeof InlineRunSchema>;
export type ListType = z.infer<typeof ListTypeEnum>;
export type BlockType = z.infer<typeof BlockTypeEnum>;
export type Align = z.infer<typeof AlignEnum>;
export type TableCell = z.infer<typeof TableCellSchema>;
export type TableRow = z.infer<typeof TableRowSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type GraphCanvasDTO = z.infer<typeof GraphCanvasDTOSchema>;
export type DocumentPayload = z.infer<typeof DocumentSchema>;
export type InstanceUpdate = z.infer<typeof InstanceUpdateSchema>;
