import React from 'react';

export const CanvasIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
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
        <circle cx="12" cy="5" r="3"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="6" y1="16" x2="6" y2="12"></line>
        <line x1="18" y1="16" x2="18" y2="12"></line>
        <line x1="6" y1="12" x2="18" y2="12"></line>
        <circle cx="6" cy="19" r="3"></circle>
        <circle cx="18" cy="19" r="3"></circle>
    </svg>
);
