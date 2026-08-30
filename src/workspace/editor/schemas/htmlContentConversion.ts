import { Block, BlockType, InlineRun } from "@workspace/persistence/editorContent";

// --- HTML -> BlockSchema Conversion ---

/**
 * Parses a simple HTML style string (e.g., "color: red; text-align: center")
 * into an object provided as key-value pairs.
 */
function parseStyleString(style: string): Record<string, string> {
  const styles: Record<string, string> = {};
  style.split(";").forEach((part) => {
    const [key, value] = part.split(":").map((s) => s.trim());
    if (key && value) {
      styles[key.toLowerCase()] = value;
    }
  });
  return styles;
}

/**
 * A minimal regex-based HTML parser for the document HTML and patch-view formats
 * used by workspace tools.
 *
 * Supported block tags:
 * - <h1>-<h4>, <p>, <ul>, <ol>, <li>, <code>, <pre>, <blockquote>
 *
 * Supported inline tags:
 * - <b>, <strong>, <i>, <em>, <u>, <span>, <br>
 *
 * Supported attributes:
 * - id, data-block-id, data-list-type, data-language, style
 */

type TagToken = {
  type: "tag";
  tagName: string;
  isClosing: boolean;
  attributes: Record<string, string>;
  fullMatch: string;
};

type TextToken = {
  type: "text";
  content: string;
};

type Token = TagToken | TextToken;

