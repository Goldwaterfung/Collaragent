import React from 'react';

type LoadingIconProps = React.SVGProps<SVGSVGElement> & { isStreaming?: boolean };

export const LoadingIcon: React.FC<LoadingIconProps> = ({ isStreaming, className, ...rest }) => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 256 256"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className ? `${className} ${isStreaming ? 'streaming' : ''}` : (isStreaming ? 'streaming' : undefined)}
    {...rest}
  >
    <defs>
      <linearGradient id="tieGradient" x1="128" y1="80" x2="128" y2="240" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F5AFAF" />
        <stop offset="100%" stopColor="#E09090" />
      </linearGradient>
      
      <filter id="shadow3d">
        <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="#000000" floodOpacity="0.15" />
      </filter>
    </defs>

    {/* Animated Group */}
    <g filter="url(#shadow3d)">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="0 128 128; 720 128 128; 720 128 128"
        keyTimes="0; 0.8; 1"
        dur="2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.2 0.8 0.1 1; 0 0 1 1"
      />

      {/* Tie */}
      <path d="M 128 100 C 118 140, 95 195, 128 242 C 161 195, 138 140, 128 100 Z" fill="url(#tieGradient)" />

      {/* Knot */}
      <path d="M 128 135 L 155 105 L 128 80 L 101 105 L 128 135 Z" fill="#F5AFAF" stroke="#FFFFFF" strokeWidth={2} />

      {/* Collar */}
      <path d="M 128 80 L 101 105 L 24 60 C 24 60 80 40 128 80 Z" fill="#FCF8F8" />
      <path d="M 128 80 L 155 105 L 232 60 C 232 60 176 40 128 80 Z" fill="#FBEFEF" />
    </g>
  </svg>
);