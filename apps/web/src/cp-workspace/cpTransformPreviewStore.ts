import { useSyncExternalStore } from 'react';
import type { CpTransformPreview } from './adapters/cpSnapshotToScene';

/**
 * The transform the surface is currently drawing the selected creases *through*,
 * published for the DOM overlays that place content from the same creases'
 * committed model coordinates.
 *
 * The GPU strokes and the DOM badges are drawn from one document but by two
 * mechanisms, and a live transform only ever reached one of them. `buildStrokes`
 * takes the matrix as an argument from inside the canvas's imperative pointer
 * handlers — deliberately, because it changes per pointer sample and lifting it
 * to React state would re-render the panel at that rate — so while a gesture was
 * in flight the strokes followed the cursor and every fold-angle number stayed at
 * the coordinates the document still held.
 *
 * Sibling of {@link cpOverlayViewStore}, and for the same reason: a channel from
 * the canvas to the small overlay components that does not pass through the
 * panel. The two carry the two halves of "where is this crease on screen right
 * now" — that one the camera, this one the pending edit — and an overlay that
 * reads only the camera is placing content at coordinates the surface has
 * stopped drawing.
 *
 * Publishing it rather than passing it as a prop is what makes it a fact about
 * the *surface* instead of about one layer. Only {@link CpFoldAngleLayer} needs
 * it today: the transform is keyed on 1-based **line** ids, and of the three
 * layers in that band it is the only one drawing anything keyed on a line id.
 * Measurements anchor to picked model points and text boxes to their own
 * centres, so a crease transform does not move them — before or after it commits.
 *
 * `null` means the strokes are at their stored coordinates. That is the same
 * fact for both surfaces, so it is published from the places that put the
 * document's own geometry back into the buffers — including the upload effect
 * that runs once a commit lands, rather than at the commit itself, so the number
 * never snaps back to where the crease used to be before jumping to where it now
 * is.
 */

let current: CpTransformPreview | null = null;
const listeners = new Set<() => void>();

export const cpTransformPreviewStore = {
  get(): CpTransformPreview | null {
    return current;
  },
  set(preview: CpTransformPreview | null): void {
    // Identity guard, which in practice only ever elides a repeated `null`: a
    // gesture builds a fresh `{ids, matrix}` per sample, and the clears fire from
    // several unrelated paths (a cancel, a tool reset, every stroke upload).
    if (current === preview) return;
    current = preview;
    for (const listener of listeners) listener();
  },
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
};

/**
 * Subscribe to the live transform; re-renders the caller on every publication,
 * which during a gesture is every pointer sample.
 *
 * Unlike a pan there is no factoring to hide behind — see
 * {@link usePannedOverlayView}, which reproduces a camera translation with one
 * transform on the container. A four-point transform is a similarity, so the
 * badges move *relative to each other* and their text must not turn or scale
 * with them; the re-layout is the work, not an artefact of doing it in React.
 */
export function useCpTransformPreview(): CpTransformPreview | null {
  return useSyncExternalStore(cpTransformPreviewStore.subscribe, cpTransformPreviewStore.get, () => null);
}
