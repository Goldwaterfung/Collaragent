import React from 'react';

interface HandleProps extends React.HTMLAttributes<HTMLDivElement> {
    color?: string;
    shape?: 'circle' | 'square';
    size?: number;
    cursor?: string;
}

export const Handle: React.FC<HandleProps> = ({
    color = '#1890ff',
    shape = 'circle',
    size = 12,
    cursor = 'pointer',
    style,
    ...props
}) => {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: shape === 'circle' ? '50%' : '2px',
                backgroundColor: color,
                cursor,
                ...style,
            }}
            {...props}
        />
    );
};
