import type { StoreApi } from 'zustand';
import { folded3dStoredSceneStyleKey } from '../../cp-workspace/folded/folded3dReproject';
import {
  queueFoldedModelWrite,
} from '../../cp-workspace/folded/foldedModelWriteQueue';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { effectivePaperStyle, type PaperStyle } from '../../lib/paper/paperStyle';
import { hexToRgbColor, rgbColorToHex } from '../../lib/rgbColor';
import { useSettingsStore } from '../settingsStore';
import type { WorkspaceState } from './types';

/**
 * Keeps every folded figure's kernel model colours in step with the paper
 * style it draws with.
 *
 * A figure's colours have one source: the app's display style with the
 * figure's own `appearance` pins on top. The kernel model's `front_color`,
 * `back_color` and `line_color` are a *derived mirror* of those three values
 * (D6 in `implementation-plans/unified-paper-style-and-export.md`), kept
 * because the flat figure's oracle-checked drawer, the 3D window, the
 * `.ori` round-trip and the `.osf` picture all read the model — so nothing
 * downstream has to know what a style is, and the model never has to be
 * inspected to know what is pinned.
 *
 * The mirror runs after any change to the display style or to the figures
 * list, and writes only what differs, through the same
 * `updateOristudioCpFoldedFigureModel` round trip a colour pick makes — as a
 * `mirror` write, so it selects nothing, dirties nothing and records no undo
 * entry of its own. It goes through the kernel write queue so a burst
 * coalesces and so a bracket committing an override edit waits for the
 * kernel's answer before it records.
 *
 * A figure without a handle (reopened from a file, not yet rehydrated) is
 * skipped: there is no kernel to write and its stored picture is kept as
 * saved. Rehydration hands it a handle, which changes the list, which runs
 * the mirror.
 *
 * One thing here is not a colour: a 3D figure's stored picture *bakes* the
 * light (`folded3dSceneStyleKey`), so a light change is a rebuild rather than a
 * mirror write, and this module is where the app's display style is watched —
 * see the settings subscription below.
 */

/** The model fields the mirror owns, and the style field each shows. */
const MIRRORED_COLORS = [
  ['front_color', (style: PaperStyle) => style.paper.front],
  ['back_color', (style: PaperStyle) => style.paper.back],
  ['line_color', (style: PaperStyle) => style.edges.color],
] as const;

/** The model a figure draws with, whichever kind it is; undefined mid-fold. */
function figureModel(
  figure: OristudioCpFoldedFigureEntry
): OristudioCpFoldedFigureModel | undefined {
  return figure.folded3d?.model ?? figure.snapshot?.model;
}

/**
 * The model patch that brings `figure`'s colours to its effective style, or
 * null when they already agree. Pure, so the decision is testable apart from
 * the round trip.
 */
export function foldedFigureModelMirror(
  figure: OristudioCpFoldedFigureEntry,
  display: PaperStyle
): Partial<OristudioCpFoldedFigureModel> | null {
  const model = figureModel(figure);
  if (!model) return null;
  const style = effectivePaperStyle(display, figure.appearance);
  const patch: Partial<OristudioCpFoldedFigureModel> = {};
  for (const [key, read] of MIRRORED_COLORS) {
    const hex = read(style);
    if (rgbColorToHex(model[key]) !== hex) patch[key] = hexToRgbColor(hex);
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * What a write was computed from: the handle it went to, the model colours it
 * found, and the patch. Two passes that compute the same key would issue the
 * same write to the same kernel for the same reason.
 */
function writeKey(figure: OristudioCpFoldedFigureEntry, patch: object): string | null {
  const model = figureModel(figure);
  if (!model) return null;
  return JSON.stringify([figure.handle, MIRRORED_COLORS.map(([key]) => model[key]), patch]);
}

/**
 * Subscribe the mirror to both stores. Runs once on install for figures that
 * are already there. Returns the unsubscribe.
 *
 * A pass asks each figure once per *entry*: the write it issued is remembered
 * with the entry object it was computed from, and the same entry wanting the
 * same write is not asked again. That is what keeps a pass that runs before
 * the kernel has answered — the list changes on every landing, and a 3D
 * figure's write lands synchronously, inside the pass that issued it — from
 * queueing the same write twice. Anything that could change the answer
 * replaces the entry: a landed write, an undo's reconcile after a superseded
 * one, a refold, a rehydrate. So the next pass over a new entry asks afresh,
 * and a different write for the same entry (a reset following a pin, a style
 * change mid-flight) is queued behind the one in flight.
 *
 * A write the kernel refuses leaves the entry marked `error`, and such a
 * figure is skipped outright until whatever repairs it puts a ready one in
 * the list. A write that fails any other way leaves the entry as it was, and
 * an unchanged entry is not asked again: that is the loop a refusal used to
 * start, and it ends here rather than at the drain.
 */
export function installFoldedFigurePaperMirror(store: StoreApi<WorkspaceState>): () => void {
  const asked = new Map<string, { entry: OristudioCpFoldedFigureEntry; key: string }>();
  const run = () => {
    const display = useSettingsStore.getState().paperStyle.display;
    const figures = store.getState().oristudioCpFoldedFigures;
    for (const id of asked.keys()) {
      if (!figures.some((figure) => figure.id === id)) asked.delete(id);
    }
    for (const figure of figures) {
      // Handle 0 is a valid wasm slot; only null/undefined means "no kernel".
      if (figure.handle == null) continue;
      if (figure.status === 'error') continue;
      const patch = foldedFigureModelMirror(figure, display);
      if (!patch) continue;
      const key = writeKey(figure, patch);
      if (key === null) continue;
      const last = asked.get(figure.id);
      if (last && last.entry === figure && last.key === key) continue;
      asked.set(figure.id, { entry: figure, key });
      queueFoldedModelWrite(figure.id, patch, { mirror: true });
    }
  };
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.paperStyle.display === previous.paperStyle.display) return;
    // The colours are a model field and reach a figure through the mirror. The
    // light is not: a 3D figure's picture bakes it into every face's shade, so
    // moving the light has to rebuild the picture or the canvas and the `.osf`
    // keep the shading the figure was last built at while its window follows
    // the light immediately. Guarded on the fields the scene actually bakes, so
    // a colour change stays what §11 says it is — a re-ink, never a rebuild.
    if (
      folded3dStoredSceneStyleKey(state.paperStyle.display) !==
      folded3dStoredSceneStyleKey(previous.paperStyle.display)
    ) {
      store.getState().refreshOristudioCpFolded3dScenes();
    }
    run();
  });
  // A mirror write that lands changes the list too, and finds nothing left
  // to write: the fixed point is the model agreeing with the style.
  const unsubscribeWorkspace = store.subscribe((state, previous) => {
    if (state.oristudioCpFoldedFigures !== previous.oristudioCpFoldedFigures) run();
  });
  run();
  return () => {
    unsubscribeSettings();
    unsubscribeWorkspace();
  };
}
