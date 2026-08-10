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
 * same projection outside the store: the live camera is published to
 * `folded3dRuntime` per pointer move and the store is written once on release,
 * so both sides have to produce the *same* picture or the figure would jump when
 * the drag ends. Two copies of this is the drift risk that costs a visible
 * flicker; one module is the fix.
 */

import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import {
  defaultFolded3dCamera,
  folded3dPaperStyle,
  projectFolded3dModel,
  type FoldedFigureCamera,
} from './foldedFigure3dProjection';
import { folded3dRenderModel } from './folded3dRenderModels';

/** Project a render model at a chosen viewpoint and style. */
export function project3dRenderSnapshot(
  render: OristudioCpFolded3dRenderModel,
  snapshot: OristudioCpFolded3dSnapshot,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  camera: FoldedFigureCamera
): OristudioCpFoldedRenderSnapshot {
  return projectFolded3dModel(render, {
    camera,
    displayStyle,
    style: folded3dPaperStyle(snapshot.model),
    tolerances: snapshot.diagnostics.tolerances,
  }).snapshot;
}

/**
 * Re-project a 3D figure that is already on the canvas, at a caller-chosen
 * viewpoint, or `null` when it cannot be re-projected.
 *
 * `null` is a real answer and not a failure: a figure reopened from a file has
 * `handle: null` and therefore no render model, so it draws from its stored
 * snapshot and cannot change viewpoint or style. Callers keep what they have
 * rather than blanking the figure.
 */
export function reproject3dFigureAt(
  figure: OristudioCpFoldedFigureEntry,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  camera: FoldedFigureCamera | null
): OristudioCpFoldedRenderSnapshot | null {
  const snapshot = figure.folded3d ?? null;
  const render = folded3dRenderModel(figure.handle);
  if (!snapshot || !render) return null;
  return project3dRenderSnapshot(
    render,
    snapshot,
    displayStyle,
    camera ?? defaultFolded3dCamera(render, snapshot.model.state)
  );
}

/** The same, at the figure's own recorded viewpoint. */
export function reproject3dFigure(
  figure: OristudioCpFoldedFigureEntry,
  displayStyle: OristudioCpFoldedFigureDisplayStyle
): OristudioCpFoldedRenderSnapshot | null {
  return reproject3dFigureAt(figure, displayStyle, figure.camera ?? null);
}
