import React from 'react';

export const HistoryIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        {/* Clock face - complete circle */}
        <circle cx="12" cy="12" r="9" />

        {/* Clock hands - more balanced L-shape */}
        <path d="M12 7v5l3.5 3.5" />
    </svg>
);