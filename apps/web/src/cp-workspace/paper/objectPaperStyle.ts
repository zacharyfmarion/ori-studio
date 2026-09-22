import { useCallback, useMemo } from 'react';
import i18n from '../../i18n';
import {
  effectivePaperStyle,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
} from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldedFigureGesture } from '../folded/foldedFigureGesture';
import { inlineSimulationGesture } from '../inlineSimulation/inlineSimulationGesture';

/**
 * The paper style a document object draws with, and the verbs that change it.
 *
 * Every object that draws paper — a flat or 3D folded figure, an inline
 * simulation window — carries a sparse `appearance` of the style fields the
 * user pinned on it; everything else follows the app's display style. The one
 * merge is `effectivePaperStyle`; this module is where the display style comes
 * from for it, so no surface reads `settingsStore` for a style on its own.
 *
 * The override verbs are the discrete edits — a toggle, a reset, a picked
 * value — and each earns one undo entry through its layer's bracket, the way
 * every other discrete verb on those layers does (`runFoldedFigureAction`,
 * `'verb'`). A continuous control (a colour drag) keeps the bracketed gesture
 * protocol instead: `begin('pane:<field>')` on the layer's bracket, the raw
 * store action per tick, `commit` once — the store actions record nothing
 * themselves, exactly like `setOristudioCpFoldedFigurePlacement` and
 * `updateOristudioCpInlineSimulation`.
 */

/** Anything with an `appearance`: a folded figure entry or an inline simulation. */
export interface PaperObject {
  appearance?: PaperStyleOverrides;
}

/** One field to pin, or to clear with `undefined`. */
export type PaperStyleOverrideEdit = {
  [F in PaperStyleField]: { field: F; value: PaperStyleValue<F> | undefined };
}[PaperStyleField];

/** The display style with `entry`'s overrides on top. */
export function effectiveObjectPaperStyle(
  entry: PaperObject,
  display: PaperStyle = useSettingsStore.getState().paperStyle.display
): PaperStyle {
  return effectivePaperStyle(display, entry.appearance);
}

/** {@link effectiveObjectPaperStyle}, live: re-renders when the display style or the overrides move. */
export function useObjectPaperStyle(entry: PaperObject): PaperStyle {
  const display = useSettingsStore((state) => state.paperStyle.display);
  const overrides = entry.appearance;
  return useMemo(() => effectivePaperStyle(display, overrides), [display, overrides]);
}

/**
 * Each object's effective edge pen width in pt, live on the display style.
 *
 * The crease-pattern canvas draws every folded figure's strokes through one
 * channel whose base width is device px per pt; this is the per-figure
 * multiplier that makes a figure pinning its own pen draw at that pen beside
 * one following the app style. A function of the entry rather than a value,
 * so the canvas can hand it to `cpFoldedToScene` for every figure it draws.
 */
export function useObjectEdgePenWidth(): (entry: PaperObject) => number {
  const display = useSettingsStore((state) => state.paperStyle.display);
  return useCallback(
    (entry: PaperObject) => effectivePaperStyle(display, entry.appearance).edges.width,
    [display]
  );
}

/** The undo label: which way the edit went is the whole of what a reader needs. */
function overrideLabel(reset: boolean): string {
  return reset
    ? i18n.t('panels:cpProperties.paperStyle.resetAction', 'Reset paper style')
    : i18n.t('panels:cpProperties.paperStyle.changeAction', 'Change paper style');
}

/**
 * Pin one field on a folded figure, or clear it with `undefined` so the figure
 * follows the app style again. One undo entry; resolves `false` when the
 * layer's bracket is held by a gesture in progress.
 */
export async function setFoldedFigureAppearance<F extends PaperStyleField>(
  id: string,
  field: F,
  value: PaperStyleValue<F> | undefined
): Promise<boolean> {
  return setFoldedFigureAppearances(id, [{ field, value } as PaperStyleOverrideEdit]);
}

/**
 * Several fields of a folded figure as one entry — a reset that clears more
 * than one pin. A reset is an edit whose every value is `undefined`.
 */
export async function setFoldedFigureAppearances(
  id: string,
  edits: readonly PaperStyleOverrideEdit[]
): Promise<boolean> {
  const reset = edits.every((edit) => edit.value === undefined);
  const done = await foldedFigureGesture.run('verb', overrideLabel(reset), () =>
    edits.every((edit) =>
      useWorkspaceStore.getState().setOristudioCpFoldedFigureAppearance(id, edit.field, edit.value)
    )
  );
  return done === true;
}

/** {@link setFoldedFigureAppearance}'s twin for an inline simulation window. */
export async function setInlineSimulationAppearance<F extends PaperStyleField>(
  id: string,
  field: F,
  value: PaperStyleValue<F> | undefined
): Promise<boolean> {
  return setInlineSimulationAppearances(id, [{ field, value } as PaperStyleOverrideEdit]);
}

/**
 * Several fields of an inline simulation window as one entry — the crease
 * style switch writes the mountain and valley pens together, and its reset
 * clears them together. A reset is an edit whose every value is `undefined`.
 */
export async function setInlineSimulationAppearances(
  id: string,
  edits: readonly PaperStyleOverrideEdit[]
): Promise<boolean> {
  const reset = edits.every((edit) => edit.value === undefined);
  const done = await inlineSimulationGesture.run('verb', overrideLabel(reset), () =>
    edits.every((edit) =>
      useWorkspaceStore
        .getState()
        .setOristudioCpInlineSimulationAppearance(id, edit.field, edit.value)
    )
  );
  return done === true;
}
