import type { DocumentPayload, Block, InlineRun, Comment } from "@workspace/persistence/editorContent.ts";
import { 
  $createParagraphNode, 
  $createTextNode, 
  $getRoot, 
  $createLineBreakNode,
  type LexicalEditor,
  type LexicalNode,
  type ElementNode
} from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createMarkNode, type MarkNode } from "@lexical/mark";
import { $createListNode, $createListItemNode, type ListItemNode } from "@lexical/list";
import { $createCodeNode } from "@lexical/code";
import { $createTableNode, $createTableRowNode, $createTableCellNode } from "@lexical/table";
import { $createPageBreakNode } from "../nodes/PageBreakNode";
import { $createEquationNode } from "../nodes/EquationNode";
import { storeBlockId } from "./blockIdentityRegistry";


const COMMENT_PREFIX = "comment:";

const encodeCommentStorageId = (id: string, author: string, content: string): string =>
  `${COMMENT_PREFIX}${id}:${encodeURIComponent(author)}:${encodeURIComponent(content)}`;

const dedupeArray = <T>(arr: T[]): T[] => Array.from(new Set(arr));

export function applyDocumentToEditor(
  editor: LexicalEditor, 
  doc: DocumentPayload,
  options?: { tag?: string; diffMode?: boolean }
): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();

    const comments = doc.comments ?? {};
    const blocks = doc.blocks;

    const itemsToIndent: { node: LexicalNode; indent: number }[] = [];

    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i];
      const indent = block.indent ?? 0;

      // Handle List Items
      if (block.type === "list-item") {
        const listType = block.listType || "bullet";
        const listNode = $createListNode(listType);
        
        // Collect consecutive list items of the same type
        while (i < blocks.length) {
          const nextBlock = blocks[i];
          if (nextBlock.type !== "list-item") {
            break;
          }
          const nextListType = nextBlock.listType || listType;
          if (nextListType !== listType) {
            break;
          }
          
          const listItem = createListItemFromBlock(nextBlock, comments);
          storeBlockId(editor, listItem.getKey(), nextBlock.id);
          
          if (options?.diffMode) {
            const status = (nextBlock as any).diffStatus;
            if (status === 'added') listItem.setStyle('background-color: #f0fdf4; border-left: 4px solid #22c55e;');
            if (status === 'removed') listItem.setStyle('background-color: #fef2f2; border-left: 4px solid #ef4444; text-decoration: line-through; opacity: 0.7;');
            if (status === 'updated') listItem.setStyle('background-color: #eff6ff; border-left: 4px solid #3b82f6;');
          }

          const nextIndent = nextBlock.indent ?? 0;
          if (nextIndent > 0) {
            itemsToIndent.push({ node: listItem, indent: nextIndent });
          }
          listNode.append(listItem);
          i++;
        }
        root.append(listNode);
        // NOTE: do NOT fall through to table handling here — list items are fully consumed above.
      } else if (block.type === "table") {
        const tableNode = createTableNodeFromBlock(block, comments);
        storeBlockId(editor, tableNode.getKey(), block.id);
        
        if (options?.diffMode) {
          const status = (block as any).diffStatus;
          if (status === 'added') tableNode.setStyle('background-color: #f0fdf4; border-left: 4px solid #22c55e;');
          if (status === 'removed') tableNode.setStyle('background-color: #fef2f2; border-left: 4px solid #ef4444; text-decoration: line-through; opacity: 0.7;');
          if (status === 'updated') tableNode.setStyle('background-color: #eff6ff; border-left: 4px solid #3b82f6;');
        }

        root.append(tableNode);
        i++;
      } else if (block.type === "page-break") {
        const pageBreakNode = $createPageBreakNode();
        storeBlockId(editor, pageBreakNode.getKey(), block.id);
        root.append(pageBreakNode);
        i++;
      } else {
        // Handle other block types
        const element = createBlockNode(block, comments);
        if (element) {
          storeBlockId(editor, element.getKey(), block.id);
          
          if (options?.diffMode) {
            const status = (block as any).diffStatus;
            if (status === 'added') element.setStyle('background-color: #f0fdf4; border-left: 4px solid #22c55e;');
            if (status === 'removed') element.setStyle('background-color: #fef2f2; border-left: 4px solid #ef4444; text-decoration: line-through; opacity: 0.7;');
            if (status === 'updated') element.setStyle('background-color: #eff6ff; border-left: 4px solid #3b82f6;');
          }

          root.append(element);
          if (indent > 0) {
            itemsToIndent.push({ node: element, indent });
          }
        }
        i++;
      }
    }

    // Apply indentation after structural insertion
    // Lexical structural mutations (like nested Lists) rely on the nodes being attached first.
    for (const { node, indent } of itemsToIndent) {
      if (typeof (node as any).setIndent === 'function') {
        (node as any).setIndent(indent);
      }
    }
  }, options);
}

