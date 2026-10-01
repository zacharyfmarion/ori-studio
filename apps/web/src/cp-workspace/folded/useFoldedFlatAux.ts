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
import { askForAuxLines, NO_FOLDED_AUX_SOURCE, type FoldedAuxSource } from './foldedAuxSource';
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
  foldedFlatSceneAuxKey,
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
 * kernel snapshot, the document's aux lines), the first time a figure wants it
 * and not before: the scene is a face-and-stack description of the whole
 * figure, and most figures never turn the toggle on. Held in
 * `foldedFlatScenes.ts` against the handle, so it goes when the session does.
 *
 * The aux lines are the document's as they stand now, not as they stood at
 * the fold: nothing folds an aux line, so drawing one on the crease pattern
 * shows on every figure without a refold (`foldedAuxSource.ts`). A scene a fetch
 * behind keeps drawing until the next one lands.
 *
 * A failed fetch is asked again twice, a little later each time, and reported
 * when it still fails: the picture is the drawer's either way, and it is the
 * overlay that would otherwise go missing without a word.
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
  figures: readonly OristudioCpFoldedFigureEntry[],
  /** The document the figures are folded from, whose aux lines they show. */
  source: FoldedAuxSource = NO_FOLDED_AUX_SOURCE
): (figure: OristudioCpFoldedFigureEntry) => FoldedFigureAuxStrokes | null {
  const display = useSettingsStore((state) => state.paperStyle.display);
  const table = useSyncExternalStore(subscribeFoldedFlatScenes, foldedFlatScenes, foldedFlatScenes);
  const { documentHandle, auxKey } = source;

  const wanting = useMemo(
    () => figures.filter((figure) => auxStyleOf(figure, display).auxCreases.visible),
    [figures, display]
  );

  useEffect(() => {
    for (const figure of wanting) {
      if (!fetchable(figure)) continue;
      if (foldedFlatSceneAuxKey(figure.handle, figure.snapshot) === auxKey) continue;
      void fetchScene({
        handle: figure.handle,
        snapshot: figure.snapshot,
        auxKey,
        documentHandle,
      });
    }
  }, [wanting, auxKey, documentHandle]);

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

/** What one fetch asks for: a figure's scene under the document's aux lines. */
interface SceneRequest {
  handle: number;
  snapshot: OristudioCpFoldedFigureSnapshot;
  auxKey: string;
  documentHandle: number | null;
}

/**
 * The latest request per handle. One wait serves every render asking the
 * same thing, and a request something newer has replaced lands nothing.
 */
const latest = new Map<number, SceneRequest>();

const sameRequest = (a: SceneRequest | undefined, b: SceneRequest): boolean =>
  a?.snapshot === b.snapshot && a.auxKey === b.auxKey && a.documentHandle === b.documentHandle;

/**
 * Fetch the handle's scene for `request` into the runtime map, which tells
 * its subscribers. A handle freed, a document replaced, or a newer request
 * while the kernel was answering leaves nothing behind.
 */
async function fetchScene(request: SceneRequest): Promise<void> {
  if (sameRequest(latest.get(request.handle), request)) return;
  latest.set(request.handle, request);
  const { handle } = request;
  const epoch = foldedFigureHandleEpoch();
  const wanted = () =>
    latest.get(handle) === request &&
    foldedFigureHandleEpoch() === epoch &&
    foldedFigureHandleRefCount(handle) > 0;
  const scene = await askForAuxLines(
    () => getOristudioCpFoldedFigurePaperScene(handle, request.documentHandle),
    wanted,
    'folded-flat-aux'
  );
  if (scene && wanted()) setFoldedFlatScene(handle, request.snapshot, scene, request.auxKey);
  if (latest.get(handle) === request) latest.delete(handle);
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
  latest.clear();
}