function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = [];
  // Regex to match tags: <(/)?(\w+)([^>]*)>
  const tagRegex = /<(\/?)([a-z0-9]+)((?:\s+[a-z0-9\-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*\/?>/gi;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [fullMatch, slash, tagName, attrsString] = match;
    const index = match.index;

    // Push preceding text if any
    if (index > lastIndex) {
      const text = html.slice(lastIndex, index);
      // We decode entities roughly or leave them? 
      // For now, let's just unescape basic ones if needed, or leave raw if the system handles it.
      // Usually better to decode basic entities like &lt; &gt; &amp;
      tokens.push({ type: "text", content: decodeHtmlEntities(text) });
    }

    const isClosing = slash === "/";
    const attributes = parseAttributes(attrsString);

    tokens.push({
      type: "tag",
      tagName: tagName.toLowerCase(),
      isClosing,
      attributes,
      fullMatch,
    });

    lastIndex = tagRegex.lastIndex;
  }

  // Push remaining text
  if (lastIndex < html.length) {
    tokens.push({ type: "text", content: decodeHtmlEntities(html.slice(lastIndex)) });
  }

  return tokens;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Regex for attributes: key="value" | key='value' | key=value | key
  const attrRegex = /([a-z0-9\-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function mapTagToBlockType(tagName: string): BlockType {
  switch (tagName) {
    case "h1": return "h1";
    case "h2": return "h2";
    case "h3": return "h3";
    case "h4": return "h4";
    case "li": return "list-item";
    case "code": 
    case "pre": return "code";
    case "blockquote": return "quote";
    case "p": 
    case "div":
    default: return "paragraph";
  }
}

function getBlockIdFromAttributes(attributes: Record<string, string>): string | undefined {
  return attributes["data-block-id"] || attributes.id;
}

function getInlineRunsHtml(children: InlineRun[]): string {
  return children.map((run) => {
    if (run.equation) {
      const wrap = run.inline === false ? "$$" : "$";
      return `${wrap}${escapeHtml(run.equation)}${wrap}`;
    }

    let text = escapeHtml(run.text).replace(/\n/g, "<br>");
    if (run.bold) text = `<b>${text}</b>`;
    if (run.italic) text = `<i>${text}</i>`;
    if (run.underline) text = `<u>${text}</u>`;

    if (run.commentIds && run.commentIds.length > 0) {
      const ids = run.commentIds.join(",");
      text = `<span data-comment-ids="${ids}">${text}</span>`;
    }

    return text;
  }).join("");
}

function getBlockInnerHtml(block: Block): string {
  if (block.type === "page-break") {
    return "";
  }

  if (block.type === "table" && block.tableRows) {
    return block.tableRows.map((row) => {
      const rowHtml = row.cells.map((cell) => {
        const cellHtml = cell.children ? getInlineRunsHtml(cell.children) : "";
        return `<td>${cellHtml}</td>`;
      }).join("");
      return `<tr>${rowHtml}</tr>`;
    }).join("");
  }

  if (typeof block.content === "string") {
    return escapeHtml(block.content).replace(/\n/g, "<br>");
  }

  if (block.children) {
    return getInlineRunsHtml(block.children);
  }

  return "";
}

function getPatchViewTagName(block: Block): string {
  if (block.type && block.type.startsWith("h")) {
    return block.type;
  }

  if (block.type === "code") {
    return "pre";
  }

  if (block.type === "quote") {
    return "blockquote";
  }

  if (block.type === "list-item") {
    return "li";
  }

  if (block.type === "table") {
    return "table";
  }

  if (block.type === "page-break") {
    return "hr";
  }

  return "p";
}

function getPatchViewAttributes(block: Block): string[] {
  const attributes = [
    `data-block-id="${escapeHtml(block.id || "")}"`
  ];

  if (block.type === "list-item" && block.listType) {
    attributes.push(`data-list-type="${block.listType}"`);
  }

  if (block.type === "code" && block.language) {
    attributes.push(`data-language="${escapeHtml(block.language)}"`);
  }

  if (block.align && block.align !== "left") {
    attributes.push(`style="text-align: ${block.align}"`);
  }

  return attributes;
}

/**
 * Serializes blocks into a canonical, one-block-per-line patch view.
 *
 * This view is designed for patching, so it preserves stable block IDs
 * via data-block-id and avoids transient positional IDs.
 */
export function convertBlocksToPatchView(blocks: Block[]): string {
  if (!blocks || blocks.length === 0) return "";

  return blocks.map((block) => {
    const tagName = getPatchViewTagName(block);
    const attrs = getPatchViewAttributes(block).join(" ");
    if (tagName === "hr") {
      return `<hr ${attrs} />`;
    }
    return `<${tagName} ${attrs}>${getBlockInnerHtml(block)}</${tagName}>`;
  }).join("\n");
}

/**
 * Stateful parser that consumes tokens and builds Block objects.
 */
export function convertHtmlToBlocks(html: string): Block[] {
  const tokens = tokenizeHtml(html);
  const blocks: Block[] = [];
  
  let currentBlock: Block | null = null;
  let currentRuns: InlineRun[] = [];
  
  // Stacks for inline styles
  let boldDepth = 0;
  let italicDepth = 0;
  let underlineDepth = 0;

  // Track list context
  let currentListType: "bullet" | "number" | null = null;

  // Iterate through tokens, starting and finalizing blocks as block-level tags appear.
  
  for (const token of tokens) {
    if (token.type === "tag") {
      const { tagName, isClosing, attributes } = token;



      // Handle block-level tags.
      if (["h1", "h2", "h3", "h4", "p", "div", "li", "ul", "ol", "code", "pre", "blockquote"].includes(tagName)) {
        if (!isClosing) {
          // Starting a new block-level tag always finalizes any open block first.
          if (currentBlock) {
             finalizeBlock(currentBlock, currentRuns, blocks);
             currentBlock = null;
             currentRuns = [];
          }
          
          // List containers only set context. Individual <li> tags create blocks.
          if (tagName === "ul") {
            currentListType = "bullet";
            continue;
          } else if (tagName === "ol") {
            currentListType = "number";
            continue;
          } else if (["code", "pre"].includes(tagName)) {
            currentBlock = { type: "code", children: [] };
            if (attributes["data-language"]) {
              currentBlock.language = attributes["data-language"];
            }
          } else if (tagName === "blockquote") {
            currentBlock = { type: "quote", children: [] };
          } else {
            currentBlock = { type: "paragraph", children: [] };
            currentBlock.type = mapTagToBlockType(tagName);
            
            const blockId = getBlockIdFromAttributes(attributes);
            if (blockId) {
              currentBlock.id = blockId;
            }

            if (currentBlock.type === "list-item" && currentListType) {
              currentBlock.listType = currentListType;
            } else if (
              currentBlock.type === "list-item" &&
              (attributes["data-list-type"] === "bullet" || attributes["data-list-type"] === "number")
            ) {
              currentBlock.listType = attributes["data-list-type"] as "bullet" | "number";
            }
          }

          if (currentBlock && !currentBlock.id) {
            const blockId = getBlockIdFromAttributes(attributes);
            if (blockId) {
              currentBlock.id = blockId;
            }
          }
          
          if (attributes.style) {
            const styles = parseStyleString(attributes.style);
            if (styles["text-align"]) {
              const align = styles["text-align"];
              if (["left", "center", "right"].includes(align)) {
                currentBlock.align = align as any;
              }
            }
          }
        } else {
          // Closing a block-level tag ends the current block context.
          if (tagName === "ul" || tagName === "ol") {
            currentListType = null;
          } else if (currentBlock) {
             finalizeBlock(currentBlock, currentRuns, blocks);
             currentBlock = null;
             currentRuns = [];
          }
        }
        continue;
      }

      // Handle inline formatting tags.
      if (["b", "strong"].includes(tagName)) {
        boldDepth += isClosing ? -1 : 1;
      } else if (["i", "em"].includes(tagName)) {
        italicDepth += isClosing ? -1 : 1;
      } else if (["u"].includes(tagName)) {
        underlineDepth += isClosing ? -1 : 1;
      }
      
      // Convert <br> into a newline run inside the current block.
      if (tagName === "br") {
        if (!currentBlock) {
           currentBlock = { type: "paragraph", children: [] };
        }
        currentRuns.push({
          text: "\n",
          bold: boldDepth > 0 || undefined,
          italic: italicDepth > 0 || undefined,
          underline: underlineDepth > 0 || undefined
        });
      }
      
    } else if (token.type === "text") {
      // When we are between block-level tags (no open block), skip text that is
      // purely whitespace (spaces, newlines, tabs). LLMs often emit newlines
      // between tags (e.g. </h1>\n<p>), and without this guard those inter-block
      // whitespace characters are promoted into spurious <p><br></p> blocks.
      if (!currentBlock && token.content.trim() === "") {
        continue;
      }

      // Map text to runs, splitting out equation segments.
      const runs = splitTextIntoRuns(
        token.content,
        boldDepth > 0 || undefined,
        italicDepth > 0 || undefined,
        underlineDepth > 0 || undefined
      );

      if (runs.length === 0) continue;

      if (!currentBlock) {
        currentBlock = { type: "paragraph", children: [] };
      }

      currentRuns.push(...runs);
    }
  }

  // Final flush
  if (currentBlock) {
    finalizeBlock(currentBlock, currentRuns, blocks);
  }

  return blocks;
}


function splitTextIntoRuns(
  text: string,
  bold: boolean | undefined,
  italic: boolean | undefined,
  underline: boolean | undefined
): InlineRun[] {
  const result: InlineRun[] = [];
  // Regex for block equation $$...$$ and inline equation $...$
  const combinedRegex = /(\$\$.*?\$\$|\$.*?\$)/gs;

  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    // Preceding text
    if (match.index > lastIndex) {
      result.push({
        text: text.slice(lastIndex, match.index),
        bold,
        italic,
        underline,
      });
    }

    const raw = match[0];
    if (raw.startsWith("$$")) {
      const equation = raw.slice(2, -2).trim();
      result.push({
        text: "",
        equation,
        inline: false,
      });
    } else {
      const equation = raw.slice(1, -1);
      result.push({
        text: "",
        equation,
        inline: true,
      });
    }
    lastIndex = combinedRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push({
      text: text.slice(lastIndex),
      bold,
      italic,
      underline,
    });
  }

  return result;
}

function finalizeBlock(block: Block, runs: InlineRun[], blocks: Block[]) {
  // Filter out empty text runs while preserving equation-only runs.
  const validRuns = runs.filter(r => r.equation || r.text.length > 0);
  
  if (validRuns.length > 0) {
    block.children = validRuns;
  } else {
    if (!block.content && (!block.children || block.children.length === 0)) {
       block.children = [{ text: "" }];
    }
  }
  blocks.push(block);
}


// --- BlockSchema -> HTML Conversion ---

export function convertBlocksToHtml(blocks: Block[], comments?: Record<string, { id: string; author: string; content: string }>): string {
  if (!blocks || blocks.length === 0) return "";

  const htmlBlocks: string[] = [];
  let currentListTag: string | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (currentListTag && listItems.length > 0) {
      htmlBlocks.push(`<${currentListTag}>${listItems.join("")}</${currentListTag}>`);
      listItems = [];
      currentListTag = null;
    }
  };

  blocks.forEach((block, index) => {
    // Handle list items
    if (block.type === "list-item") {
      const listTag = block.listType === "number" ? "ol" : "ul";
      
      // If switching list types or starting a new list
      if (currentListTag && currentListTag !== listTag) {
        flushList();
      }
      
      if (!currentListTag) {
        currentListTag = listTag;
      }
      
      // Build list item content
      let innerHtml = "";
      if (block.content) {
        innerHtml = escapeHtml(block.content).replace(/\n/g, "<br>");
      } else if (block.children) {
        innerHtml = getInlineRunsHtml(block.children);
      }
      
      const blockId = block.id || (index + 1).toString();
      const listTypeAttr = block.listType ? ` data-list-type="${block.listType}"` : "";
      listItems.push(`<li id="${escapeHtml(blockId)}" data-block-id="${escapeHtml(blockId)}"${listTypeAttr}>${innerHtml}</li>`);
      return;
    }
    
    // Not a list item, so flush any pending list
    flushList();

    if (block.type === "page-break") {
      const blockId = block.id || (index + 1).toString();
      htmlBlocks.push(`<hr id="${escapeHtml(blockId)}" data-block-id="${escapeHtml(blockId)}" data-type="page-break" />`);
      return;
    }

    if (block.type === "table") {
      const blockId = block.id || (index + 1).toString();
      const innerHtml = getBlockInnerHtml(block);
      htmlBlocks.push(`<table id="${escapeHtml(blockId)}" data-block-id="${escapeHtml(blockId)}">${innerHtml}</table>`);
      return;
    }
    
    // Determine tag name for regular blocks
    let tagName = "p";
    if (block.type && block.type.startsWith("h")) {
      tagName = block.type; // h1, h2, h3, h4
    } else if (block.type === "code") {
      tagName = "pre";
    } else if (block.type === "quote") {
      tagName = "blockquote";
    }
    
    const blockId = block.id || (index + 1).toString();

    // Build attributes
    const parts: string[] = [];
    parts.push(tagName);
    parts.push(`id="${escapeHtml(blockId)}"`);
    parts.push(`data-block-id="${escapeHtml(blockId)}"`);
    
    // Add language for code blocks
    if (block.type === "code" && block.language) {
      parts.push(`data-language="${escapeHtml(block.language)}"`);
    }
    
    // Style for alignment
    if (block.align && block.align !== "left") {
      parts.push(`style="text-align: ${escapeHtml(block.align)}"`);
    }

    const openTag = `<${parts.join(" ")}>`;
    const closeTag = `</${tagName}>`;
    
    // Build Content
    let innerHtml = "";
    if (block.content) {
      innerHtml = escapeHtml(block.content).replace(/\n/g, "<br>");
    } else if (block.children) {
      innerHtml = getInlineRunsHtml(block.children);
    }
    
    // Return HTML tag with embedded ID
    htmlBlocks.push(`${openTag}${innerHtml}${closeTag}`);
  });

  // Flush any remaining list
  flushList();

  let htmlComments = "";
  if (comments && Object.keys(comments).length > 0) {
    const commentItems = Object.values(comments).map(c => {
      // Escape content and author
      const content = escapeHtml(c.content);
      const author = escapeHtml(c.author);
      return `<comment id="${escapeHtml(c.id)}" author="${author}">${content}</comment>`;
    }).join("");
    htmlComments = `<comments>${commentItems}</comments>`;
  }

  return htmlBlocks.join("") + htmlComments;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
