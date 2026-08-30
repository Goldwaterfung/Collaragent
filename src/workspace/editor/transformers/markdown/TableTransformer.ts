import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $isElementNode,
} from "lexical";
import { $convertFromMarkdownString, ElementTransformer, TRANSFORMERS } from "@lexical/markdown";

// Regex to detect a table row.
// A table row line usually starts with | and ends with | (optional in some implementations, but GFM matches pipes)
// Capture group 1: content inside the pipes
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-*:? ?)+\|\s?$/;

export const TABLE: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node, exportChildren) => {
    if (!$isTableNode(node)) {
      return null;
    }
    const output: string[] = [];
    for (const row of node.getChildren()) {
      const rowOutput: string[] = [];
      if (!$isTableRowNode(row)) {
        continue;
      }
      for (const cell of row.getChildren()) {
        if (!$isElementNode(cell)) {
          continue;
        }
        rowOutput.push(exportChildren(cell));
      }
      output.push(`| ${rowOutput.join(" | ")} |`);
    }
    return output.join("\n");
  },
  regExp: TABLE_ROW_REG_EXP,
  replace: (parentNode, _1, match) => {
    // match[1] is the content inside the outer pipes
    const rowContent = match[1];
    
    // Check for divider row pattern (e.g., --- | ---)
    if (TABLE_ROW_DIVIDER_REG_EXP.test(match[0])) {
      // It's a divider row, we might need to mark previous row as header
      const previousNode = parentNode.getPreviousSibling();
      if ($isTableNode(previousNode)) {
          // Get the last row of the previous table
          const lastRow = previousNode.getLastChild();
          if ($isTableRowNode(lastRow)) {
              // Be default set all cells in the previous row (header) as header cells
              // Ideally we should parse the divider to handle alignment (:---, :---:) 
              // but for now let's just mark them as headers.
              for (const cell of lastRow.getChildren()) {
                  if ($isTableCellNode(cell)) {
                      cell.setHeaderStyles(TableCellHeaderStates.ROW);
                  }
              }
          }
      }
      parentNode.remove();
      return;
    }

    const cellsString = rowContent.split("|");
    const tableRow = $createTableRowNode();

    for (const cellString of cellsString) {
      const tableCell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
      const paragraph = $createParagraphNode();
      
      // Convert cell string content using standard markdown transformers
      // We filter out the TABLE transformer itself to avoid recursion if we were including it in the main list, 
      // though here we just use the built-in TRANSFORMERS which doesn't include TABLE yet.
      $convertFromMarkdownString(cellString.trim(), TRANSFORMERS, paragraph);
      
      tableCell.append(paragraph);
      tableRow.append(tableCell);
    }

    const previousNode = parentNode.getPreviousSibling();
    if ($isTableNode(previousNode)) {
      previousNode.append(tableRow);
      parentNode.remove();
    } else {
      const table = $createTableNode();
      table.append(tableRow);
      parentNode.replace(table);
    }
  },
  type: "element",
};
