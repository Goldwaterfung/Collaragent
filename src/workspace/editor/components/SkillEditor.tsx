import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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

import QissaTheme from "../themes/QissaTheme";
import CodeHighlightPlugin from "../plugins/CodeHighlightPlugin";
import FloatingToolBarPlugin from "../plugins/FloatingToolBarPlugin";
import { TABLE } from "../transformers/markdown/TableTransformer";

type SkillEditorProps = {
    skillMdPath: string;
};

const editorConfig: InitialConfigType = {
    namespace: "skill-editor",
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
    ],
};

function Placeholder() {
    return <div className="editor-placeholder px-8 py-8 font-mono text-[13px] text-black/50">Enter skill descriptions...</div>;
}

export function SkillEditor({ skillMdPath }: SkillEditorProps) {
    const [rawContent, setRawContent] = useState<{ name: string; description: string; extraYaml: string; body: string } | null>(null);
    const rawContentRef = useRef<{ name: string; description: string; extraYaml: string; body: string } | null>(null);
    rawContentRef.current = rawContent;

    const [isSaving, setIsSaving] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const editorStateRef = useRef<any>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea when content changes
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [rawContent?.description]);

    // Load content on mount or path change
    useEffect(() => {
        setRawContent(null);
        editorStateRef.current = null;
        window.skillsIPC.readFile({ path: skillMdPath })
            .then(res => {
                const text = res.content;
                const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
                let name = '';
                let description = '';
                let extraYaml = '';

                if (match) {
                    const yamlLines = match[1].split('\n');
                    const otherLines: string[] = [];
                    for (const line of yamlLines) {
                        if (line.startsWith('name:')) {
                            name = line.substring(5).trim();
                            if ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"'))) {
                                name = name.substring(1, name.length - 1);
                            }
                        } else if (line.startsWith('description:')) {
                            description = line.substring(12).trim();
                            if ((description.startsWith("'") && description.endsWith("'")) || (description.startsWith('"') && description.endsWith('"'))) {
                                description = description.substring(1, description.length - 1);
                            }
                        } else {
                            if (line.trim() !== '') {
                                otherLines.push(line);
                            }
                        }
                    }
                    extraYaml = otherLines.join('\n').trim();

                    setRawContent({
                        name,
                        description,
                        extraYaml,
                        body: match[2].trim()
                    });
                } else {
                    setRawContent({
                        name: '',
                        description: '',
                        extraYaml: '',
                        body: text.trim()
                    });
                }
            })
            .catch(err => console.error('Failed to read skill file:', err));
    }, [skillMdPath]);

    const saveContent = useCallback(async () => {
        if (!rawContentRef.current) return;

        const { name, description, extraYaml } = rawContentRef.current;
        let markdown = rawContentRef.current.body;

        if (editorStateRef.current) {
            editorStateRef.current.read(() => {
                markdown = $convertToMarkdownString([TABLE, ...TRANSFORMERS]);
            });
        }

        setIsSaving(true);
        try {
            let yamlStr = `name: ${name}\ndescription: ${description}`;
            if (extraYaml) yamlStr += `\n${extraYaml}`;

            const newContent = `---\n${yamlStr}\n---\n\n${markdown}`;

            await window.skillsIPC.writeFile({ path: skillMdPath, content: newContent.trimStart() });
        } catch (err) {
            console.error('Failed to save skill:', err);
        } finally {
            setIsSaving(false);
        }
    }, [skillMdPath]);

    const triggerSave = useCallback(() => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveContent();
        }, 800);
    }, [saveContent]);

    // Debounced save on content change
    const handleContentChange = useCallback((editorState: any) => {
        editorStateRef.current = editorState;
        triggerSave();
    }, [triggerSave]);

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRawContent(prev => prev ? { ...prev, name: e.target.value } : null);
        triggerSave();
    };

    const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setRawContent(prev => prev ? { ...prev, description: e.target.value } : null);
        triggerSave();
    };

    const bodyText = rawContent?.body;
    const config = useMemo(() => {
        const baseConfig = { ...editorConfig };
        if (bodyText) {
            baseConfig.editorState = () => $convertFromMarkdownString(bodyText, [TABLE, ...TRANSFORMERS]);
        }
        return baseConfig;
    }, [bodyText]);

    if (rawContent === null) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-(--ev-c-text-3) font-medium animate-pulse">
                Loading skill...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Toolbar: skill name, save indicator */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-surface-200 bg-surface-50">
                <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-[10px] uppercase font-bold text-(--ev-c-text-3) tracking-wider">Skill Editor</span>
                    <span className="text-[10px] font-mono text-(--ev-c-text-3) truncate opacity-60">{skillMdPath}</span>
                </div>
                {isSaving && (
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] text-(--ev-c-text-3)">Saving...</span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto w-full relative pb-12">
                <div className="px-8 pt-6 pb-4">
                    <div className="bg-surface-50 border border-surface-200 rounded-lg p-5 space-y-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-bold text-(--ev-c-text-3) uppercase tracking-wider">Skill Name</label>
                            <input
                                type="text"
                                className="w-full bg-white border border-surface-200 rounded px-3 py-2 text-sm text-(--ev-c-text-1) focus:outline-none focus:border-primary transition-colors font-mono shadow-sm"
                                value={rawContent.name}
                                onChange={handleNameChange}
                                placeholder="e.g. responsive-design"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-bold text-(--ev-c-text-3) uppercase tracking-wider">Description</label>
                            <textarea
                                ref={textareaRef}
                                className="w-full bg-white border border-surface-200 rounded px-3 py-2 text-sm text-(--ev-c-text-1) focus:outline-none focus:border-primary transition-colors resize-none overflow-hidden min-h-[40px] shadow-sm leading-relaxed"
                                value={rawContent.description}
                                onChange={handleDescriptionChange}
                                placeholder="Describe what this skill does..."
                                rows={1}
                            />
                        </div>
                        {rawContent.extraYaml && (
                            <div className="bg-white rounded p-4 font-mono text-[11px] text-black/60 whitespace-pre border border-surface-200 mt-2 shadow-sm relative">
                                <span className="absolute top-0 right-0 py-1 px-2 text-[9px] uppercase font-bold text-black/40">Extra YAML</span>
                                {rawContent.extraYaml}
                            </div>
                        )}
                    </div>
                </div>

                <LexicalComposer initialConfig={config}>
                    <div className="editor-container" style={{ display: "flex", flexDirection: "column" }}>
                        <div className="editor-inner" style={{ outline: "none" }}>
                            <RichTextPlugin
                                contentEditable={<ContentEditable className="editor-input" style={{ outline: "none", padding: "16px 36px" }} />}
                                placeholder={<Placeholder />}
                                ErrorBoundary={LexicalErrorBoundary}
                            />
                            <HistoryPlugin />
                            <CodeHighlightPlugin />
                            <ListPlugin />
                            <MarkdownShortcutPlugin transformers={[TABLE, ...TRANSFORMERS]} />
                            <OnChangePlugin onChange={handleContentChange} />
                            <FloatingToolBarPlugin pluginType="skill" />
                        </div>
                    </div>
                </LexicalComposer>
            </div>
        </div>
    );
}

