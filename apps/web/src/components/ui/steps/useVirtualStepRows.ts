import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';

/**
 * Rows of the responsive Steps grid. CSS owns column widths and gaps; the
 * virtualizer measures actual row heights (including wrapped instructions).
 * Only its initial estimate assumes a square picture plus header and caption.
 *
 * The row holding entry `kept` (the grid's tab stop: the selection, or the
 * first entry) stays mounted wherever the grid is scrolled, so focus, the
 * keyboard context menu and the roving tab stop always find its card.
 *
 * `measured` is false until the grid's columns have been read once. Before
 * then the layout is a guess of one column, so a row index is an entry index:
 * nothing should scroll to a row until it is true.
 */
export function useVirtualStepRows(grid: RefObject<HTMLDivElement | null>, ids: readonly string[], kept = -1) {
  const [layout, setLayout] = useState({ columns: 1, estimate: 300, margin: 0, measured: false });
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const css = getComputedStyle(element);
      const widths = css.gridTemplateColumns.split(' ').map(Number.parseFloat).filter(Number.isFinite);
      // No tracks to read (no layout, as in jsdom): one column is the answer.
      if (!widths.length) {
        setLayout((old) => (old.measured ? old : { ...old, measured: true }));
        return;
      }
      const parent = element.parentElement!;
      const margin =
        element.getBoundingClientRect().top -
        parent.getBoundingClientRect().top +
        parent.scrollTop -
        parent.clientTop +
        Number.parseFloat(css.paddingTop || '0');
      const next = { columns: widths.length, estimate: widths[0]! + 88, margin, measured: true };
      setLayout((old) =>
        old.measured &&
        old.columns === next.columns &&
        old.estimate === next.estimate &&
        old.margin === next.margin
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
  const keptRow = kept >= 0 ? Math.floor(kept / layout.columns) : -1;
  const rangeExtractor = useCallback(
    (range: Range) => {
      const rows = defaultRangeExtractor(range);
      if (keptRow < 0 || keptRow >= range.count || rows.includes(keptRow)) return rows;
      return [...rows, keptRow].sort((a, b) => a - b);
    },
    [keptRow]
  );
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: Math.ceil(ids.length / layout.columns),
    getScrollElement,
    getItemKey: (row) => ids[row * layout.columns]!,
    estimateSize: () => layout.estimate,
    scrollMargin: layout.margin,
    overscan: 2,
    rangeExtractor,
    // Let React yield while mounting a new row instead of blocking the scroll event.
    useFlushSync: false,
    useAnimationFrameWithResizeObserver: true,
    initialRect: { width: 0, height: 600 },
  });
  useLayoutEffect(() => {
    virtualizer.measure();
    // measure() forgets every measured height. A row that stays mounted is only
    // measured again when it resizes, which has already happened by now, so it
    // would sit at the estimate and overlap the next row: measure them again.
    // Recompute the positions first: a row is only stored when its size differs
    // from the last computed one, which is still its measured size until then.
    virtualizer.getVirtualItems();
    grid.current
      ?.querySelectorAll<HTMLElement>('[data-index]')
      .forEach((row) => virtualizer.measureElement(row));
  }, [virtualizer, layout.columns, layout.estimate, grid]);
  return { columns: layout.columns, margin: layout.margin, measured: layout.measured, virtualizer };
}
