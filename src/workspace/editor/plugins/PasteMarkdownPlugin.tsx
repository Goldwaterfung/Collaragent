import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { TRANSFORMERS } from "../transformers/markdown";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from "lexical";

/**
 * Intercepts paste events in the editor and, when the pasted text looks like
 * Markdown, replaces the default paste with a proper Markdown import using
 * Lexical's markdown converters.
 *
 * Lexical normalizes Markdown input by default, which collapses single
 * line breaks inside paragraphs. For paste, we preserve newlines so the
 * editor content matches the pasted Markdown structure more closely.
 */
export default function PasteMarkdownPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (e: any) => {
        // Let inputs/textareas handle their own paste (e.g. equation editor).
        const target = e.target as HTMLElement;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
        ) {
          return false;
        }

        const text = e.clipboardData?.getData("text/plain");
        if (!text) return false;

        // Heuristic: detect Markdown-like content.
        // Matches headers, hr, code fences, blockquotes, unordered/ordered
        // lists, links, tables, and LaTeX equations.
        const looksLikeMarkdown =
          /(^#\s)|(^-{3,}$)|(^```)|(^>\s)|(^\*\s)|(^\d+\.\s)|(^\[.*\]\(.*\))|(^\|.*\|)|(\$)/m.test(
            text
          );
        if (!looksLikeMarkdown) return false;

        e.preventDefault();

        editor.update(() => {
          const selection = $getSelection();

          // Convert markdown into the editor root so that each block gets its
          // own correct node type (HeadingNode, ParagraphNode, CodeNode …).
          // NOTE: $convertFromMarkdownString called WITHOUT a parent node
          // replaces the entire editor content, which is the correct behaviour
          // for a full-document markdown paste.
          $convertFromMarkdownString(text, TRANSFORMERS, undefined, true);

          // If a range selection existed, move to the end of the new content.
          if ($isRangeSelection(selection)) {
            const root = $getRoot();
            const lastChild = root.getLastChild();
            if (lastChild) {
              lastChild.selectEnd();
            }
          }
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}
