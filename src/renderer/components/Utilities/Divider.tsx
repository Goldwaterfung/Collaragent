import { useEffect, useState } from 'react';

interface DividerProps {
    onResize: (clientX: number) => void;
    className?: string;
}

export function Divider({ onResize, className }: DividerProps): React.JSX.Element {
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (event: MouseEvent): void => {
            event.preventDefault();
            onResize(event.clientX);
        };

        const handleMouseUp = (): void => {
            setIsDragging(false);
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            // Ensure styles are reset if component unmounts while dragging
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };
    }, [isDragging, onResize]);

    const handleMouseDown = (e: React.MouseEvent): void => {
        e.preventDefault();
        setIsDragging(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    return (
        <div
            role="separator"
            className={`w-1 hover:w-1.5 cursor-col-resize flex justify-center items-center group transition-all duration-150 z-10 ${isDragging ? 'bg-primary w-1.5' : 'hover:bg-primary/10 bg-transparent'
                } ${className}`}
            onMouseDown={handleMouseDown}
        >
            {/* Visual indicator line */}
            <div
                className={`w-px h-full transition-colors duration-150 ${isDragging ? 'bg-primary' : 'bg-surface-200 group-hover:bg-primary'
                    }`}
            />
        </div>
    );
}
