import React from 'react';
import { NODE_HEADER_HEIGHT } from './nodeLayout';

interface NodeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
    selected?: boolean;
    children?: React.ReactNode;
}

export const NodeHeader: React.FC<NodeHeaderProps> = ({
    selected = false,
    children,
    style,
    className = '',
    ...props
}) => {
    return (
        <div
            style={{
                height: NODE_HEADER_HEIGHT,
                ...style,
            }}
            className={`w-full flex items-center justify-between px-3 cursor-grab select-none transition-colors border-b ${
                selected
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-900 dark:text-blue-200'
                    : 'bg-neutral-50 dark:bg-neutral-800/70 border-neutral-200 dark:border-neutral-700/80 text-neutral-700 dark:text-neutral-300'
            } ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};
