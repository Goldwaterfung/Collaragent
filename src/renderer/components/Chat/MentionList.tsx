import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NormalizedInstanceSummary } from '@shared/types/instance';
import { CanvasIcon } from '../../assets/icons/CanvasIcon';
import { DocumentIcon } from '../../assets/icons/DocumentIcon';

export type SuggestionItem = NormalizedInstanceSummary & {
    projectName: string;
};

export interface MentionListProps {
    suggestions: SuggestionItem[];
    selectedIndex: number;
    onSelect: (item: SuggestionItem) => void;
    position: { top?: number; bottom?: number; left: number };
}

export function MentionList({ suggestions, selectedIndex, onSelect, position }: MentionListProps) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Scroll selected into view
        if (listRef.current) {
            const selectedElement = listRef.current.children[selectedIndex + 1] as HTMLElement; // +1 because of header
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    if (suggestions.length === 0) return null;

    return createPortal(
        <div
            className="fixed z-[9999] w-64 max-h-48 overflow-y-auto bg-[var(--color-surface-50)] border border-[var(--color-surface-200)] rounded-lg shadow-xl flex flex-col py-1 font-sans text-base antialiased"
            style={{
                top: position.top,
                bottom: position.bottom,
                left: position.left,
            }}
            ref={listRef}
        >
            {suggestions.map((item, index) => (
                <button
                    key={item.instanceId}
                    className={`
                        w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-xs shrink-0
                        ${index === selectedIndex
                            ? 'bg-[var(--color-primary)] text-[var(--ev-c-black)]'
                            : 'text-[var(--ev-c-text-1)] hover:bg-[var(--color-surface-100)]'
                        }
                    `}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect(item);
                    }}
                    onMouseDown={(e) => {
                        // Prevent focus loss on click
                        e.preventDefault();
                    }}
                >
                    <span className={`flex-shrink-0 ${index === selectedIndex ? 'text-black' : 'text-[var(--ev-c-text-2)]'}`}>
                        {item.type === 'canvas' ? <CanvasIcon width={14} height={14} /> : <DocumentIcon width={14} height={14} />}
                    </span>
                    <div className="flex flex-col min-w-0 overflow-hidden">
                        <span className="truncate font-medium">{item.name}</span>
                        <span className={`text-[10px] truncate ${index === selectedIndex ? 'text-black/70' : 'text-[var(--ev-c-text-3)]'}`}>
                            Project: {item.projectName}
                        </span>
                    </div>
                </button>
            ))}
        </div>,
        document.body
    );
}
