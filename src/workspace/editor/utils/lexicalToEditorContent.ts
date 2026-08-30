import { 
  $getRoot, 
  $isTextNode, 
  $isLineBreakNode,
  $isElementNode,
  type LexicalNode,
  type LexicalEditor
} from "lexical";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $isMarkNode } from "@lexical/mark";
import { $isListNode, $isListItemNode } from "@lexical/list";
import { $isCodeNode } from "@lexical/code";
import { 
  $isTableNode, 
  $isTableRowNode, 
  $isTableCellNode
} from "@lexical/table";
import { $isPageBreakNode } from "../nodes/PageBreakNode";
import { $isEquationNode } from "../nodes/EquationNode";
import { getOrCreateStoredBlockId } from "./blockIdentityRegistry";
import type { 
  Align, 
  Block, 
  Comment, 
  DocumentPayload, 
  InlineRun,
  ListType,
  TableRow,
  TableCell
} from "@workspace/persistence/editorContent.ts";

const COMMENT_PREFIX = "comment:";

interface DecodedComment {
  id: string;
  author: string;
  content: string;
}

interface CommentRegistry {
  get(id: string): Comment | undefined;
  set(id: string, comment: Comment): void;
  toRecord(): Record<string, Comment>;
}

class MapCommentRegistry implements CommentRegistry {
  private map = new Map<string, Comment>();
  
  get(id: string): Comment | undefined {
    return this.map.get(id);
  }
  
  set(id: string, comment: Comment): void {
    this.map.set(id, comment);
  }
  
  toRecord(): Record<string, Comment> {
    const record: Record<string, Comment> = {};
    for (const [id, comment] of this.map.entries()) {
      record[id] = comment;
    }
    return record;
  }
}

const dedupeArray = <T>(arr: T[]): T[] => Array.from(new Set(arr));
const FORMAT_DELIMITER = "\u001f";

function decodeCommentStorageId(storageId: string): DecodedComment | null {
  if (!storageId.startsWith(COMMENT_PREFIX)) {
    return null;
  }
  
  const remainder = storageId.slice(COMMENT_PREFIX.length);
  const firstColonIndex = remainder.indexOf(":");
  
  if (firstColonIndex === -1) {
    return null;
  }
  
  const id = remainder.slice(0, firstColonIndex);
  const rest = remainder.slice(firstColonIndex + 1);
  const secondColonIndex = rest.indexOf(":");

  // Backward compatibility: If no second colon, legacy format is id:content
  if (secondColonIndex === -1) {
    let content = rest;
    try {
      content = decodeURIComponent(rest);
    } catch {
      // keep raw
    }
    return { id, author: "", content };
  }

  // 3-part format: id:author:content
  const encodedAuthor = rest.slice(0, secondColonIndex);
  const encodedContent = rest.slice(secondColonIndex + 1);

  let author = "";
  let content = "";
  try {
    author = decodeURIComponent(encodedAuthor);
  } catch {
    author = encodedAuthor;
  }
  try {
    content = decodeURIComponent(encodedContent);
  } catch {
    content = encodedContent;
  }

  return { id, author, content };
}

function elementAlignToSchema(
  formatType: string | null | undefined
): Align | undefined {
  if (!formatType) return undefined;
  if (["left", "center", "right"].includes(formatType)) {
    return formatType as Align;
  }
  return undefined;
}

function parseStyle(styleString: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleString) return styles;
  
  styleString.split(";").forEach((style) => {
    const [key, value] = style.split(":");
    if (key && value) {
      styles[key.trim()] = value.trim();
    }
  });
  return styles;
}

function getBlockType(node: LexicalNode): Block["type"] {
  if ($isHeadingNode(node)) {
    const tag = node.getTag();
    if (["h1", "h2", "h3", "h4"].includes(tag)) {
      return tag as Block["type"];
    }
  }
  if ($isListItemNode(node)) {
    return "list-item";
  }
  if ($isCodeNode(node)) {
    return "code";
  }
  if ($isQuoteNode(node)) {
    return "quote";
  }
  if ($isTableNode(node)) {
    return "table";
  }
  return "paragraph";
}

function getElementFormat(node: LexicalNode): string | null | undefined {
  if ($isElementNode(node)) {
    return node.getFormatType?.() ?? null;
  }
  return undefined;
}

export function readDocumentFromEditor(editor: LexicalEditor): DocumentPayload {
  const root = $getRoot();
  const blocks: Block[] = [];
  const commentRegistry: CommentRegistry = new MapCommentRegistry();

  for (const child of root.getChildren()) {
    processRootNode(editor, child, commentRegistry, blocks);
  }

  const payload: DocumentPayload = { blocks };
  
  const commentsRecord = commentRegistry.toRecord();
  if (Object.keys(commentsRecord).length > 0) {
    payload.comments = commentsRecord;
  }

  return payload;
}

