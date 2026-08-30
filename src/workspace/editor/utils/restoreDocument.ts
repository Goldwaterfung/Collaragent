import type { LexicalEditor } from "lexical";
import type { EditorCommand } from "@shared/commands";
import type { DocumentPayload } from "@workspace/persistence/editorContent";
import { applyDocumentToEditor } from "./editorContentToLexical";
import { applyEditorCommands } from "./editorCommandReducer";

export function restoreDocumentInEditor(
  editor: LexicalEditor,
  snapshot: DocumentPayload,
  commands: EditorCommand[],
): void {
  const finalDoc = applyEditorCommands(snapshot, commands);
  applyDocumentToEditor(editor, finalDoc, { tag: "sync" });
}
