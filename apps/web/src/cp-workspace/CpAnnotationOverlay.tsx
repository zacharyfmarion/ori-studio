import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { useCpOverlayView } from './cpOverlayViewStore';
import { IMAGE_ROTATION_SNAP_RADIANS } from './images/cpImage';
import {
  cropImage,
  overlayCssDeltaToModel,
  overlayCssToModel,
  overlayModelToCss,
  resizeImage,
  snapAngle,
  type CpImageResizeHandle,
  type Vec2,
} from './images/cpImagePlacement';
import { quadCornersModel } from './annotations/annotationAnchor';
import {
  isImageAnnotation,
  type AnnotationUpdate,
  type CanvasAnnotation,
} from './annotations/annotation';

/**
 * DOM overlay for direct-manipulating canvas annotations (images + text boxes)
 * on the WebGL surface. Images are drawn on the GPU and text on its own DOM
 * layer; this SVG layer draws the selection outline + handles and hosts the
 * select / move / resize / rotate pointer interactions shared by every kind.
 *
 * Kind-specific affordances layer on top: double-clicking an image toggles crop
 * mode (handles adjust the crop rect); double-clicking a text box requests
 * inline editing (`onRequestEditText`), during which that box's chrome is
 * suppressed so the Lexical editor receives events.
 *
 * Handle positions are projected from each box's model-space corners through the
 * camera {@link CpOverlayView}, so the chrome matches the object exactly under
 * rotation and non-uniform zoom; the transform math runs in model space
 * (cpImagePlacement) so it is camera-agnostic.
 */

/** Rotation handle offset (CSS px) outward from each corner. */
const ROTATE_OFFSET_PX = 18;
/** Resize handle square size (CSS px). */
const HANDLE_SIZE_PX = 8;

type Drag =
  | { kind: 'move'; id: string; startClient: Vec2; startCenter: Vec2; moved: boolean }
  | {
      kind: 'resize';
      id: string;
      handle: CpImageResizeHandle;
      startBox: CanvasAnnotation;
      /** When true the handle crops instead of scaling (image only). */
      crop: boolean;
      moved: boolean;
    }
  | {
      kind: 'rotate';
      id: string;
      startRotation: number;
      startPointerAngle: number;
      center: Vec2;
      moved: boolean;
    };

function annotationCornersCss(annotation: CanvasAnnotation, view: CpOverlayView): Vec2[] {
  return quadCornersModel(
    annotation.center,
    annotation.width,
    annotation.height,
    annotation.rotation
  ).map((corner) => overlayModelToCss(view, corner));
}