function processRootNode(
  editor: LexicalEditor,
  node: LexicalNode,
  registry: CommentRegistry,
  blocks: Block[],
  indent: number = 0
): void {
  // Handle PageBreakNode explicitly
  // Use getOrCreateStoredBlockId (not getStoredBlockId) so a freshly inserted
  // PageBreakNode gets a stable client-side ID immediately. Without this, id is
  // undefined, the server's normalizeDocumentPayload assigns a new UUID, and the
  // diff engine treats the two as separate blocks — inserting a phantom duplicate.
  if ($isPageBreakNode(node)) {
    blocks.push({ type: "page-break", id: getOrCreateStoredBlockId(editor, node.getKey()) });
    return;
  }

  // Handle ListNode - extract list items recursively
  if ($isListNode(node)) {
    const listType: ListType = node.getListType() === "bullet" ? "bullet" : "number";
    for (const child of node.getChildren()) {
      if ($isListItemNode(child)) {
        const block = processBlockNode(editor, child, registry);
        block.listType = listType;
        // child.getIndent() accurately reflects the indent, whether the DOM 
        // is structured as nested ListNodes or as sibling ListNodes.
        block.indent = child.getIndent();
        blocks.push(block);

        // Check for nested lists within the list item
        for (const subChild of child.getChildren()) {
          if ($isListNode(subChild)) {
            // No need to artificially pass indent + 1, getIndent() is the true source of truth
            processRootNode(editor, subChild, registry, blocks, 0); 
          }
        }
      }
    }
  } else {
    const block = processBlockNode(editor, node, registry);
    if (indent > 0) {
      block.indent = indent;
    }
    blocks.push(block);
  }
}

function processBlockNode(
  editor: LexicalEditor,
  node: LexicalNode,
  registry: CommentRegistry
): Block {
  const type = getBlockType(node);
  const align = elementAlignToSchema(getElementFormat(node));

  if ($isTableNode(node)) {
    const tableRows: TableRow[] = [];
    
    for (const rowNode of node.getChildren()) {
      if ($isTableRowNode(rowNode)) {
        const cells: TableCell[] = [];
        
        for (const cellNode of rowNode.getChildren()) {
          if ($isTableCellNode(cellNode)) {
            const collector = new RunCollector();
            let childIndex = 0;
            for (const cellChild of cellNode.getChildren()) {
               if (childIndex > 0) {
                 collector.addLineBreak();
               }
               visitNode(editor, cellChild, [], registry, collector);
               childIndex++;
            }

            cells.push({
              children: collector.getRuns(),
              colSpan: cellNode.getColSpan() > 1 ? cellNode.getColSpan() : undefined,
              rowSpan: cellNode.getRowSpan() > 1 ? cellNode.getRowSpan() : undefined,
              headerState: cellNode.getHeaderStyles(),
              width: cellNode.getWidth(),
              backgroundColor: cellNode.getBackgroundColor(),
            });
          }
        }
        
        tableRows.push({ 
          cells,
          height: rowNode.getHeight(),
        });
      }
    }

    return {
      type: "table",
      align,
      tableRows,
      // Same fix as PageBreakNode: use getOrCreateStoredBlockId to avoid
      // id:undefined → server-assigned UUID → phantom duplicate table on next diff.
      id: getOrCreateStoredBlockId(editor, node.getKey())
    };
  }

  // Standard processing for non-table blocks
  const collector = new RunCollector();

  // Collect runs, handle nesting
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      visitNode(editor, child, [], registry, collector);
    }
  }

  const block: Block = { 
    type, 
    align, 
    children: collector.getRuns()
  };
  
  // Add language for code blocks
  if ($isCodeNode(node)) {
    const language = node.getLanguage();
    if (language) {
      block.language = language;
    }
  }

  // Use persistent ID only. Do not fall back to transient Lexical keys, 
  // as this causes duplication in the diff engine when matching against 
  // ID-less blocks from the server.
  block.id = getOrCreateStoredBlockId(editor, node.getKey());

  return block;
}

class RunCollector {
  private runs: InlineRun[] = [];
  private pendingText: string[] = [];
  private pendingFormat: FormatKey = "";
  private pendingStyles: {
    fontSize?: string;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
  } = {};
  private pendingCommentIds: string[] = [];

  addEquation(equation: string, inline: boolean, commentIds: string[]): void {
    this.commit();
    const run: InlineRun = { text: "" };
    run.equation = equation;
    run.inline = inline;
    const uniqueComments = dedupeArray(commentIds);
    if (uniqueComments.length > 0) {
      run.commentIds = uniqueComments;
    }
    this.runs.push(run);
  }

