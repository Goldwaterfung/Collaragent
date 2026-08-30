import React, { useEffect, useState, useRef } from 'react';
import { useSkillsContext } from '@workspace/contexts/skills/SkillsContext';
import { SkillEditor } from '../../../workspace/editor/components/SkillEditor';

export function SkillEditorModal() {
    const { activeSkillPath, setActiveSkillPath } = useSkillsContext();
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ x: 100, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (activeSkillPath) {
            setIsOpen(true);
        } else {
            setIsOpen(false);
        }
    }, [activeSkillPath]);

    const handleClose = () => {
        setIsOpen(false);
        setActiveSkillPath(null);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPosition({
            x: e.clientX - dragOffset.current.x,
            y: e.clientY - dragOffset.current.y
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('mousemove', handleMouseMove as any);
        } else {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousemove', handleMouseMove as any);
        }
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousemove', handleMouseMove as any);
        };
    }, [isDragging]);


    if (!isOpen || !activeSkillPath) return null;

    return (
        <div
            className="fixed z-50 pointer-events-none"
            style={{
                left: 0,
                top: 0,
                width: '100vw',
                height: '100vh',
            }}
        >
            <div
                className="bg-surface-50 w-[800px] h-[600px] rounded-xl overflow-hidden flex flex-col absolute border border-surface-200 pointer-events-auto"
                style={{
                    transform: `translate(${position.x}px, ${position.y}px)`,
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
            >
                <div
                    className="h-8 flex items-center justify-end px-2 cursor-grab active:cursor-grabbing select-none hover:bg-surface-100/50 transition-colors"
                    onMouseDown={handleMouseDown}
                >
                    <button
                        onClick={handleClose}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-surface-200 rounded-md transition-colors cursor-pointer text-(--ev-c-text-3) hover:text-red-500"
                        aria-label="Close Editor"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="flex-1 overflow-hidden">
                    <SkillEditor skillMdPath={activeSkillPath} />
                </div>
            </div>
        </div>
    );
}
