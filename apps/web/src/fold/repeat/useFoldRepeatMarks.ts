import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FoldOverlayInks } from '../canvas/foldPaneOverlays';
import type { FoldHit, FoldPaneId, FoldPickIndex } from '../canvas/foldPicking';
import type { SheetPoint } from '../document/foldSequenceDocument';
import { repeatOverlay, type FoldRepeatOverlay } from './repeatCanvas';
import type { FoldRepeatTool } from './useFoldRepeatTool';

/**
 * What Repeat draws over each pane while it is in hand — its axes, the one
 * taken and the one under the pointer, and a drawn line refused
 * (`repeatOverlay`) — and the pointer's hover, which previews the axis under
 * it (`hoverAxis`) until the pointer leaves it. Null marks while another tool
 * is in hand, or before the axes are found.
 */
export function useFoldRepeatMarks(
  index: FoldPickIndex | null,
  outline: readonly SheetPoint[] | null,
  repeat: FoldRepeatTool | null | undefined,
  inks: FoldOverlayInks | null
): {
  overlay: FoldRepeatOverlay | null;
  onFoldedHover: (hit: FoldHit | null) => void;
  onCreaseHover: (hit: FoldHit | null) => void;
} {
  const marks = repeat?.marks ?? null;
  // The marks are made anew each render: read through what they say.
  const marksKey = marks ? JSON.stringify(marks) : null;
  const overlay = useMemo(
    () => (marks && inks ? repeatOverlay(index, outline, marks.axes, marks.taken, marks.hovered, marks.refused, marks.drawn, inks) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marksKey, inks, index, outline]
  );
  // The hover's verb, read when the pointer moves: the handlers keep their identity across renders.
  const hoverAxis = useRef(repeat?.verbs.hoverAxis);
  useEffect(() => {
    hoverAxis.current = repeat?.verbs.hoverAxis;
  });
  // Each pane says what is under the pointer on it, the one it left saying nothing: the axis is the
  // one under the pointer on either pane, so a pane the pointer is not on never lets go of the other's.
  const under = useRef<Record<FoldPaneId, number | null>>({ folded: null, 'crease-pattern': null });
  const onHover = useCallback((pane: FoldPaneId, hit: FoldHit | null) => {
    under.current[pane] = hit?.repeatAxis ?? null;
    hoverAxis.current?.(under.current['crease-pattern'] ?? under.current.folded);
  }, []);
  const onFoldedHover = useCallback((hit: FoldHit | null) => onHover('folded', hit), [onHover]);
  const onCreaseHover = useCallback((hit: FoldHit | null) => onHover('crease-pattern', hit), [onHover]);
  return { overlay, onFoldedHover, onCreaseHover };
}
