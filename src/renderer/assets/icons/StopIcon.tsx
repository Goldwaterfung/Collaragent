import React from 'react';

export const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
    </svg>
);
