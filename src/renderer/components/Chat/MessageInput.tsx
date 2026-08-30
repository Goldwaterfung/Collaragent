import React, { useState, KeyboardEvent, useRef, useMemo, useEffect } from 'react';
import { useInstanceContext } from '@workspace/contexts/instance/InstanceContext';
import { Trie } from '@shared/algorithms/Trie';
import { useChatStore } from '../../store/chatStore';

import { MentionList, SuggestionItem } from './MentionList';
import { StatsIcon } from '../../assets/icons/StatsIcon';
import { SendIcon } from '../../assets/icons/SendIcon';
import { StopIcon } from '../../assets/icons/StopIcon';
import { TokenStats } from './TokenStats';

interface MessageInputProps {
    onSendMessage: (message: string) => void;
    onCancelMessage?: () => void;
    disabled: boolean;
}

/**
 * Calculates the coordinates of the caret in a textarea.
 * This is a simplified version of techniques used in libraries like textarea-caret.
 */
const getCaretCoordinates = (element: HTMLTextAreaElement, position: number) => {
    const div = document.createElement('div');
    const style = window.getComputedStyle(element);

    // Copy relevant styles
    const properties = [
        'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
        'textAlign', 'textTransform', 'textIndent', 'textDecoration',
        'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize'
    ];

    properties.forEach(prop => {
        div.style.setProperty(prop, style.getPropertyValue(prop));
    });

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.top = '0';
    div.style.left = '0';

    // Create text content up to the caret
    div.textContent = element.value.substring(0, position);

    // Create a span for the caret position
    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);

    document.body.appendChild(div);

    const { offsetLeft: left, offsetTop: top } = span;
    const rect = element.getBoundingClientRect();

    document.body.removeChild(div);

    // Return fixed coordinates
    return {
        top: rect.top + top - element.scrollTop,
        left: rect.left + left - element.scrollLeft
    };
};

