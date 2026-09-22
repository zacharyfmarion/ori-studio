import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { effectivePaperStyle, type PaperStyle } from '../../lib/paper/paperStyle';
import {
  hexToUnitRgb,
  PAPER_STYLE_POLICIES,
  surfacePaperStyle,
} from '../../lib/paper/paperStyleResolve';
import { useSettingsStore } from '../../store/settingsStore';
import { getOristudioCpFoldedFigurePaperScene } from '../../store/workspaceStore/oristudioCpRuntime';
import type { FoldedFigureAuxStrokes } from '../adapters/cpFoldedToScene';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedFigureHandleEpoch, foldedFigureHandleRefCount } from './foldedFigureHandles';
import {
  foldedFlatAuxCoverage,
  foldedFlatAuxSegments,
  type FoldedFlatAuxCoverage,
  type FoldedFlatAuxSegment,
} from './foldedFlatAux';
import {
  foldedFlatScene,
  foldedFlatScenes,
  setFoldedFlatScene,
  subscribeFoldedFlatScenes,
} from './foldedFlatScenes';

/**
 * The flat figures' aux creases, for the canvas to draw over their fills.
 *
 * A flat figure shows the document's aux (`Cyan3`) lines carried through the
 * fold when its effective `auxCreases.visible` is on — the display style with
 * the figure's own pins on top, through the `folded-flat` policy. The lines
 * come from the kernel's paper scene, which is fetched here, once per (handle,
 * kernel snapshot), the first time a figure wants it and not before: the
 * scene is a face-and-stack description of the whole figure, and most figures
 * never turn the toggle on. Held in `foldedFlatScenes.ts` against the handle,
 * so it goes when the session does.
 *
 * One hook rather than a fetch beside each of the store's fold completions:
 * whether a figure wants its scene is a function of the display style and its
 * appearance, which those completions do not read, and the cases that need
 * a fetch — a fold, a refold, another solution, a side flip, a rehydrate, the
 * toggle turned on later, a style change that turns it on for every figure —
 * are all "this figure now wants a scene it does not have", which is one
 * question asked here against the kernel snapshot's identity. A completion
 * that only re-renders the picture (a selection marker, a display style)
 * keeps the snapshot and therefore the scene.
 *
 * Returns the per-figure reader `cpFoldedToScene` takes. It is stable across
 * drags — the pieces are cut once per scene and erode — and changes when a
 * fetch lands or the display style moves.
 */
export function useFoldedFlatAux(
  figures: readonly OristudioCpFoldedFigureEntry[]
): (figure: OristudioCpFoldedFigureEntry) => FoldedFigureAuxStrokes | null {
  const display = useSettingsStore((state) => state.paperStyle.display);
  const table = useSyncExternalStore(subscribeFoldedFlatScenes, foldedFlatScenes, foldedFlatScenes);

  const wanting = useMemo(
    () => figures.filter((figure) => auxStyleOf(figure, display).auxCreases.visible),
    [figures, display]
  );

  useEffect(() => {
    for (const figure of wanting) {
      if (!fetchable(figure) || foldedFlatScene(figure.handle, figure.snapshot)) continue;
      void fetchScene(figure.handle, figure.snapshot);
    }
  }, [wanting]);

  return useCallback(
    (figure: OristudioCpFoldedFigureEntry): FoldedFigureAuxStrokes | null => {
      const style = auxStyleOf(figure, display);
      if (!style.auxCreases.visible || !fetchable(figure)) return null;
      const scene = foldedFlatScene(figure.handle, figure.snapshot, table);
      if (!scene) return null;
      const pen = style.auxCreases.pen;
      const [r, g, b] = hexToUnitRgb(pen.color);
      return {
        segments: segmentsOf(scene, style.erode, foldedFlatAuxCoverage(figure.displayStyle)),
        color: [r, g, b, 1],
        widthMul: pen.width,
      };
    },
    [display, table]
  );
}

/** The figure's effective style as the flat surface sees it. */
function auxStyleOf(figure: OristudioCpFoldedFigureEntry, display: PaperStyle): PaperStyle {
  return surfacePaperStyle(
    effectivePaperStyle(display, figure.appearance),
    PAPER_STYLE_POLICIES['folded-flat']
  );
}

/** A live flat figure the kernel can answer for: a handle and a snapshot. */
function fetchable(
  figure: OristudioCpFoldedFigureEntry
): figure is OristudioCpFoldedFigureEntry & {
  handle: number;
  snapshot: OristudioCpFoldedFigureSnapshot;
} {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  return figure.handle != null && figure.snapshot !== null && !isFolded3dFigure(figure);
}

/** The snapshot a handle's fetch is in flight for, so one wait serves every render. */
const inFlight = new Map<number, OristudioCpFoldedFigureSnapshot>();

/**
 * Fetch the handle's scene for `snapshot` into the runtime map, which tells
 * its subscribers. A handle freed or a document replaced while the kernel was
 * answering leaves nothing behind.
 */
async function fetchScene(
  handle: number,
  snapshot: OristudioCpFoldedFigureSnapshot
): Promise<void> {
  if (inFlight.get(handle) === snapshot) return;
  inFlight.set(handle, snapshot);
  const epoch = foldedFigureHandleEpoch();
  try {
    const scene = await getOristudioCpFoldedFigurePaperScene(handle);
    if (!scene || foldedFigureHandleEpoch() !== epoch || foldedFigureHandleRefCount(handle) === 0) {
      return;
    }
    setFoldedFlatScene(handle, snapshot, scene);
  } catch {
    // The picture is the drawer's regardless; the overlay is what is missing,
    // and the next figure change asks again.
  } finally {
    if (inFlight.get(handle) === snapshot) inFlight.delete(handle);
  }
}

/**
 * The pieces per scene, erode and coverage, cut once: the reader runs inside
 * the canvas's geometry memo on every frame of a drag.
 */
const segmentsCache = new WeakMap<
  OristudioCpFoldedPaperScene,
  { erode: number; coverage: FoldedFlatAuxCoverage; segments: FoldedFlatAuxSegment[] }
>();

function segmentsOf(
  scene: OristudioCpFoldedPaperScene,
  erode: number,
  coverage: FoldedFlatAuxCoverage
): FoldedFlatAuxSegment[] {
  const cached = segmentsCache.get(scene);
  if (cached && cached.erode === erode && cached.coverage === coverage) return cached.segments;
  const segments = foldedFlatAuxSegments(scene, erode, coverage);
  segmentsCache.set(scene, { erode, coverage, segments });
  return segments;
}

/** Forget every fetch in flight. For test isolation. */
export function resetFoldedFlatAuxFetches(): void {
  inFlight.clear();
}
