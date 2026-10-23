import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { observeResizeDeferred } from '../components/ui/observeResizeDeferred';

interface FitState {
  /** The level set measured against; a change of it starts over. */
  levels: number;
  level: number;
  /** What each level needed when it was last laid out, in px. */
  needs: readonly (number | undefined)[];
}

/**
 * How far a one-row bar has to collapse to fit its width: level 0 shows
 * everything inline, and each level after it a little less, up to
 * `levels - 1`, the most the bar can give up. The bar decides what each level
 * moves into its menu; this only measures.
 *
 * Measured rather than a breakpoint, because what fits is the words' and the
 * neighbours': a German label is half as long again as an English one, and
 * the rails and panes beside a header take a width no media query knows.
 *
 * The row lays its parts out at their natural widths (its direct children;
 * a part that may shrink, such as a truncating label, is counted by its
 * `scrollWidth`), and the level goes down while they need more than the row's
 * content box. Each level's need is remembered when it is measured, so the
 * level goes back up only once the row has the width the level above it last
 * needed — a level is never tried just to find it does not fit, which on a
 * drag resize would flicker at every pixel. The measuring runs in a layout
 * effect, so a level that does not fit is never painted; later changes of size
 * come through a deferred `ResizeObserver` on the row and its parts.
 *
 * `levels` of 1 (or 0) turns it off: nothing is measured and the level is 0.
 * A change of `levels` starts over, since the levels then mean other things.
 */
export function useFitLevel(levels: number): {
  level: number;
  /** For the row whose direct children are its parts. */
  rowRef: (element: HTMLElement | null) => void;
} {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<FitState>({ levels, level: 0, needs: [] });
  // A new level set starts over, during render, so nothing is ever drawn at a
  // level the new set does not have.
  if (state.levels !== levels) setState({ levels, level: 0, needs: [] });
  const level = state.levels === levels ? state.level : 0;
  // The level the DOM was last committed at: a measurement is of that level,
  // and is dropped if the state has moved on since — two observers firing in
  // one frame would otherwise both measure the old row, the second crediting
  // its need to the level the first already moved to.
  const committed = useRef(0);

  const measure = useCallback(() => {
    if (!row || levels <= 1) return;
    const style = getComputedStyle(row);
    const available =
      row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    const parts = [...row.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null
    );
    const gap = parseFloat(style.columnGap) || 0;
    const need =
      parts.reduce((sum, part) => sum + Math.max(part.offsetWidth, part.scrollWidth), 0) +
      gap * Math.max(0, parts.length - 1);
    const at = committed.current;
    setState((current) => {
      if (current.levels !== levels || current.level !== at) return current;
      const needs = current.needs[at] === need ? current.needs : Object.assign([...current.needs], { [at]: need });
      if (need > available + 0.5 && at < levels - 1) return { levels, level: at + 1, needs };
      const above = needs[at - 1];
      if (at > 0 && above !== undefined && above <= available + 0.5) return { levels, level: at - 1, needs };
      return needs === current.needs ? current : { ...current, needs };
    });
  }, [row, levels]);

  // After every commit at a new level: laid out, measured, and moved on
  // before the browser paints it.
  useLayoutEffect(() => {
    committed.current = level;
    measure();
  }, [measure, level]);

  useLayoutEffect(() => {
    if (!row || levels <= 1 || typeof ResizeObserver === 'undefined') return;
    const stops = [row, ...row.children].map((element) => observeResizeDeferred(element, measure));
    return () => stops.forEach((stop) => stop());
  }, [row, levels, level, measure]);

  return { level: levels <= 1 ? 0 : level, rowRef: setRow };
}
