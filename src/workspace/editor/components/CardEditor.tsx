import React, { useMemo, useState } from "react";

import QissaTheme from "../themes/QissaTheme";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TRANSFORMERS } from "../transformers/markdown";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import TableCellResizer from "../plugins/TableCellResizer";
import TableActionMenuPlugin from "../plugins/TableActionMenuPlugin";
import TableHoverActionsV2Plugin from "../plugins/TableHoverActionsV2Plugin";
import TableScrollShadowPlugin from "../plugins/TableScrollShadowPlugin";
import TableFitNestedTablePlugin from "../plugins/TableFitNestedTablePlugin";

import PasteMarkdownPlugin from "../plugins/PasteMarkdownPlugin";
import FloatingToolBarPlugin from "../plugins/FloatingToolBarPlugin";
import DraggableBlockPlugin from "../plugins/DraggableBlockPlugin";
import InsertBlockPlugin from "../plugins/InsertBlockPlugin";
import ListMaxIndentLevelPlugin from "../plugins/ListMaxIndentLevelPlugin";
import CodeHighlightPlugin from "../plugins/CodeHighlightPlugin";
import { InstanceScope, useInstanceContext } from "@workspace/contexts/instance/InstanceContext";
import DocumentWebSocketSyncPlugin from "@workspace/sync/EditorSyncPlugin";
import HighlightCommentPlugin from "../plugins/HighlightCommentPlugin";
import { PageBreakNode } from "../nodes/PageBreakNode";
import PageBreakPlugin from "../plugins/PageBreakPlugin";
import FindPlugin from "../plugins/FindPlugin";
import { EquationNode } from "../nodes/EquationNode";
import EquationsPlugin from "../plugins/EquationsPlugin";



function Placeholder() {
	return <div className="editor-placeholder">Enter some rich text...</div>;
}

const editorConfig: InitialConfigType = {
	namespace: "doc-editor",
	theme: QissaTheme,
	onError(error) {
		throw error;
	},
	nodes: [
		HeadingNode,
		ListNode,
		ListItemNode,
		QuoteNode,
		CodeNode,
		CodeHighlightNode,
		TableNode,
		TableCellNode,
		TableRowNode,
		AutoLinkNode,
		LinkNode,
		MarkNode,
		PageBreakNode,
		EquationNode,
	],
};


function Cards({ initialContent, instanceId }: { initialContent?: string; instanceId?: string }) {
	const { instanceId: activeInstanceId } = useInstanceContext();
	const [floatingAnchorElem, setFloatingAnchorElem] = useState<HTMLDivElement | null>(null);

	const onRef = (anchorElem: HTMLDivElement | null) => {
		setFloatingAnchorElem(anchorElem);
	};

	const config = useMemo(() => {
		const baseConfig = { ...editorConfig };
		if (initialContent) {
			try {
				// Check if it's already a full state or just a node
				JSON.parse(initialContent); // Validate JSON
				// Wrap in root if it looks like a single node (simple heuristic or just always wrap if passed from drag)
				// The drag source sends node.exportJSON(), which is just the node object.
				baseConfig.editorState = `{"root":{"children":[${initialContent}],"direction":null,"format":"","indent":0,"type":"root","version":1}}`;
			} catch (e) {
				console.error("Invalid initial content JSON", e);
			}
		}
		return baseConfig;
	}, [initialContent]);

	// Card-level editor does not surface document instance save/delete UI.
	// It still uses InstanceScope so WebSocket sync can scope to an instance.
	const isActiveEditor = !instanceId || activeInstanceId === instanceId;

	return (
		<LexicalComposer initialConfig={config}>
			{instanceId ? (
				<InstanceScope instanceId={instanceId}>
					<div
						style={{
							display: "flex",
							flex: 1,
							minHeight: 0,
							width: "100%",
							height: "100%",
							backgroundColor: "#fff", // Ensure card has a background
							borderRadius: "8px", // Keep some rounded corners for aesthetics
							overflowY: "auto", // Allow scrolling for long content
						}}
					>
						<div className="editor-container" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
							<DocumentWebSocketSyncPlugin />
							<div className="editor-inner" ref={onRef} style={{ flex: 1, outline: "none" }}>
								<RichTextPlugin
									contentEditable={<ContentEditable className="editor-input" style={{ outline: "none", minHeight: "100%", padding: "16px 48px" }} />}
									placeholder={<Placeholder />}
									ErrorBoundary={LexicalErrorBoundary}
								/>
								<HistoryPlugin />
								<CodeHighlightPlugin />
								<ListPlugin />
								<ListMaxIndentLevelPlugin maxDepth={7} />
								<MarkdownShortcutPlugin transformers={TRANSFORMERS} />
								<PasteMarkdownPlugin />
								<FindPlugin isActive={isActiveEditor} />
								<FloatingToolBarPlugin />
								<TablePlugin hasCellMerge={true} hasCellBackgroundColor={true} />
								<TableScrollShadowPlugin />
								<TableFitNestedTablePlugin />
								{floatingAnchorElem && (
									<>
										<InsertBlockPlugin anchorElem={floatingAnchorElem} />
										<DraggableBlockPlugin anchorElem={floatingAnchorElem} />
										<TableCellResizer />
										<TableActionMenuPlugin anchorElem={floatingAnchorElem} cellMerge={true} />
										<TableHoverActionsV2Plugin anchorElem={floatingAnchorElem} />
									</>
								)}
								<HighlightCommentPlugin />
								<PageBreakPlugin />
								<EquationsPlugin />

							</div>
						</div>
					</div>
				</InstanceScope>
			) : (
				/* No instanceId: render editor without WebSocket sync (local-only card) */
				<div
					style={{
						display: "flex",
						flex: 1,
						minHeight: 0,
						width: "100%",
						height: "100%",
						backgroundColor: "#fff",
						borderRadius: "8px",
						overflowY: "auto",
					}}
				>
					<div className="editor-container" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
						<div className="editor-inner" ref={onRef} style={{ flex: 1, outline: "none" }}>
							<RichTextPlugin
								contentEditable={<ContentEditable className="editor-input" style={{ outline: "none", minHeight: "100%", padding: "16px 48px" }} />}
								placeholder={<Placeholder />}
								ErrorBoundary={LexicalErrorBoundary}
							/>
							<HistoryPlugin />
							<CodeHighlightPlugin />
							<ListPlugin />
							<ListMaxIndentLevelPlugin maxDepth={7} />
							<MarkdownShortcutPlugin transformers={TRANSFORMERS} />
							<PasteMarkdownPlugin />
							<FindPlugin isActive={isActiveEditor} />
							<FloatingToolBarPlugin />
							<TablePlugin hasCellMerge={true} hasCellBackgroundColor={true} />
							<TableScrollShadowPlugin />
							<TableFitNestedTablePlugin />
							{floatingAnchorElem && (
								<>
									<InsertBlockPlugin anchorElem={floatingAnchorElem} />
									<DraggableBlockPlugin anchorElem={floatingAnchorElem} />
									<TableCellResizer />
									<TableActionMenuPlugin anchorElem={floatingAnchorElem} cellMerge={true} />
									<TableHoverActionsV2Plugin anchorElem={floatingAnchorElem} />
								</>
							)}
							<HighlightCommentPlugin />
							<PageBreakPlugin />
							<EquationsPlugin />

						</div>
					</div>
				</div>
			)}
		</LexicalComposer>
	);
}

// Optimization: Prevent unnecessary re-renders during Canvas drags/zooms
// The initialContent and instanceId are strings and rarely change.
export default React.memo(Cards);
