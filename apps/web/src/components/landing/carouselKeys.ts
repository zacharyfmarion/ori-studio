/**
 * Where a key press moves the selection in a carousel, or `null` when the key
 * is not one the carousel handles.
 *
 * Both arrow axes move it. The landing page has two carousels whose controls sit
 * on different axes — a column beside the Edit panel, a row above the Design
 * track — and a reader should not have to work out which arrows a given one
 * wants. Wrapping is deliberate: with three or four slides, refusing to move at
 * the end is a dead key press for no benefit.
 *
 * A pure function rather than a hook so both carousels can share it without
 * sharing any of their very different layout, and so the mapping can be tested
 * without rendering either.
 */
export function carouselKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
