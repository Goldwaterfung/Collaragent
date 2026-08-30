import React from 'react';

type ResizePosition = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
    position: ResizePosition;
    thickness?: number;
    length?: number | string;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
    position,
    thickness = 8,
    length = '100%',
    style,
    ...props
}) => {
    const isCorner = ['se', 'sw', 'ne', 'nw'].includes(position);
    const cornerSize = 10;

    const getStyle = (): React.CSSProperties => {
        const base: React.CSSProperties = {
            position: 'absolute',
            zIndex: isCorner ? 20 : 15,
        };

        switch (position) {
            case 'e':
                return {
                    ...base,
                    top: 0,
                    right: -thickness / 2,
                    width: thickness,
                    height: length,
                    cursor: 'ew-resize',
                };
            case 'w':
                return {
                    ...base,
                    top: 0,
                    left: -thickness / 2,
                    width: thickness,
                    height: length,
                    cursor: 'ew-resize',
                };
            case 's':
                return {
                    ...base,
                    bottom: -thickness / 2,
                    left: 0,
                    width: length,
                    height: thickness,
                    cursor: 'ns-resize',
                };
            case 'n':
                return {
                    ...base,
                    top: -thickness / 2,
                    left: 0,
                    width: length,
                    height: thickness,
                    cursor: 'ns-resize',
                };
            case 'se':
                return {
                    ...base,
                    bottom: -cornerSize / 2,
                    right: -cornerSize / 2,
                    width: cornerSize,
                    height: cornerSize,
                    cursor: 'nwse-resize',
                };
            case 'sw':
                return {
                    ...base,
                    bottom: -cornerSize / 2,
                    left: -cornerSize / 2,
                    width: cornerSize,
                    height: cornerSize,
                    cursor: 'nesw-resize',
                };
            case 'ne':
                return {
                    ...base,
                    top: -cornerSize / 2,
                    right: -cornerSize / 2,
                    width: cornerSize,
                    height: cornerSize,
                    cursor: 'nesw-resize',
                };
            case 'nw':
                return {
                    ...base,
                    top: -cornerSize / 2,
                    left: -cornerSize / 2,
                    width: cornerSize,
                    height: cornerSize,
                    cursor: 'nwse-resize',
                };
            default:
                return base;
        }
    };

    return (
        <div
            style={{ ...getStyle(), ...style }}
            className={isCorner ? 'bg-blue-500 dark:bg-blue-400 border-2 border-white dark:border-neutral-900 rounded-sm shadow-xs hover:scale-125 transition-transform' : 'hover:bg-blue-400/20 transition-colors'}
            {...props}
        />
    );
};
