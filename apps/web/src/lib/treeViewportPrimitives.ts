import type { ViewportSize } from './designViewport';

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function viewportRectToViewBox(rect: ViewportRect): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

export function formatViewportZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function isTreeViewportKeyboardActivation(event: { key: string }): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

export function viewportSizeFromElement(viewport: HTMLElement | SVGElement | null): ViewportSize | null {
  if (!viewport) return null;
  return {
    width: viewport.clientWidth || viewport.getBoundingClientRect().width,
    height: viewport.clientHeight || viewport.getBoundingClientRect().height,
  };
}
