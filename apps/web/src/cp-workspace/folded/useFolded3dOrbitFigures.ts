import { useMemo, useSyncExternalStore } from 'react';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { folded3dOrbitFrames, subscribeFolded3dOrbit } from './folded3dRuntime';

/**
 * The figures as they should be **drawn**: the store's entries, with any figure
 * currently being turned swapped for its live orbit frame.
 *
 * Subscribed here rather than in the panel on purpose. A drag publishes to
 * `folded3dRuntime` instead of the store precisely so the panel's
 * document-derived memos (`staleFoldedFigureIds`, the transformable objects, the
 * canvas-object list) keep their identity; waking the panel to deliver the frame
 * would give all of that back. The canvas is the only surface that needs the
 * live picture — a folded figure's chrome is anchored to its *frame*, which is
 * fixed at fold time and does not move when the model turns.
 *
 * Returns the input array unchanged when nothing is being turned, so the
 * downstream geometry memo is not invalidated by a subscription that fired for
 * some other figure.
 */
export function useFolded3dOrbitFigures(
  figures: readonly OristudioCpFoldedFigureEntry[]
): readonly OristudioCpFoldedFigureEntry[] {
  const frames = useSyncExternalStore(
    subscribeFolded3dOrbit,
    folded3dOrbitFrames,
    folded3dOrbitFrames
  );
  return useMemo(() => {
    if (frames.size === 0) return figures;
    let turned = false;
    const next = figures.map((figure) => {
      const frame = frames.get(figure.id);
      if (!frame) return figure;
      turned = true;
      return {
        ...figure,
        camera: frame.camera,
        // A figure with no render model cannot be re-projected; it keeps the
        // picture it was saved with, exactly as the store path leaves it.
        renderSnapshot: frame.snapshot ?? figure.renderSnapshot,
      };
    });
    return turned ? next : figures;
  }, [figures, frames]);
}
