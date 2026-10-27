import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type ReactNode } from 'react';
import { CpRendererUnavailable } from '../../../cp-workspace/CpRendererUnavailable';
import type { CpOverlayView } from '../../../cp-workspace/CreasePatternWebglCanvas';
import { cpCanvasCursor } from '../../../cp-workspace/cpCanvasCursor';
import {
  paperSceneToFoldedGeometry,
  type FoldedSceneInk,
} from '../../../cp-workspace/adapters/cpFoldedToScene';
import { concatStrokes } from '../../../cp-workspace/references/referencesViewGeometry';
import type { UserBounds } from '../../../cp-workspace/renderer/camera';
import type { FillGeometry, FoldedGeometry, StrokeGeometry } from '../../../cp-workspace/renderer/types';
import { useCpSurface, type CpSurfaceControls, type CpSurfaceInset } from '../../../cp-workspace/surface/useCpSurface';
import type { PaperScene } from '../../../lib/paper/paperScene';
import type { PaperStyle } from '../../../lib/paper/paperStyle';
import { ptToDevicePx } from '../../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../../lib/paper/paperStyleResolve';
import {
  foldPaneStrokeWidthPx,
  type FoldCreasePatternStrokes,
} from '../../../fold/canvas/useFoldCreasePatternStrokes';
import type { WheelGesturePreference } from '../../../lib/wheelGesture';
import { syncHeldModifiersFromEvent } from '../../../keyboard/heldModifiers';
import { FOLD_UNITS_PER_CP_UNIT, foldUnitToUser } from '../../../fold/canvas/foldCanvasGeometry';
import { joinFills, type FoldPaneOverlay } from '../../../fold/canvas/foldPaneOverlays';
import { sameFoldHit, type FoldHit, type FoldHitRadii, type FoldPaneId } from '../../../fold/canvas/foldPicking';
import type { Point } from '../../../lib/geometry';
import styles from './FoldCanvas.module.css';

const EMPTY_STROKES: StrokeGeometry = {
  a: new Float32Array(0),
  b: new Float32Array(0),
  color: new Float32Array(0),
  widthMul: new Float32Array(0),
  count: 0,
};

const EMPTY_FOLDED: FoldedGeometry = {
  fills: { position: new Float32Array(0), color: new Float32Array(0), count: 0 },
  strokes: EMPTY_STROKES,
};

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
   * A crease pattern drawn in the paper style (`useFoldCreasePatternStrokes`):
   * its lines on the crease channel, its instruction on the preview channel
   * under the tool's feedback, and every stroke measured in points. Absent,
   * the pane draws no creases of its own and measures the feedback from the
   * default edge width.
   */
  creases?: FoldCreasePatternStrokes | null;
  /** The unfolded sheet, in model space, drawn beneath its creases and feedback. */
  sheetFill?: FillGeometry | null;
  /** Override the model-to-user map for the CP's horizontal turnover; also drives picking and overlays. */
  modelToUser?: (point: Point) => Point;
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

/**
 * One pane of the Fold canvas (plan D13): a WebGL canvas on `useCpSurface`
 * — the renderer's lifecycle, the camera, pan, pinch and wheel, a click told
 * from a drag, the hover probe — with the tool's feedback on the overlay
 * channels.
 *
 * Both panes are this component, and differ in what they are handed: the
 * folded form is a paper scene, painted through the shared painter on the
 * folded channel in the user's paper style (D11); the crease pattern is drawn
 * on the crease channel in the paper's pens, over its paper-colored sheet
 * (`sheetFill`). It publishes into no store and registers no singleton;
 * the canvas that mounts it holds the camera
 * verbs through the handle.
 */