export function CpAnnotationOverlay({
  annotations,
  selectedId,
  editingTextId,
  interactive,
  onSelect,
  onUpdate,
  onRequestEditText,
  onGestureStart,
  onGestureCommit,
}: {
  annotations: readonly CanvasAnnotation[];
  selectedId: string | null;
  /** Id of the text box currently being inline-edited (chrome suppressed). */
  editingTextId: string | null;
  interactive: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: AnnotationUpdate) => void;
  /** Double-click on a text box requests inline editing. */
  onRequestEditText: (id: string) => void;
  /** Called at the start of a move/resize/rotate gesture (to snapshot for undo). */
  onGestureStart?: () => void;
  /** Called once a gesture actually changed the annotation, for undo/labeling. */
  onGestureCommit?: (id: string, label: string) => void;
}) {
  // Live camera, subscribed directly so only this overlay re-renders per frame.
  const view = useCpOverlayView();
  const dragRef = useRef<Drag | null>(null);
  const containerRef = useRef<SVGSVGElement | null>(null);
  // Crop mode (image only): handles adjust the crop rect instead of scaling.
  const [cropMode, setCropMode] = useState(false);
  useEffect(() => setCropMode(false), [selectedId]);

  // Escape steps back one level: exit crop mode if cropping, else deselect.
  // Deselect via empty-canvas click is handled by the canvas background path
  // (CreasePatternPanel onSelect); this covers the keyboard. Ignored while
  // typing or inline-editing a text box.
  useEffect(() => {
    if (!interactive || !selectedId || editingTextId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      if (cropMode) setCropMode(false);
      else onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactive, selectedId, editingTextId, cropMode, onSelect]);

  const pointerToModel = useCallback(
    (event: ReactPointerEvent): Vec2 | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !view) return null;
      return overlayCssToModel(view, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    },
    [view]
  );

  const beginCapture = (event: ReactPointerEvent<SVGElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBodyDown = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>, annotation: CanvasAnnotation) => {
      if (!interactive || annotation.locked) return;
      beginCapture(event);
      onSelect(annotation.id);
      onGestureStart?.();
      dragRef.current = {
        kind: 'move',
        id: annotation.id,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter: { x: annotation.center.x, y: annotation.center.y },
        moved: false,
      };
    },
    [interactive, onSelect, onGestureStart]
  );

  const handleResizeDown = useCallback(
    (
      event: ReactPointerEvent<SVGRectElement>,
      annotation: CanvasAnnotation,
      handle: CpImageResizeHandle
    ) => {
      if (!interactive || annotation.locked) return;
      beginCapture(event);
      onGestureStart?.();
      dragRef.current = {
        kind: 'resize',
        id: annotation.id,
        handle,
        startBox: annotation,
        crop: cropMode && isImageAnnotation(annotation),
        moved: false,
      };
    },
    [interactive, onGestureStart, cropMode]
  );

  const handleRotateDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, annotation: CanvasAnnotation) => {
      if (!interactive || annotation.locked) return;
      beginCapture(event);
      onGestureStart?.();
      const pointer = pointerToModel(event);
      const angle = pointer
        ? Math.atan2(pointer.y - annotation.center.y, pointer.x - annotation.center.x)
        : annotation.rotation;
      dragRef.current = {
        kind: 'rotate',
        id: annotation.id,
        startRotation: annotation.rotation,
        startPointerAngle: angle,
        center: { x: annotation.center.x, y: annotation.center.y },
        moved: false,
      };
    },
    [interactive, pointerToModel, onGestureStart]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      if (!drag || !view) return;
      if (drag.kind === 'move') {
        const dCss = { x: event.clientX - drag.startClient.x, y: event.clientY - drag.startClient.y };
        const dModel = overlayCssDeltaToModel(view, dCss);
        if (!dModel) return;
        if (!drag.moved && Math.hypot(dCss.x, dCss.y) > 1) drag.moved = true;
        onUpdate(drag.id, {
          center: { x: drag.startCenter.x + dModel.x, y: drag.startCenter.y + dModel.y },
        });
        return;
      }
      const pointer = pointerToModel(event);
      if (!pointer) return;
      if (drag.kind === 'resize') {
        drag.moved = true;
        if (drag.crop && isImageAnnotation(drag.startBox)) {
          const next = cropImage(drag.startBox, drag.handle, pointer);
          onUpdate(drag.id, {
            center: next.center,
            width: next.width,
            height: next.height,
            crop: next.crop,
          });
          return;
        }
        const next = resizeImage(drag.startBox, drag.handle, pointer, event.shiftKey);
        onUpdate(drag.id, { center: next.center, width: next.width, height: next.height });
        return;
      }
      // rotate
      drag.moved = true;
      const angle = Math.atan2(pointer.y - drag.center.y, pointer.x - drag.center.x);
      let rotation = drag.startRotation + (angle - drag.startPointerAngle);
      if (event.shiftKey) rotation = snapAngle(rotation, IMAGE_ROTATION_SNAP_RADIANS);
      onUpdate(drag.id, { rotation });
    },
    [view, pointerToModel, onUpdate]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag?.moved) {
        const label =
          drag.kind === 'move'
            ? 'Move annotation'
            : drag.kind === 'rotate'
              ? 'Rotate annotation'
              : drag.crop
                ? 'Crop image'
                : 'Resize annotation';
        onGestureCommit?.(drag.id, label);
      }
    },
    [onGestureCommit]
  );

  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null;

  // The interactive polygons/handles capture pointer events, which would
  // otherwise swallow the wheel and stop the canvas zooming while the cursor is
  // over an annotation. Forward the wheel to the sibling WebGL canvas so zoom
  // keeps working. A native, non-passive listener is used so preventDefault
  // actually suppresses the page scroll (React's onWheel is registered passive).
  useEffect(() => {
    const svg = containerRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const canvas = svg.parentElement?.querySelector('canvas');
      if (!canvas) return;
      event.preventDefault();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          cancelable: true,
        })
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  if (!view) return null;

  return (
    <svg
      ref={containerRef}
      className="cp-annotation-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
        // Above the WebGL canvas (5), grid (6), and the text DOM layer (7) so
        // selection handles sit on top of every annotation kind.
        zIndex: 8,
      }}
      aria-hidden="true"
    >
      {annotations.map((annotation) => {
        if (annotation.hidden) return null;
        // Suppress chrome for the text box being inline-edited so the editor
        // owns pointer events.
        if (annotation.id === editingTextId) return null;
        const corners = annotationCornersCss(annotation, view);
        const points = corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
        const isSelected = annotation.id === selectedId;
        const cropping = isSelected && cropMode && isImageAnnotation(annotation);
        return (
          <polygon
            key={annotation.id}
            points={points}
            fill="transparent"
            stroke={
              isSelected
                ? cropping
                  ? '#e0a020'
                  : 'var(--accent-primary, #4c9aff)'
                : 'transparent'
            }
            strokeWidth={isSelected ? 1.5 : 0}
            strokeDasharray={cropping ? '4 3' : undefined}
            style={{
              pointerEvents: interactive && !annotation.locked ? 'auto' : 'none',
              cursor: interactive ? 'move' : 'default',
              vectorEffect: 'non-scaling-stroke',
            }}
            onPointerDown={(event) => handleBodyDown(event, annotation)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={(event) => {
              if (!interactive || annotation.locked) return;
              event.stopPropagation();
              onSelect(annotation.id);
              if (isImageAnnotation(annotation)) setCropMode((mode) => !mode);
              else onRequestEditText(annotation.id);
            }}
          />
        );
      })}

      {interactive &&
        selected &&
        !selected.hidden &&
        !selected.locked &&
        selected.id !== editingTextId && (
          <SelectionHandles
            annotation={selected}
            view={view}
            cropMode={cropMode && isImageAnnotation(selected)}
            onResizeDown={handleResizeDown}
            onRotateDown={handleRotateDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        )}
    </svg>
  );
}

