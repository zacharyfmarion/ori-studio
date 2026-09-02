/**
 * The crop step's editor: the source image, the four-corner crop over it, and
 * a magnifier while a corner is being dragged.
 *
 * The image is drawn at a fraction of its size, so the pixel a handle is on is
 * invisible under the pointer; the loupe shows the source pixels around the
 * handle at native size or larger, with the crop's edges and a crosshair drawn
 * through it, and stays clear of the hand holding the handle. When the drag
 * ends and the crop is not what it was, `onDragEnd` fires with the crop as it
 * now is — the caller re-rectifies from that; there is no button to press.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CpDetectPoint, CpDetectQuad } from '../engine/cpDetectTypes';
import {
  LOUPE_SIZE_PX,
  loupeImageRect,
  loupeOffset,
  loupeWindow,
  projectToLoupe,
  quadEdges,
} from './cpDetectCropLoupe';

export type CpDetectQuadHandle = keyof CpDetectQuad;

const QUAD_HANDLES: CpDetectQuadHandle[] = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

export interface CpDetectCropEditorProps {
  source: { image: { width: number; height: number }; url: string };
  quad: CpDetectQuad | null;
  /** The crop as the pointer moves it. */
  onQuadChange: (quad: CpDetectQuad) => void;
  /** The drag ended and the crop is not what it was when the drag started. */
  onDragEnd: (quad: CpDetectQuad) => void;
}

interface Drag {
  handle: CpDetectQuadHandle;
  /**
   * The pane the loupe must stay inside, in CSS pixels. Measured at the press
   * and again on every move: the pane can change size under a drag, and a
   * loupe placed for a stale size lands on the pointer or off the pane.
   */
  pane: { width: number; height: number };
  changed: boolean;
}

