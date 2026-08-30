import React, { useEffect, useRef, useMemo, useCallback } from 'react';
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
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { TRANSFORMERS, $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import QissaTheme from "../themes/QissaTheme";
import CodeHighlightPlugin from "../plugins/CodeHighlightPlugin";
import FloatingToolBarPlugin from "../plugins/FloatingToolBarPlugin";
import { TABLE } from "../transformers/markdown/TableTransformer";

type MemoEditorProps = {
    value: string;
    editable: boolean;
    placeholder?: string;
    onCommit: (nextValue: string) => void;
};

const editorConfig: InitialConfigType = {
    namespace: "memo-editor",
    theme: QissaTheme,
    onError(error: Error) {
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
    ],
};

function Placeholder({ text }: { text: string }) {
    return <div className="editor-placeholder absolute top-0 left-0 px-3 py-3 font-mono text-[13px] text-black/50 pointer-events-none">{text}</div>;
}

function EditablePlugin({ editable }: { editable: boolean }) {
    const [editor] = useLexicalComposerContext();
    useEffect(() => {
        editor.setEditable(editable);
    }, [editor, editable]);
    return null;
}

export const MemoEditor: React.FC<MemoEditorProps> = ({
    value,
    editable,
    placeholder = 'Type a memo...',
    onCommit
}) => {
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const valueRef = useRef(value);

    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    const handleContentChange = useCallback((editorState: any) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            editorState.read(() => {
                const markdown = $convertToMarkdownString([TABLE, ...TRANSFORMERS]);
                if (markdown !== valueRef.current) {
                    onCommit(markdown);
                }
            });
        }, 800);
    }, [onCommit]);

    const config = useMemo(() => {
        const baseConfig = { ...editorConfig, editable };
        if (value) {
            baseConfig.editorState = () => $convertFromMarkdownString(value, [TABLE, ...TRANSFORMERS]);
        }
        return baseConfig;
    }, [value, editable]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
            <LexicalComposer initialConfig={config}>
                <div className="editor-container relative" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                    <div className="editor-inner" style={{ outline: "none", flex: 1, overflowY: 'auto', position: 'relative' }}>
                        <RichTextPlugin
                            contentEditable={
                                <ContentEditable 
                                    className="editor-input" 
                                    style={{ 
                                        outline: "none", 
                                        padding: "12px", 
                                        minHeight: '100%',
                                        fontFamily: 'inherit',
                                        fontSize: '14px',
                                        lineHeight: '1.5',
                                        color: '#333'
                                    }} 
                                />
                            }
                            placeholder={<Placeholder text={placeholder} />}
                            ErrorBoundary={LexicalErrorBoundary}
                        />
                        <HistoryPlugin />
                        <CodeHighlightPlugin />
                        <ListPlugin />
                        <MarkdownShortcutPlugin transformers={[TABLE, ...TRANSFORMERS]} />
                        <OnChangePlugin onChange={handleContentChange} />
                        <EditablePlugin editable={editable} />
                        {editable && <FloatingToolBarPlugin pluginType="default" />}
                    </div>
                </div>
            </LexicalComposer>
        </div>
    );
};
