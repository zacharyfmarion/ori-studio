import { useEffect, useMemo, useState } from 'react';
import type { CpOverlayView } from '../../cp-workspace/CreasePatternWebglCanvas';
import type { CpSurfaceView } from '../../cp-workspace/surface/useCpSurface';
import { observeResizeDeferred } from '../ui/observeResizeDeferred';
import type { Point } from '../../lib/geometry';
import type { LayerFace } from '../../layer-order/engine/faceIndex';
import { insetRing, ringInsetPx } from '../../layer-order/panes/faceRing';
import { placeLabels, type LayerPlacedLabel } from '../../layer-order/panes/layerPaneLabels';
import type { LayerPaneChannels } from '../../layer-order/panes/useLayerOrderPanes';
import styles from './LayerOrderPaneMarks.module.css';

/** The pane's frame → CSS px of its canvas box, through the camera. */
function projector(view: CpOverlayView): (point: Point) => Point {
  const [ox, oy] = view.origin;
  const [ax, ay] = view.ex;
  const [bx, by] = view.ey;
  return ({ x, y }) => ({ x: ox + ax * x + bx * y, y: oy + ay * x + by * y });
}

const pointsOf = (ring: readonly Point[]) => ring.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** A lit crease's two lines, each `offsetPx` to one side of it on screen: the crease's own colour stays clear. */
function besideSegment(from: Point, to: Point, offsetPx: number): [Point, Point][] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [];
  const nx = (-dy / length) * offsetPx;
  const ny = (dx / length) * offsetPx;
  return [1, -1].map((s) => [
    { x: from.x + s * nx, y: from.y + s * ny },
    { x: to.x + s * nx, y: to.y + s * ny },
  ]);
}

/** A lit crease's stroke, CSS px: the subject ring's. */
const CREASE_LIT_PX = 2;

/** Two views at one scale, turn and line boost: one only pans from the other. */
function samePlacing(a: CpSurfaceView, b: CpSurfaceView): boolean {
  return (
    a.widthBoost === b.widthBoost &&
    a.ex[0] === b.ex[0] &&
    a.ex[1] === b.ex[1] &&
    a.ey[0] === b.ey[0] &&
    a.ey[1] === b.ey[1]
  );
}

/** How long a pan must hold still before the letters are placed again, ms. */
const PAN_SETTLE_MS = 120;

/**
 * What a Layer order pane draws over its canvas, through its camera
 * (`implementation-plans/layer-order-dialog.md`, row U8; D20): the
 * changed spots' one fade, each marked face's ring inside it, a crease a
 * notice names (a line each side of it, D19), and the faces' letters on top.
 *
 * In CSS px rather than on a channel of the canvas, because each of these
 * holds a size on screen at every zoom: a ring sits a pixel clear of the line
 * drawn along its face's edge, as wide as that line is drawn at this zoom
 * (`faceRing.ts`), so it never covers a crease's colour, and a letter's chip
 * keeps its size, clears that line and the ring, and clears the other chips;
 * set beside its face, it clears every line the pane draws
 * (`layerPaneLabels.ts`). The tints are the canvas's (`PaperPane`'s fills).
 *
 * While the camera only pans, the letters move with it as placed, and are
 * placed again once it has held still for {@link PAN_SETTLE_MS}: placing
 * every letter every frame of a drag costs more than the frame has.
 *
 * Nothing here takes a pointer: the canvas under it does. Its box is
 * measured, a frame late, only so a letter set beside its face stays on
 * screen.
 */