function createTableNodeFromBlock(block: Block, comments: Record<string, Comment>): ElementNode {
  const tableNode = $createTableNode();
  const rows = block.tableRows || [];

  for (const row of rows) {
    const rowNode = $createTableRowNode(row.height);
    
    for (const cell of row.cells) {
      // TableCellHeaderStates uses number: NO_STATUS=0, ROW=1, COLUMN=2, BOTH=3
      // We assume schema stores raw number or we default to NO_STATUS (0)
      const headerState = cell.headerState ?? 0; 
      const cellNode = $createTableCellNode(headerState, cell.colSpan, cell.width);
      
      if (cell.rowSpan) {
        cellNode.setRowSpan(cell.rowSpan);
      }
      if (cell.backgroundColor) {
        cellNode.setBackgroundColor(cell.backgroundColor);
      }

      // We wrap inline runs in a paragraph inside the cell
      const paragraph = $createParagraphNode();
      
      const runs: InlineRun[] = cell.children ?? [];
      for (const run of runs) {
        const nodes = createNodesFromRun(run);
        
        if (nodes.length === 0) continue;

        const commentIds = dedupeArray(run.commentIds ?? []);
        if (commentIds.length > 0) {
          const mark = createMarkWithComments(commentIds, comments, nodes);
          paragraph.append(mark);
        } else {
          paragraph.append(...nodes);
        }
      }
      
      cellNode.append(paragraph);
      rowNode.append(cellNode);
    }
    
    tableNode.append(rowNode);
  }

  return tableNode;
}

function createBlockNode(block: Block, comments: Record<string, Comment>): ElementNode {
  const { type, align, children, content, language } = block;
  
  let element: ElementNode;
  
  if (type === "paragraph") {
    element = $createParagraphNode();
  } else if (type === "code") {
    element = $createCodeNode(language);
  } else if (type === "quote") {
    element = $createQuoteNode();
  } else if (["h1", "h2", "h3", "h4"].includes(type)) {
    element = $createHeadingNode(type as "h1" | "h2" | "h3" | "h4");
  } else {
    element = $createParagraphNode();
  }

  // Set alignment
  if (align && ["left", "center", "right"].includes(align)) {
    element.setFormat(align);
  }

  // Populate children
  const runs: InlineRun[] = children ?? (
    typeof content === "string" ? [{ text: content }] : []
  );

  for (const run of runs) {
    const nodes = createNodesFromRun(run);
    
    if (nodes.length === 0) continue;

    // Handle comments
    const commentIds = dedupeArray(run.commentIds ?? []);
    
    if (commentIds.length > 0) {
      const mark = createMarkWithComments(commentIds, comments, nodes);
      element.append(mark);
    } else {
      element.append(...nodes);
    }
  }

  return element;
}

function createListItemFromBlock(
  block: Block,
  comments: Record<string, Comment>
): ListItemNode {
  const { children, content } = block;
  const listItemNode = $createListItemNode();
  
  const runs: InlineRun[] = children ?? (
    typeof content === "string" ? [{ text: content }] : []
  );

  for (const run of runs) {
    const nodes = createNodesFromRun(run);
    
    if (nodes.length === 0) continue;

    const commentIds = dedupeArray(run.commentIds ?? []);
    
    if (commentIds.length > 0) {
      const mark = createMarkWithComments(commentIds, comments, nodes);
      listItemNode.append(mark);
    } else {
      listItemNode.append(...nodes);
    }
  }
  
  return listItemNode;
}

function createNodesFromRun(
  run: InlineRun
): LexicalNode[] {
  const nodes: LexicalNode[] = [];

  if (run.equation !== undefined) {
    nodes.push($createEquationNode(run.equation, run.inline ?? true));
    return nodes;
  }

  const parts = run.text.split("\n");

  parts.forEach((part, index) => {
    // Add line break if not the first part
    if (index > 0) {
      nodes.push($createLineBreakNode());
    }
    
    // Create text node and apply format
    if (part || parts.length === 1) { // Keep empty string if it's the only part
      const textNode = $createTextNode(part);
      
      if (run.bold) textNode.toggleFormat("bold");
      if (run.italic) textNode.toggleFormat("italic");
      if (run.underline) textNode.toggleFormat("underline");
      
      // Apply Typography and Colors
      let styleString = "";
      if (run.fontSize) styleString += `font-size: ${run.fontSize};`;
      if (run.fontFamily) styleString += `font-family: ${run.fontFamily};`;
      if (run.color) styleString += `color: ${run.color};`;
      if (run.backgroundColor) styleString += `background-color: ${run.backgroundColor};`;
      
      if (styleString) {
        textNode.setStyle(styleString);
      }
      
      nodes.push(textNode);
    }
  });

  return nodes;
}

function createMarkWithComments(
  commentIds: string[],
  comments: Record<string, Comment>,
  nodes: LexicalNode[]
): MarkNode {
  const mark = $createMarkNode();
  
  const storageIds = commentIds.map((id) => {
    const comment = comments[id];
    const author = comment?.author ?? "";
    const content = comment?.content ?? "";
    return encodeCommentStorageId(id, author, content);
  }).filter(Boolean);

  if (storageIds.length > 0) {
    mark.setIDs(storageIds);
  }
  
  mark.append(...nodes);
  return mark;
}