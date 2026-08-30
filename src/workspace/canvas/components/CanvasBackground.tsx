import React from 'react';
import type { ViewportState } from '../types';

interface CanvasBackgroundProps {
  viewport: ViewportState;
  gridSize?: number;
  dotSize?: number;
  className?: string;
}

/**
 * CanvasBackground renders a delicate, low-contrast dot matrix grid.
 * It uses wider spacing and high transparency so it stays subtle and non-distracting.
 */
export const CanvasBackground: React.FC<CanvasBackgroundProps> = ({
  viewport,
  gridSize = 36,
  dotSize = 1,
  className = '',
}) => {
  const scaledGridSize = gridSize * viewport.zoom;
  const offsetX = ((viewport.x % scaledGridSize) + scaledGridSize) % scaledGridSize;
  const offsetY = ((viewport.y % scaledGridSize) + scaledGridSize) % scaledGridSize;

  // Keep dots very subtle and small across zoom levels
  const scaledDotSize = Math.max(0.75, Math.min(1.5, dotSize * Math.sqrt(viewport.zoom)));

  return (
    <svg
      className={`canvas-background absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="canvas-dot-grid"
          x={offsetX}
          y={offsetY}
          width={scaledGridSize}
          height={scaledGridSize}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={scaledGridSize / 2}
            cy={scaledGridSize / 2}
            r={scaledDotSize}
            className="fill-neutral-400 dark:fill-neutral-600"
            opacity={0.22}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-dot-grid)" />
    </svg>
  );
};
