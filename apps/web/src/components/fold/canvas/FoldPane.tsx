import { forwardRef, useMemo, type ReactNode } from 'react';
import type { CpOverlayView } from '../../../cp-workspace/CreasePatternWebglCanvas';
import type { FoldedSceneInk } from '../../../cp-workspace/adapters/cpFoldedToScene';
import type { UserBounds } from '../../../cp-workspace/renderer/camera';
import type { FillGeometry } from '../../../cp-workspace/renderer/types';
import { PaperPane } from '../../../cp-workspace/surface/PaperPane';
import type { CpSurfaceControls, CpSurfaceInset } from '../../../cp-workspace/surface/useCpSurface';
import type { PaperScene } from '../../../lib/paper/paperScene';
import type { PaperStyle } from '../../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../../lib/paper/paperStyleResolve';
import {
  foldPaneStrokeWidthPx,
  type FoldCreasePatternStrokes,
} from '../../../fold/canvas/useFoldCreasePatternStrokes';
import type { WheelGesturePreference } from '../../../lib/wheelGesture';
import { FOLD_UNITS_PER_CP_UNIT, foldUnitToUser } from '../../../fold/canvas/foldCanvasGeometry';
import type { FoldPaneOverlay } from '../../../fold/canvas/foldPaneOverlays';
import { sameFoldHit, type FoldHit, type FoldHitRadii, type FoldPaneId } from '../../../fold/canvas/foldPicking';
import { FOLD_PANE_ATTRIBUTE } from '../../../fold/canvas/useFoldCanvasShortcuts';
import type { Point } from '../../../lib/geometry';

const FOLD_INK: FoldedSceneInk = { policy: PAPER_STYLE_POLICIES.fold };

export interface FoldPaneProps {
  pane: FoldPaneId;
  /** The paper the pane paints, through the shared painter; null before the state's scene is in, or for none. */
  scene: PaperScene | null;
  /** The user's paper style: every pen and colour the painter reads. */
  style: PaperStyle;
  /** The surface the style is read through, and the per-face overrides (a refusal's faces). The `fold` policy by default. */
  ink?: FoldedSceneInk;
  /**
   * A crease pattern drawn as Edit draws one (`useFoldCreasePatternStrokes`):
   * its lines on the crease channel, its instruction on the preview channel
   * under the tool's feedback, and every stroke measured from its crease
   * width. Absent, the pane draws no creases of its own and measures the
   * feedback from the edge pen.
   */
  creases?: FoldCreasePatternStrokes | null;
  /** A tint over the paper, in the pane's frame: the moving set of a located fold. */
  tint?: FillGeometry | null;
  /**
   * Where the pane's frame is shown: the folded pane's display offset
   * (`foldedDisplayOffset`), so the model turns about the sheet's middle.
   * The pane's frame stays what it is for everything it is handed.
   */
  offset?: Point;
  /** What the camera fits, in user space. */
  contentBounds: UserBounds | null;
  /** The camera refits when this changes: a new sequence or a new sheet, never a fold. */
  framingKey: string;
  /**
   * The step on screen, once its own picture is in: when it changes, the
   * camera keeps its view while the content still shows there, and fits it
   * again where it would arrive off screen (`useCpSurface`'s
   * `keepInViewKey`). Null or absent, never.
   */
  keepInViewKey?: string | null;
  /** What must still show of the content across a new step: the folded form itself. `contentBounds` when absent. */
  keepInViewBounds?: UserBounds | null;
  /** The pane's edges the tool window covers, CSS px: the fit keeps the paper out from under it (a phone's). */
  inset?: CpSurfaceInset | null;
  wheelGesture: WheelGesturePreference;
  /** The user's snap radius, in Edit's model units. */
  snapRadius: number;
  /** What a click at a point of the pane's frame would take, within the radii there. */
  hitTest: (at: Point, radii: FoldHitRadii) => FoldHit | null;
  onPick: (hit: FoldHit | null) => void;
  /** The tool's feedback over the paper, from what is under the pointer. */
  overlay: (hovered: FoldHit | null) => FoldPaneOverlay;
  /** Told what is under the pointer whenever that changes (by `sameFoldHit`, so never per move along one thing). */
  onHover?: (hovered: FoldHit | null) => void;
  /** Theme colours are DOM-resolved; they are read again when this changes. */
  inkKey: string;
  onZoomPercentChange?: (percent: number) => void;
  /** Called when a press on the pane begins: the pane the keyboard's zoom now means. */
  onActivate?: () => void;
  /** Layers drawn over the canvas through its camera: the fold's arrow, the root chooser. */
  layers?: (view: CpOverlayView) => ReactNode;
  ariaLabel: string;
}

/** A click takes what it hits, and bare paper takes nothing. */
const takesPick = (hit: FoldHit) => hit.pick != null;

/**
 * One pane of the Fold canvas (plan D13): a `PaperPane` in Fold's frame and
 * Fold's units, with the tool's feedback on its overlay channels.
 *
 * Both panes are this component, and differ in what they are handed: the
 * folded form is a paper scene, painted through the shared painter on the
 * folded channel in the user's paper style (D11), read as a step diagram (the
 * `fold` policy) unless the canvas says otherwise; the crease pattern is drawn
 * as Edit's canvas draws one — its creases on the crease channel in Edit's
 * inks, on the canvas's own ground (`creases`).
 *
 * What is Fold's here: the frame (`foldUnitToUser`, at the folded pane's
 * display offset), hit radii in sheet units (`FOLD_UNITS_PER_CP_UNIT`),
 * `FoldHit` and its identity, and the pane's marker (`data-fold-pane`), where
 * Enter is the canvas's. It publishes into no store and registers no
 * singleton; the canvas that mounts it holds the camera verbs through the
 * handle.
 */
export const FoldPane = forwardRef<CpSurfaceControls, FoldPaneProps>(function FoldPane(props, ref) {
  const { pane, scene, style, ink = FOLD_INK, creases = null, tint = null, offset, inkKey, ...surface } = props;
  const dx = offset?.x ?? 0;
  const dy = offset?.y ?? 0;
  const modelToSvg = useMemo(
    () => (dx === 0 && dy === 0 ? foldUnitToUser : (point: Point) => foldUnitToUser({ x: point.x + dx, y: point.y + dy })),
    [dx, dy]
  );

  return (
    <PaperPane<FoldHit>
      {...surface}
      ref={ref}
      scene={scene}
      // The painter reads the 3D figure's surface when none is named.
      look={{ style, policy: ink.policy ?? PAPER_STYLE_POLICIES['folded-3d'], faceAlpha: ink.faceAlpha, faces: ink.faces }}
      modelToSvg={modelToSvg}
      creases={creases?.creases ?? null}
      fills={tint}
      // The crease pattern's instruction, under the tool's feedback.
      strokes={creases?.instruction ?? null}
      strokeWidthPx={(frame) => foldPaneStrokeWidthPx(creases, frame)}
      radiusScale={FOLD_UNITS_PER_CP_UNIT}
      sameHit={sameFoldHit}
      isTarget={takesPick}
      themeKey={inkKey}
      testId={`fold-${pane}-canvas`}
      // A press focuses the pane, and Enter there is the canvas's: it commits.
      markers={{ [FOLD_PANE_ATTRIBUTE]: pane }}
      errorSurface={`fold:${pane}-webgl`}
    />
  );
});