export const MessageInput: React.FC<MessageInputProps> = ({ onSendMessage, onCancelMessage, disabled }) => {
    const { instanceSummaries, projects } = useInstanceContext();
    const [input, setInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const draftInput = useChatStore((state) => state.draftInput);
    const setDraftInput = useChatStore((state) => state.setDraftInput);

    // Suggestion State
    const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [mentionPosition, setMentionPosition] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });
    const [triggerIndex, setTriggerIndex] = useState(-1);

    // Token Stats Modal State
    const [showTokenStats, setShowTokenStats] = useState(false);

    // Build Trie
    const trie = useMemo(() => {
        const t = new Trie<SuggestionItem>();
        instanceSummaries.forEach(inst => {
            const project = projects.find(p => p.id === inst.projectId);
            const item: SuggestionItem = { ...inst, projectName: project?.name || 'Unknown' };
            t.insert(inst.name || '', item);
        });
        return t;
    }, [instanceSummaries, projects]);

    useEffect(() => {
        if (draftInput === null || draftInput === undefined) return;
        setInput(draftInput);
        setDraftInput(null);
        setShowSuggestions(false);
        setSelectedIndex(0);
        setSuggestions([]);

        if (textareaRef.current) {
            const end = draftInput.length;
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(end, end);
        }
    }, [draftInput, setDraftInput]);

    // Auto-resize textarea height
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, [input]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const selectionStart = e.target.selectionStart;
        setInput(value);

        // Check for trigger '@'
        const lastAt = value.lastIndexOf('@', selectionStart - 1);

        if (lastAt !== -1) {
            // Check if match is valid (start of string or preceded by whitespace)
            const prevChar = value[lastAt - 1];
            if (lastAt === 0 || prevChar === ' ' || prevChar === '\n') {
                const query = value.slice(lastAt + 1, selectionStart);

                // Don't search across newlines
                if (!query.includes('\n')) {
                    const matches = trie.search(query);
                    if (matches.length > 0) {
                        setSuggestions(matches.slice(0, 10)); // Limit results
                        setTriggerIndex(lastAt);
                        setSelectedIndex(0);
                        setShowSuggestions(true);

                        // Calculate Position
                        if (textareaRef.current) {
                            const coords = getCaretCoordinates(textareaRef.current, lastAt + 1);

                            // Positioning:
                            // We want the BOTTOM of the menu to be slightly above the text line (coords.top).
                            // coords.top is the Y position of the top of the cursor line relative to the viewport top.
                            // To pin the bottom of the menu there, we set CSS 'bottom' to (ViewportHeight - coords.top).
                            // We add a small buffer (e.g. 5px) so it doesn't touch the text.
                            const distFromBottom = window.innerHeight - coords.top + 5;

                            setMentionPosition({ bottom: distFromBottom, left: coords.left });
                        }
                        return;
                    }
                }
            }
        }
        setShowSuggestions(false);
    };

    const insertMention = (item: SuggestionItem) => {
        const typeStr = (item.type || 'canvas').charAt(0).toUpperCase() + (item.type || 'canvas').slice(1);
        const safeName = (item.name || '').replace(/"/g, '\\"');
        const safeProject = item.projectName.replace(/"/g, '\\"');

        const tag = `${typeStr} "${safeName}" in Project "${safeProject}" `;

        const before = input.slice(0, triggerIndex);
        const after = input.slice(textareaRef.current?.selectionStart || input.length);

        const newValue = before + tag + after;
        setInput(newValue);
        setShowSuggestions(false);

        // Restore focus and update cursor
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                const newCursorPos = before.length + tag.length;
                textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
            }
        }, 0);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showSuggestions) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % suggestions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(suggestions[selectedIndex]);
                return;
            }
            if (e.key === 'Escape') {
                setShowSuggestions(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSend = () => {
        if (input.trim() && !disabled) {
            onSendMessage(input.trim());
            setInput('');
            setShowSuggestions(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const instanceId = e.dataTransfer.getData("application/x-collar-instance-id");
        if (instanceId) {
            const summary = instanceSummaries.find(s => s.instanceId === instanceId);
            if (summary) {
                const project = projects.find(p => p.id === summary.projectId);
                const projectName = project?.name || 'Unknown';

                const typeStr = (summary.type || 'canvas').charAt(0).toUpperCase() + (summary.type || 'canvas').slice(1);
                const safeName = (summary.name || '').replace(/"/g, '\\"');
                const safeProject = projectName.replace(/"/g, '\\"');

                const tag = `${typeStr} "${safeName}" in Project "${safeProject}" `;

                setInput(prev => prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + tag);
            }
        }
    };

    return (
        <div className="message-input p-2 bg-surface-50 relative rounded-2xl border border-surface-200 focus-within:border-primary/50 transition-all">
            {showSuggestions && (
                <MentionList
                    suggestions={suggestions}
                    selectedIndex={selectedIndex}
                    onSelect={insertMention}
                    position={mentionPosition}
                />
            )}
            <div className="relative flex items-end gap-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={disabled ? "Agent is working..." : "Type a message... (@ to mention)"}
                    disabled={disabled}
                    className="flex-1 p-3 border border-surface-200 rounded-lg resize-none focus:outline-none bg-surface-100 text-(--ev-c-text-1) placeholder-(--ev-c-text-3) max-h-[300px] min-h-[50px] custom-scrollbar text-sm"
                    rows={1}
                />
                <button
                    onClick={() => setShowTokenStats(true)}
                    className="p-3 rounded-lg border border-surface-200 bg-surface-100 hover:bg-surface-200 text-(--ev-c-text-3) hover:text-(--ev-c-text-1) transition-colors shrink-0"
                    title="Token Usage Statistics"
                >
                    <StatsIcon />
                </button>
                <button
                    onClick={disabled ? onCancelMessage : handleSend}
                    disabled={!disabled && !input.trim()}
                    className={`p-3 rounded-lg font-medium transition-opacity text-sm shadow-sm shrink-0 flex items-center justify-center ${disabled
                        ? "bg-red-500 hover:bg-red-600 text-white"
                        : "bg-(--color-primary) text-(--ev-c-black) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        }`}
                    title={disabled ? "Stop Generation" : "Send Message"}
                >
                    {disabled ? <StopIcon /> : <SendIcon />}
                </button>
            </div>
            {showTokenStats && <TokenStats onClose={() => setShowTokenStats(false)} />}
        </div>
    );
};