export const FoldPane = forwardRef<CpSurfaceControls, FoldPaneProps>(function FoldPane(props, ref) {
  const {
    pane,
    scene,
    style,
    ink = FOLD_INK,
    creases = null,
    sheetFill = null,
    modelToUser,
    tint = null,
    offset,
    contentBounds,
    framingKey,
    keepInViewKey = null,
    keepInViewBounds = null,
    inset = null,
    wheelGesture,
    snapRadius,
    hitTest,
    onPick,
    overlay,
    onHover,
    inkKey,
    onZoomPercentChange,
    onActivate,
    layers,
    ariaLabel,
  } = props;
  const [view, setView] = useState<CpOverlayView | null>(null);
  const dx = offset?.x ?? 0;
  const dy = offset?.y ?? 0;
  const modelToSvg = useMemo(
    () => (dx === 0 && dy === 0 ? foldUnitToUser : (point: Point) => foldUnitToUser({ x: point.x + dx, y: point.y + dy })),
    [dx, dy]
  );

  const { canvasRef, rendererRef, rendererGeneration, rendererStatus, hovered, dragging, render, controls } =
    useCpSurface<FoldHit>({
      modelToSvg: modelToUser ?? modelToSvg,
      contentBounds,
      framingKey,
      keepInViewKey,
      keepInViewBounds,
      inset,
      wheelGesture,
      snapRadius,
      // The surface measures radii in Edit's units; the same share of a Fold sheet.
      hitTest: (point, radii) =>
        hitTest(point, { point: radii.point * FOLD_UNITS_PER_CP_UNIT, line: radii.line * FOLD_UNITS_PER_CP_UNIT }),
      sameHit: sameFoldHit,
      onPick,
      strokeWidths: ({ ratio, widthBoost }) => ({
        // The crease pattern's widths are points, as the paper painter supplies them.
        strokeWidthPx: foldPaneStrokeWidthPx(creases, { ratio, widthBoost }),
        // A stroke multiplier on the folded channel is pt: device px per pt
        // is the unit, as Edit's canvas draws its figures.
        foldedStrokeWidthPx: ptToDevicePx(1, ratio),
      }),
      onViewChange: setView,
      onZoomPercentChange,
      errorSurface: `fold:${pane}-webgl`,
    });

  useImperativeHandle(ref, () => controls, [controls]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSheetFill(sheetFill);
    render();
  }, [sheetFill, rendererGeneration, rendererRef, render]);

  // The paper: the scene through the painter, in the user's style.
  const geometry = useMemo(() => (scene ? paperSceneToFoldedGeometry(scene, style, ink) : EMPTY_FOLDED), [scene, style, ink]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFolded(geometry);
    render();
  }, [geometry, rendererGeneration, rendererRef, render]);

  // A crease pattern, on Edit's crease channel.
  const lines = creases?.creases ?? null;
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStrokes(lines ?? EMPTY_STROKES);
    render();
  }, [lines, rendererGeneration, rendererRef, render]);

  // The tool's feedback, which follows the pointer, over a crease pattern's
  // instruction: both are the preview channel's, the instruction first. The
  // moving set over the paper, and a region the pointer would pick over that:
  // the overlay fill channel draws above the folded channel, in the pane's frame.
  const instruction = creases?.instruction ?? null;
  const feedback = useMemo<FoldPaneOverlay>(() => overlay(hovered), [overlay, hovered]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setDiagnosticFills(joinFills(tint, feedback.fills ?? null));
    render();
  }, [tint, feedback, rendererGeneration, rendererRef, render]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOverlayPoints(feedback.points);
    renderer.setPreview(concatStrokes(instruction, feedback.strokes));
    render();
  }, [feedback, instruction, inkKey, rendererGeneration, rendererRef, render]);

  useEffect(() => {
    onHover?.(hovered);
  }, [onHover, hovered]);

  const cursor = cpCanvasCursor({
    panToolActive: false,
    panModifierHeld: false,
    panDragging: dragging,
    creaseHovered: hovered?.pick != null,
  });

  return (
    <div
      className={styles.pane}
      data-fold-pane={pane}
      // The pane takes the focus a press would otherwise leave on a rail
      // button, so Enter commits rather than pressing that button again.
      tabIndex={-1}
      // The keys held are read off every pointer event before the canvas
      // hit-tests it, as Edit's canvas does on a move: a modifier whose
      // key-up landed elsewhere — another window took it without a blur —
      // would otherwise stay held, and Alt makes every click a free point.
      onPointerMoveCapture={syncHeldModifiersFromEvent}
      onPointerUpCapture={syncHeldModifiersFromEvent}
      onPointerDownCapture={(event) => {
        syncHeldModifiersFromEvent(event);
        onActivate?.();
        if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <canvas
        ref={canvasRef}
        className={styles.surface}
        role="img"
        aria-label={ariaLabel}
        data-testid={`fold-${pane}-canvas`}
        style={cursor ? { cursor } : undefined}
      />
      {view && layers?.(view)}
      {rendererStatus && <CpRendererUnavailable status={rendererStatus} />}
    </div>
  );
});
