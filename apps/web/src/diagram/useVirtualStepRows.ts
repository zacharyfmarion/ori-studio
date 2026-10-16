import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Rows of the responsive Steps grid. CSS owns column widths and gaps; the
 * virtualizer measures actual row heights (including wrapped instructions).
 * Only its initial estimate assumes a square picture plus header and caption.
 */
export function useVirtualStepRows(grid: RefObject<HTMLDivElement | null>, ids: readonly string[]) {
  const [layout, setLayout] = useState({ columns: 1, estimate: 300, margin: 0 });
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const css = getComputedStyle(element);
      const widths = css.gridTemplateColumns.split(' ').map(Number.parseFloat).filter(Number.isFinite);
      if (!widths.length) return;
      const parent = element.parentElement!;
      const margin =
        element.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop -
        parent.clientTop +
        Number.parseFloat(css.paddingTop || '0');
      const next = { columns: widths.length, estimate: widths[0]! + 88, margin };
      setLayout((old) =>
        old.columns === next.columns && old.estimate === next.estimate && old.margin === next.margin
          ? old
          : next
      );
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [grid]);
  // The grid lives directly in the panel's scrolling body. Scrolling and
  // measurements belong to TanStack, including variable-height corrections.
  const getScrollElement = useCallback(() => grid.current?.parentElement ?? null, [grid]);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: Math.ceil(ids.length / layout.columns),
    getScrollElement,
    getItemKey: (row) => ids[row * layout.columns]!,
    estimateSize: () => layout.estimate,
    scrollMargin: layout.margin,
    overscan: 2,
    // Let React yield while mounting a new row instead of blocking the scroll event.
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
    initialRect: { width: 0, height: 600 },
  });
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, layout.columns, layout.estimate]);
  return { columns: layout.columns, margin: layout.margin, virtualizer };
}
