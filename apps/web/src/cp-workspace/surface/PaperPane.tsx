import { useEffect, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from 'react';
import { syncHeldModifiersFromEvent } from '../../keyboard/heldModifiers';
import type { Point } from '../../lib/geometry';
import type { PaperScene } from '../../lib/paper/paperScene';
import { ptToDevicePx, type PaperStyle } from '../../lib/paper/paperStyle';
import type { SurfaceStylePolicy } from '../../lib/paper/paperStyleResolve';
import type { WheelGesturePreference } from '../../lib/wheelGesture';
import { CpRendererUnavailable } from '../CpRendererUnavailable';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { paperSceneToFoldedGeometry, type FoldedFaceInk } from '../adapters/cpFoldedToScene';
import { cpCanvasCursor } from '../cpCanvasCursor';
import type { StackHit, StackHitIndex } from '../picking/stackHitIndex';
import { concatStrokes } from '../references/referencesViewGeometry';
import type { UserBounds } from '../renderer/camera';
import { joinFills } from '../renderer/fillTint';
import type { FillGeometry, FoldedGeometry, PointGeometry, StrokeGeometry } from '../renderer/types';
import {
  useCpSurface,
  type CpSurfaceControls,
  type CpSurfaceFrameScales,
  type CpSurfaceHitRadii,
  type CpSurfaceInset,
} from './useCpSurface';
import styles from './PaperPane.module.css';

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

const NO_OVERLAY: PaperPaneOverlay = {};

/**
 * How a pane draws its paper: the host's look, resolved. A pane has no look
 * of its own, so the policy has no default either.
 */
export interface PaperLook {
  /** Every pen and colour the painter reads. */
  style: PaperStyle;
  /**
   * The surface the style is read through: Fold reads its paper as a step
   * diagram (`fold`), Edit its flat figure as `folded-flat`.
   */
  policy: SurfaceStylePolicy;
  /**
   * X-ray: every face's fill alpha, under 1 to see through the paper, which
   * then draws its buried pieces too (`foldedSceneLocalGeometry`), so the
   * scene must keep them (`markHidden: false`). Absent, opaque.
   */
  faceAlpha?: number;
  /**
   * Per-face fill overrides (a refusal's faces). They tint only what is
   * painted: a face lit with the parts under other layers is `fills`' job.
   */
  faces?: ReadonlyMap<number, FoldedFaceInk>;
}

/** What follows the pointer, over the pane's own channels. */
export interface PaperPaneOverlay {
  /** Over `fills`. */
  fills?: FillGeometry | null;
  /** Over `strokes`. */
  strokes?: StrokeGeometry | null;
  points?: PointGeometry | null;
}

export interface PaperPaneProps<Hit> {
  ref?: Ref<CpSurfaceControls>;
  /**
   * The paper, through the shared painter (`paperSceneToFoldedGeometry`) on
   * the folded channel; null for none. Its points are user space, placed
   * through {@link modelToSvg}: built with that map as its `toScenePx`.
   */
  scene: PaperScene | null;
  look: PaperLook;
  /**
   * The pane's frame → user space: the one map the camera, every channel
   * but the paper's, the hit test and the `layers` are drawn and asked
   * through. The paper is placed through it too, so paint, tints and hits
   * agree. A turn or a shift of the paper is part of it (Fold's display
   * offset), never applied to one of them alone.
   */
  modelToSvg: (point: Point) => Point;
  /** Strokes on the crease channel, under the paper: a crease pattern as Edit draws one (`cpPatternStrokes`). */
  creases?: StrokeGeometry | null;
  /** Fills under everything the pane draws, its creases and paper too: a tint that must not veil a crease. */
  underFills?: FillGeometry | null;
  /** Fills over the paper and the creases (the overlay fill channel), in the pane's frame. */
  fills?: FillGeometry | null;
  /** Strokes over everything (the preview channel), in the pane's frame. */
  strokes?: StrokeGeometry | null;
  /** What follows the pointer, from what is under it (by `sameHit`, so never per move along one thing). */
  overlay?: (hovered: Hit | null) => PaperPaneOverlay;
  /** The width the crease, preview and overlay strokes draw at in one frame, device px. */
  strokeWidthPx: (frame: CpSurfaceFrameScales) => number;
  /**
   * The paper's cells, in the pane's frame (`StackHitIndex`): with it, the
   * hit test is handed the cell under the point and its faces. Absent, null.
   */
  stacks?: StackHitIndex | null;
  /**
   * What a click at a point of the pane's frame would take, within the radii
   * there (in the pane's units: `radiusScale`), and the stack under it.
   */
  hitTest: (at: Point, radii: CpSurfaceHitRadii, stack: StackHit | null) => Hit | null;
  /** The same target as a frame ago, by identity rather than position. */
  sameHit: (a: Hit, b: Hit) => boolean;
  /** Whether a click would take what is under the pointer, which the cursor then says. Every hit by default. */
  isTarget?: (hit: Hit) => boolean;
  onPick: (hit: Hit | null) => void;
  /** Told what is under the pointer whenever that changes. */
  onHover?: (hovered: Hit | null) => void;
  /**
   * The pane's units per Edit model unit, which the surface measures hit
   * radii in: the same share of the paper on both. 1 by default.
   */
  radiusScale?: number;
  /** What the camera fits, in user space. */
  contentBounds: UserBounds | null;
  /** The camera refits when this changes (`useCpSurface`). */
  framingKey: string;
  /** What the content is: when it changes, the camera keeps its view while the content still shows (`useCpSurface`). */
  keepInViewKey?: string | null;
  /** What must still show across a new `keepInViewKey`; `contentBounds` when absent. */
  keepInViewBounds?: UserBounds | null;
  /** The pane's edges something over it covers, CSS px: the fit keeps the paper out from under it. */
  inset?: CpSurfaceInset | null;
  wheelGesture: WheelGesturePreference;
  /** The user's snap radius, in Edit's model units. */
  snapRadius: number;
  /** Theme colours are DOM-resolved; the overlay is uploaded again when this changes. */
  themeKey?: string;
  onZoomPercentChange?: (percent: number) => void;
  /** Called when a press on the pane begins: the pane the keyboard's zoom now means. */
  onActivate?: () => void;
  /** Layers drawn over the canvas through its camera. */
  layers?: (view: CpOverlayView) => ReactNode;
  /** The canvas's accessible name. */
  ariaLabel: string;
  /** The canvas's test id. */
  testId?: string;
  /** Data attributes on the pane's box, by which its host finds it. */
  markers?: Readonly<Record<`data-${string}`, string>>;
  /** The `surface` a renderer that fails to start is reported under. */
  errorSurface: string;
}

const everyHit = () => true;

/**
 * A pane that paints paper: a WebGL canvas on `useCpSurface` (the renderer's
 * lifecycle, the camera, pan, pinch and wheel, a click told from a drag, the
 * hover probe) with a paper scene on its folded channel, painted in the look
 * it is handed through the pipeline Edit's figures, the Diagram and Pose share
 * (`paperSceneToFoldedGeometry`), and its other channels the caller's:
 * creases, fills under and over, strokes and points over all, and what
 * follows the pointer.
 *
 * Every prop is a channel or the surface's; none says what the paper means.
 * Fold's two panes are this, through `FoldPane`; so are the Layer order
 * dialog's (`implementation-plans/layer-order-dialog.md`, U7). Not the Fold
 * workspace's Paper tab (`FoldPaperPane`).
 *
 * A press focuses the pane, so keys the host gives it land there rather than
 * on the control the press left, and the held modifiers are read off every
 * pointer event before the canvas hit-tests it, as Edit's canvas does: a key
 * whose key-up landed in another window would otherwise stay held. It
 * publishes into no store and registers no singleton; the host holds the
 * camera verbs through `ref`.
 */
export function PaperPane<Hit>(props: PaperPaneProps<Hit>) {
  const {
    ref,
    scene,
    look,
    modelToSvg,
    creases = null,
    underFills = null,
    fills = null,
    strokes = null,
    overlay,
    strokeWidthPx,
    stacks = null,
    hitTest,
    sameHit,
    isTarget = everyHit,
    onPick,
    onHover,
    radiusScale = 1,
    contentBounds,
    framingKey,
    keepInViewKey = null,
    keepInViewBounds = null,
    inset = null,
    wheelGesture,
    snapRadius,
    themeKey,
    onZoomPercentChange,
    onActivate,
    layers,
    ariaLabel,
    testId,
    markers,
    errorSurface,
  } = props;
  const [view, setView] = useState<CpOverlayView | null>(null);

  const { canvasRef, rendererRef, rendererGeneration, rendererStatus, hovered, dragging, render, controls } =
    useCpSurface<Hit>({
      modelToSvg,
      contentBounds,
      framingKey,
      keepInViewKey,
      keepInViewBounds,
      inset,
      wheelGesture,
      snapRadius,
      // The surface measures radii in Edit's units; the same share of this paper.
      hitTest: (point, radii) =>
        hitTest(
          point,
          { point: radii.point * radiusScale, line: radii.line * radiusScale },
          stacks?.stackAt(point) ?? null
        ),
      sameHit,
      onPick,
      strokeWidths: (frame) => ({
        strokeWidthPx: strokeWidthPx(frame),
        // A stroke multiplier on the folded channel is pt: device px per pt
        // is the unit, as Edit's canvas draws its figures.
        foldedStrokeWidthPx: ptToDevicePx(1, frame.ratio),
      }),
      onViewChange: setView,
      onZoomPercentChange,
      errorSurface,
    });

  useImperativeHandle(ref, () => controls, [controls]);

  // The paper: the scene through the painter, in the look it is handed.
  const { style, policy, faceAlpha, faces } = look;
  const geometry = useMemo(
    () => (scene ? paperSceneToFoldedGeometry(scene, style, { policy, faceAlpha, faces }) : EMPTY_FOLDED),
    [scene, style, policy, faceAlpha, faces]
  );
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFolded(geometry);
    render();
  }, [geometry, rendererGeneration, rendererRef, render]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStrokes(creases ?? EMPTY_STROKES);
    render();
  }, [creases, rendererGeneration, rendererRef, render]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSheetFill(underFills);
    render();
  }, [underFills, rendererGeneration, rendererRef, render]);

  // What follows the pointer, over the pane's own fills and strokes.
  const feedback = useMemo(() => overlay?.(hovered) ?? NO_OVERLAY, [overlay, hovered]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setDiagnosticFills(joinFills(fills, feedback.fills ?? null));
    render();
  }, [fills, feedback, rendererGeneration, rendererRef, render]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOverlayPoints(feedback.points ?? null);
    renderer.setPreview(concatStrokes(strokes, feedback.strokes ?? null));
    render();
  }, [feedback, strokes, themeKey, rendererGeneration, rendererRef, render]);

  useEffect(() => {
    onHover?.(hovered);
  }, [onHover, hovered]);

  const cursor = cpCanvasCursor({
    panToolActive: false,
    panModifierHeld: false,
    panDragging: dragging,
    creaseHovered: hovered !== null && isTarget(hovered),
  });

  return (
    <div
      {...markers}
      className={styles.pane}
      tabIndex={-1}
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
        data-testid={testId}
        style={cursor ? { cursor } : undefined}
      />
      {view && layers?.(view)}
      {rendererStatus && <CpRendererUnavailable status={rendererStatus} />}
    </div>
  );
}