/** Resize squares (8) + rotation handles (4) for the selected annotation. */
function SelectionHandles({
  annotation,
  view,
  cropMode,
  onResizeDown,
  onRotateDown,
  onPointerMove,
  onPointerUp,
}: {
  annotation: CanvasAnnotation;
  view: CpOverlayView;
  cropMode: boolean;
  onResizeDown: (
    event: ReactPointerEvent<SVGRectElement>,
    annotation: CanvasAnnotation,
    handle: CpImageResizeHandle
  ) => void;
  onRotateDown: (event: ReactPointerEvent<SVGCircleElement>, annotation: CanvasAnnotation) => void;
  onPointerMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void;
}) {
  // Crop handles use the warning accent; resize/rotate the primary accent.
  const handleStroke = cropMode ? '#e0a020' : 'var(--accent-primary, #4c9aff)';
  const [tl, tr, br, bl] = annotationCornersCss(annotation, view);
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };

  const resizePoints: { handle: CpImageResizeHandle; at: Vec2 }[] = [
    { handle: 'nw', at: tl },
    { handle: 'n', at: mid(tl, tr) },
    { handle: 'ne', at: tr },
    { handle: 'e', at: mid(tr, br) },
    { handle: 'se', at: br },
    { handle: 's', at: mid(br, bl) },
    { handle: 'sw', at: bl },
    { handle: 'w', at: mid(bl, tl) },
  ];

  // Rotation handles sit just outside each corner (Affinity-style).
  const outward = (corner: Vec2): Vec2 => {
    const dx = corner.x - center.x;
    const dy = corner.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: corner.x + (dx / len) * ROTATE_OFFSET_PX,
      y: corner.y + (dy / len) * ROTATE_OFFSET_PX,
    };
  };
  const rotateCorners = [tl, tr, br, bl];

  const half = HANDLE_SIZE_PX / 2;
  return (
    <g>
      {/* Rotation handles are only meaningful when scaling, not cropping. */}
      {!cropMode &&
        rotateCorners.map((corner, i) => {
          const at = outward(corner);
          return (
            <circle
              key={`rot-${i}`}
              cx={at.x}
              cy={at.y}
              r={HANDLE_SIZE_PX / 2 + 1}
              fill="var(--bg-primary, #202430)"
              stroke={handleStroke}
              strokeWidth={1.5}
              style={{ pointerEvents: 'auto', cursor: 'grab', vectorEffect: 'non-scaling-stroke' }}
              onPointerDown={(event) => onRotateDown(event, annotation)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          );
        })}
      {resizePoints.map(({ handle, at }) => (
        <rect
          key={handle}
          x={at.x - half}
          y={at.y - half}
          width={HANDLE_SIZE_PX}
          height={HANDLE_SIZE_PX}
          fill="var(--bg-primary, #202430)"
          stroke={handleStroke}
          strokeWidth={1.5}
          style={{ pointerEvents: 'auto', cursor: 'pointer', vectorEffect: 'non-scaling-stroke' }}
          onPointerDown={(event) => onResizeDown(event, annotation, handle)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </g>
  );
}
