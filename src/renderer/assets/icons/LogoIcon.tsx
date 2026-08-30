import React from 'react';

type Props = React.SVGProps<SVGSVGElement> & { size?: number | string };

export const LogoIcon: React.FC<Props> = ({ size = 512, width = size, height = size, ...props }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 256 256"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <defs>
      <linearGradient id="tieGradient" x1="128" y1="80" x2="128" y2="240" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F5AFAF" />
        <stop offset="100%" stopColor="#E09090" />
      </linearGradient>
      
      <linearGradient id="creaseGradient" x1="128" y1="135" x2="128" y2="240" gradientUnits="userSpaceOnUse">
         <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
         <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.1} />
      </linearGradient>

      <filter id="shadow3d">
          <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="#000000" floodOpacity={0.15} />
      </filter>
    </defs>

    <g filter="url(#shadow3d)">

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

export default LogoIcon;