export function CpDetectCropEditor({ source, quad, onQuadChange, onDragEnd }: CpDetectCropEditorProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the pointer handlers see it: a move that arrives before React
  // has committed the press — the first move of a fast drag, or events fired
  // back to back — must not be dropped for reading a state that is a render
  // behind. `drag` (state) renders the loupe; this ref answers the events.
  const dragRef = useRef<Drag | null>(null);
  // The crop this editor last produced, so the end of a drag reports what the
  // pointer left rather than what the last render had been handed. Kept in
  // step with the prop between drags.
  const latestQuad = useRef<CpDetectQuad | null>(quad);
  useEffect(() => {
    latestQuad.current = quad;
  }, [quad]);

  const beginDrag = useCallback((event: ReactPointerEvent<SVGCircleElement>, handle: CpDetectQuadHandle) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Nothing to capture without a live pointer (a synthetic event); the
      // move and release still reach the pane.
    }
    const rect = imageRef.current?.getBoundingClientRect();
    const started: Drag = {
      handle,
      pane: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
      changed: false,
    };
    dragRef.current = started;
    setDrag(started);
  }, []);

  const moveDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const image = imageRef.current;
      const current = latestQuad.current;
      const active = dragRef.current;
      if (!active || !image || !current) return;
      event.preventDefault();
      const rect = image.getBoundingClientRect();
      const point = clampPoint(pointFromPointer(event, rect, source.image), source.image);
      const next = { ...current, [active.handle]: point };
      latestQuad.current = next;
      const paneMoved =
        Math.abs(rect.width - active.pane.width) > 0.5 ||
        Math.abs(rect.height - active.pane.height) > 0.5;
      if (!active.changed || paneMoved) {
        const changed = { ...active, changed: true, pane: { width: rect.width, height: rect.height } };
        dragRef.current = changed;
        setDrag(changed);
      }
      onQuadChange(next);
    },
    [onQuadChange, source.image]
  );

  const endDrag = useCallback(() => {
    const active = dragRef.current;
    if (!active) return;
    dragRef.current = null;
    setDrag(null);
    if (active.changed && latestQuad.current) onDragEnd(latestQuad.current);
  }, [onDragEnd]);

  // The loupe: redrawn on every move of the handle it follows.
  useEffect(() => {
    const canvas = loupeRef.current;
    const image = imageRef.current;
    if (!drag || !quad || !canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    drawLoupe(context, canvas, image, quad, quad[drag.handle], source.image);
  }, [drag, quad, source.image]);

  const handleRadius = Math.max(source.image.width, source.image.height) * 0.012;
  const loupe = drag && quad ? loupeStyle(quad[drag.handle], drag.pane, source.image) : null;

  return (
    <div
      className="cp-detect-modal__image-wrap"
      style={{ aspectRatio: `${source.image.width} / ${source.image.height}` }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      <img ref={imageRef} src={source.url} alt="" draggable={false} />
      {quad && (
        <svg
          className="cp-detect-modal__overlay"
          viewBox={`0 0 ${source.image.width} ${source.image.height}`}
        >
          <polygon points={quadPolygon(quad)} className="cp-detect-modal__quad" />
          {QUAD_HANDLES.map((handle) => (
            <circle
              key={handle}
              cx={quad[handle].x}
              cy={quad[handle].y}
              r={handleRadius}
              className={
                drag?.handle === handle
                  ? 'cp-detect-modal__handle cp-detect-modal__handle--active'
                  : 'cp-detect-modal__handle'
              }
              onPointerDown={(event) => beginDrag(event, handle)}
            />
          ))}
        </svg>
      )}
      {loupe && (
        <canvas
          ref={loupeRef}
          className="cp-detect-modal__loupe"
          aria-hidden="true"
          data-testid="cp-detect-crop-loupe"
          style={loupe}
        />
      )}
    </div>
  );
}

/**
 * Where the loupe goes, as CSS: the handle's place as a fraction of the pane
 * plus the offset that keeps the loupe beside it and inside the pane.
 */
function loupeStyle(
  handle: CpDetectPoint,
  pane: { width: number; height: number },
  image: { width: number; height: number }
): { left: string; top: string; width: number; height: number } {
  const handlePx = {
    x: (handle.x / image.width) * pane.width,
    y: (handle.y / image.height) * pane.height,
  };
  const offset = loupeOffset(handlePx, pane);
  return {
    left: `calc(${(handle.x / image.width) * 100}% + ${offset.x}px)`,
    top: `calc(${(handle.y / image.height) * 100}% + ${offset.y}px)`,
    width: LOUPE_SIZE_PX,
    height: LOUPE_SIZE_PX,
  };
}

function drawLoupe(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  quad: CpDetectQuad,
  center: CpDetectPoint,
  size: { width: number; height: number }
): void {
  const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1);
  canvas.width = LOUPE_SIZE_PX * ratio;
  canvas.height = LOUPE_SIZE_PX * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, LOUPE_SIZE_PX, LOUPE_SIZE_PX);

  const window_ = loupeWindow(center, size.width, size.height);
  const rect = loupeImageRect(window_, size.width, size.height);
  if (rect) {
    // Source pixels, not a resampled blur: the point of the loupe is the pixel.
    context.imageSmoothingEnabled = false;
    context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  }

  const accent = getComputedStyle(canvas).getPropertyValue('--accent-primary').trim() || '#3b82f6';
  context.lineWidth = 1.5;
  context.strokeStyle = accent;
  context.beginPath();
  for (const [from, to] of quadEdges(quad)) {
    const a = projectToLoupe(from, window_);
    const b = projectToLoupe(to, window_);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.stroke();

  // The crosshair: open at the centre so the pixel under the handle stays visible.
  const mid = LOUPE_SIZE_PX / 2;
  const arm = 14;
  const gap = 5;
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  context.beginPath();
  context.moveTo(mid - arm, mid);
  context.lineTo(mid - gap, mid);
  context.moveTo(mid + gap, mid);
  context.lineTo(mid + arm, mid);
  context.moveTo(mid, mid - arm);
  context.lineTo(mid, mid - gap);
  context.moveTo(mid, mid + gap);
  context.lineTo(mid, mid + arm);
  context.stroke();
}

function pointFromPointer(
  event: ReactPointerEvent,
  rect: DOMRect,
  image: { width: number; height: number }
): CpDetectPoint {
  return {
    x: ((event.clientX - rect.left) / rect.width) * image.width,
    y: ((event.clientY - rect.top) / rect.height) * image.height,
  };
}

function clampPoint(point: CpDetectPoint, image: { width: number; height: number }): CpDetectPoint {
  return {
    x: Math.min(Math.max(point.x, 0), image.width - 1),
    y: Math.min(Math.max(point.y, 0), image.height - 1),
  };
}

function quadPolygon(quad: CpDetectQuad): string {
  return [quad.top_left, quad.top_right, quad.bottom_right, quad.bottom_left]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}
