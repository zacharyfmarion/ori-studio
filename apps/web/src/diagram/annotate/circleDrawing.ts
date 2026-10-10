/** How a circular annotation is drawn. A preference, never a saved mark property. */
export type CircleDrawingMode = 'bounds' | 'center';

export function circleDrawingMode(value: unknown): CircleDrawingMode {
  return value === 'center' ? 'center' : 'bounds';
}