  addText(
    text: string, 
    bold?: boolean, 
    italic?: boolean, 
    underline?: boolean,
    styles: {
      fontSize?: string;
      fontFamily?: string;
      color?: string;
      backgroundColor?: string;
    } = {},
    commentIds: string[] = []
  ): void {
    const formatKey = this.createFormatKey(bold, italic, underline, styles, commentIds);
    
    // If format changes, commit previous text
    if (formatKey !== this.pendingFormat && this.pendingText.length > 0) {
      this.commit();
    }
    
    this.pendingText.push(text);
    this.pendingFormat = formatKey;
    this.pendingStyles = styles;
    this.pendingCommentIds = commentIds;
  }

  addLineBreak(): void {
    this.pendingText.push("\n");
  }

  private createFormatKey(
    bold?: boolean,
    italic?: boolean,
    underline?: boolean,
    styles: {
      fontSize?: string;
      fontFamily?: string;
      color?: string;
      backgroundColor?: string;
    } = {},
    commentIds: string[] = []
  ): FormatKey {
    return [
      bold ? "B" : "",
      italic ? "I" : "",
      underline ? "U" : "",
      styles.fontSize ?? "",
      styles.fontFamily ?? "",
      styles.color ?? "",
      styles.backgroundColor ?? "",
      ...dedupeArray(commentIds).sort()
    ].join(FORMAT_DELIMITER);
  }

  private commit(): void {
    if (this.pendingText.length === 0) return;
    
    const text = this.pendingText.join("");
    const [bold, italic, underline] = this.parseFormatKey(this.pendingFormat);
    
    const run: InlineRun = { text };
    if (bold) run.bold = true;
    if (italic) run.italic = true;
    if (underline) run.underline = true;
    
    if (this.pendingStyles.fontSize) run.fontSize = this.pendingStyles.fontSize;
    if (this.pendingStyles.fontFamily) run.fontFamily = this.pendingStyles.fontFamily;
    if (this.pendingStyles.color) run.color = this.pendingStyles.color;
    if (this.pendingStyles.backgroundColor) run.backgroundColor = this.pendingStyles.backgroundColor;
    
    const uniqueComments = dedupeArray(this.pendingCommentIds);
    if (uniqueComments.length > 0) {
      run.commentIds = uniqueComments;
    }
    
    this.runs.push(run);
    this.pendingText = [];
  }

  private parseFormatKey(key: FormatKey): [boolean, boolean, boolean] {
    const parts = key.split(FORMAT_DELIMITER);
    return [parts[0] === "B", parts[1] === "I", parts[2] === "U"];
  }

  getRuns(): InlineRun[] {
    this.commit();
    return this.runs;
  }
}

type FormatKey = string;

function visitNode(
  editor: LexicalEditor,
  node: LexicalNode,
  activeCommentIds: readonly string[],
  registry: CommentRegistry,
  collector: RunCollector
): void {
  // Handle MarkNode (Comments)
  if ($isMarkNode(node)) {
    const newCommentIds = registerComments(node.getIDs(), registry);
    const combined = dedupeArray([...activeCommentIds, ...newCommentIds]);
    
    for (const child of node.getChildren()) {
      visitNode(editor, child, combined, registry, collector);
    }
    return;
  }

  // Handle LineBreak
  if ($isLineBreakNode(node)) {
    collector.addLineBreak();
    return;
  }

  // Handle Equation
  if ($isEquationNode(node)) {
    const equation = node.getEquation();
    const inline = node.getInline();
    collector.addEquation(equation, inline, [...activeCommentIds]);
    return;
  }

  // Handle Text
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    const bold = node.hasFormat("bold") || undefined;
    const italic = node.hasFormat("italic") || undefined;
    const underline = node.hasFormat("underline") || undefined;
    
    const styleString = node.getStyle();
    const stylesMap = parseStyle(styleString);
    const styles = {
      fontSize: stylesMap["font-size"],
      fontFamily: stylesMap["font-family"],
      color: stylesMap["color"],
      backgroundColor: stylesMap["background-color"],
    };
    
    collector.addText(text, bold, italic, underline, styles, [...activeCommentIds]);
    return;
  }

  // Handle other Element Nodes
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      // Skip ListNodes here as they are handled as separate blocks in processRootNode
      if ($isListNode(child)) {
        continue;
      }
      visitNode(editor, child, activeCommentIds, registry, collector);
    }
  }
}

function registerComments(
  storageIds: readonly string[],
  registry: CommentRegistry
): string[] {
  if (storageIds.length === 0) return [];
  
  const commentIds: string[] = [];
  
  for (const storageId of storageIds) {
    const decoded = decodeCommentStorageId(storageId);
    if (!decoded) continue;
    
    commentIds.push(decoded.id);
    
    const existing = registry.get(decoded.id);
    const mergedComment: Comment = {
      id: decoded.id,
      author: existing?.author || decoded.author || "",
      content: decoded.content || existing?.content || "",
    };
    
    registry.set(decoded.id, mergedComment);
  }
  
  return dedupeArray(commentIds);
}