export function LayerOrderPaneMarks({
  pane,
  view,
  onUnlettered,
}: {
  pane: LayerPaneChannels;
  view: CpSurfaceView;
  /** The faces on offer this zoom leaves with no letter, ascending: told when they change (D7's addition). */
  onUnlettered?: (faces: readonly LayerFace[]) => void;
}) {
  const project = useMemo(() => projector(view), [view]);
  const linePx = pane.lineWidthCss(view.widthBoost);
  // The view the letters are placed in: this one, or while the camera pans, the one it panned from.
  const [placed, setPlaced] = useState(view);
  useEffect(() => {
    if (placed === view) return;
    const timer = setTimeout(() => setPlaced(view), samePlacing(placed, view) ? PAN_SETTLE_MS : 0);
    return () => clearTimeout(timer);
  }, [placed, view]);
  const anchor = samePlacing(placed, view) ? placed : view;
  const anchorProject = useMemo(() => projector(anchor), [anchor]);
  const shiftX = view.origin[0] - anchor.origin[0];
  const shiftY = view.origin[1] - anchor.origin[1];
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!element) return;
    const measure = () =>
      setFrame((was) =>
        was && was.width === element.clientWidth && was.height === element.clientHeight
          ? was
          : { width: element.clientWidth, height: element.clientHeight }
      );
    measure();
    // jsdom has none; the box is then measured once.
    if (typeof ResizeObserver === 'undefined') return;
    return observeResizeDeferred(element, measure);
  }, [element]);
  const rings = useMemo(
    () =>
      pane.rings.flatMap(({ face, ring, ink, widthPx }) => {
        const inner = insetRing(ring.map(project), ringInsetPx(widthPx, linePx));
        return inner ? [{ face, points: pointsOf(inner), ink, widthPx }] : [];
      }),
    [pane.rings, project, linePx]
  );
  const litCrease = useMemo(
    () =>
      pane.litCrease.flatMap(([from, to]) =>
        besideSegment(project(from), project(to), ringInsetPx(CREASE_LIT_PX, linePx))
      ),
    [pane.litCrease, project, linePx]
  );
  const flash = useMemo(
    () => (pane.flash ? { n: pane.flash.n, polygons: pane.flash.spots.map((spot) => pointsOf(spot.map(project))) } : null),
    [pane.flash, project]
  );
  const anchorLinePx = pane.lineWidthCss(anchor.widthBoost);
  const anchorLinesPx = pane.labelLinesWidthCss(anchor.widthBoost);
  const labels: LayerPlacedLabel[] = useMemo(
    () =>
      placeLabels(pane.labels, pane.labelSpots, pane.letterOf, anchorProject, {
        frame,
        linePx: anchorLinePx,
        lines: pane.labelLines,
        linesPx: anchorLinesPx,
      }),
    [pane.labels, pane.labelSpots, pane.labelLines, pane.letterOf, anchorProject, frame, anchorLinePx, anchorLinesPx]
  );
  // The faces on offer whose chips found no room at this zoom: tinted, unlettered, until zoomed in.
  const unlettered = useMemo(() => {
    const placedFaces = new Set(labels.map((label) => label.face));
    return pane.labels
      .filter((label) => label.tone === 'plain' && !placedFaces.has(label.face))
      .map((label) => label.face)
      .sort((a, b) => a - b)
      .join(',');
  }, [labels, pane.labels]);
  useEffect(() => {
    onUnlettered?.(unlettered === '' ? [] : unlettered.split(',').map(Number));
  }, [unlettered, onUnlettered]);

  return (
    <div ref={setElement} className={styles.marks} aria-hidden="true" data-layer-order-marks={pane.id}>
      <svg className={styles.layer}>
        {flash && (
          // Keyed by the flash, so each one fades from the start.
          <g key={flash.n} className={styles.flash} data-layer-order-flash={flash.n}>
            {flash.polygons.map((points, k) => (
              <polygon key={k} points={points} />
            ))}
          </g>
        )}
        {rings.map(({ face, points, ink, widthPx }) => (
          <polygon
            key={face}
            className={styles.ring}
            data-ink={ink}
            data-layer-order-ring={face}
            points={points}
            strokeWidth={widthPx}
          />
        ))}
        {litCrease.length > 0 && (
          <g className={styles.crease} data-layer-order-crease={litCrease.length / 2} strokeWidth={CREASE_LIT_PX}>
            {litCrease.map(([from, to], k) => (
              <line key={k} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
            ))}
          </g>
        )}
      </svg>
      {labels.map((label) => (
        <span
          key={label.face}
          className={styles.label}
          data-tone={label.tone}
          data-under={label.under || undefined}
          data-off={label.off || undefined}
          data-layer-order-letter={label.text}
          style={{
            left: label.x + shiftX - label.width / 2,
            top: label.y + shiftY - label.height / 2,
            width: label.width,
            height: label.height,
          }}
        >
          {label.tone === 'danger' && <span className={styles.dot} />}
          {label.text}
        </span>
      ))}
    </div>
  );
}
