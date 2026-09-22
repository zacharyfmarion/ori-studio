/**
 * Making a 3D folded figure's picture — the one place that does it.
 *
 * `folded_figure_render_snapshot` takes `CpSession::flat(handle)` and answers
 * `folded_figure_kind_mismatch` on a spatial one, by design: the kernel emits a
 * view-independent render model and the choice of viewpoint, colour and
 * occlusion is the frontend's. So every place the flat path asks the worker for
 * a snapshot, the 3D path calls this instead — synchronously, since it is a pure
 * function of data already in memory.
 *
 * Extracted from `creasePatternSlice` because the orbit gesture now needs the
 * same picture outside the store: the live camera is published to
 * `folded3dRuntime` per pointer move and the store is written once on release,
 * so both sides have to produce the *same* picture or the figure would jump when
 * the drag ends. Two copies of this is the drift risk that costs a visible
 * flicker; one module is the fix.
 *
 * What it produces is a {@link PaperScene} — the window's own picture, through
 * `folded3dFigureScene`. That is D5: the CPU projector this replaced was a
 * second builder of the same geometry with its own cull, merge and camera, and
 * a figure is now drawn, stored and exported from one. The ink is not in the picture: the style the figure follows is resolved
 * here so that the scene is built at the light the window uses, and the canvas
 * and the painter ink the same scene from the same style afterwards.
 */

import type { PaperScene } from '@treemaker/origami-simulator';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';
import {
  effectivePaperStyle,
  type PaperStyle,
  type PaperStyleOverrides,
} from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { defaultFolded3dCamera, type FoldedFigureCamera } from './folded3dCamera';
import { folded3dRenderModel } from './folded3dRenderModels';
import { folded3dSceneStyleKey } from './folded3dScene';
import { folded3dFigureScene, type Folded3dSceneFigure } from './folded3dStoredScene';

/**
 * The style a figure's *stored* picture is built at: the app's display style
 * with the figure's own pins on top.
 *
 * Display and not export, because this is the picture the canvas draws — the
 * export re-paints from the live mesh at the export style, and a handle-less
 * figure re-paints this scene at it. A scene carries no ink, so the only thing
 * the style decides here is the light, and that follows the window.
 */
function storedSceneStyle(appearance: PaperStyleOverrides | undefined) {
  return effectivePaperStyle(useSettingsStore.getState().paperStyle.display, appearance);
}

/**
 * The key of the style a figure's stored picture would be built at
 * ({@link folded3dSceneStyleKey}), for a display style the caller names.
 *
 * The scene bakes the light, so the light only reaches a 3D figure through a
 * rebuild — and the two places a light can change, the app's Paper settings and
 * a figure's own pin, have to ask for one. This is how they tell whether they
 * must: same key, same picture, and the figure keeps the scene it has.
 */
export function folded3dStoredSceneStyleKey(
  display: PaperStyle,
  appearance?: PaperStyleOverrides
): string {
  return folded3dSceneStyleKey(effectivePaperStyle(display, appearance));
}

/** The same, for two sets of pins under the app's current display style. */
export function folded3dStoredSceneStyleChanged(
  before: PaperStyleOverrides | undefined,
  after: PaperStyleOverrides | undefined
): boolean {
  const display = useSettingsStore.getState().paperStyle.display;
  return (
    folded3dStoredSceneStyleKey(display, before) !== folded3dStoredSceneStyleKey(display, after)
  );
}

/** Build a render model's picture at a chosen viewpoint and style. */
export function project3dScene(
  render: OristudioCpFolded3dRenderModel,
  snapshot: OristudioCpFolded3dSnapshot,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  camera: FoldedFigureCamera,
  figure?: Pick<OristudioCpFoldedFigureEntry, 'appearance' | 'frameRadius'>
): PaperScene | null {
  return folded3dFigureScene(
    {
      camera,
      displayStyle,
      folded3d: snapshot,
      frameRadius: figure?.frameRadius ?? null,
    },
    render,
    { style: storedSceneStyle(figure?.appearance), space: 'document' }
  );
}

/**
 * Rebuild a 3D figure that is already on the canvas, at a caller-chosen
 * viewpoint, or `null` when it cannot be rebuilt.
 *
 * `null` is a real answer and not a failure: a figure reopened from a file has
 * `handle: null` and therefore no render model, so it draws from its stored
 * picture and cannot change viewpoint or style. Callers keep what they have
 * rather than blanking the figure.
 */
export function reproject3dSceneAt(
  figure: Folded3dSceneFigure & Pick<OristudioCpFoldedFigureEntry, 'handle' | 'appearance'>,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  camera: FoldedFigureCamera | null
): PaperScene | null {
  const snapshot = figure.folded3d ?? null;
  const render = folded3dRenderModel(figure.handle);
  if (!snapshot || !render) return null;
  return folded3dFigureScene(
    {
      ...figure,
      displayStyle,
      camera: camera ?? defaultFolded3dCamera(render, snapshot.model.state),
    },
    render,
    { style: storedSceneStyle(figure.appearance), space: 'document' }
  );
}

/** The same, at the figure's own recorded viewpoint. */
export function reproject3dScene(
  figure: Folded3dSceneFigure & Pick<OristudioCpFoldedFigureEntry, 'handle' | 'appearance'>,
  displayStyle: OristudioCpFoldedFigureDisplayStyle
): PaperScene | null {
  return reproject3dSceneAt(figure, displayStyle, figure.camera ?? null);
}
