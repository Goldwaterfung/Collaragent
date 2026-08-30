import type { Point, ViewportState } from './types';

export const screenToWorld = (point: Point, viewport: ViewportState): Point => {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
};

export const worldToScreen = (point: Point, viewport: ViewportState): Point => {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
};
