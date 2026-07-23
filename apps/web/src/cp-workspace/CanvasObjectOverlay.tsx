import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { useCpOverlayViews } from './cpOverlayViewStore';
import { IMAGE_ROTATION_SNAP_RADIANS } from './images/cpImage';
import {
  CORNER_RESIZE_HANDLES,
  boxCornersModel,
  overlayCssDeltaToModel,
  overlayCssToModel,
  overlayModelToCss,
  resizeAnnotationBox,
  resizeAspectLock,
  snapAngle,
  type AnnotationBox,
  type AnnotationResizeHandle,
  type Vec2,
} from './annotations/annotationTransform';
import type { TransformableCanvasObject } from './canvasObjects/transformableObject';

/**
 * DOM overlay for direct-manipulating canvas objects — reference images, text
 * boxes and folded figures — on the WebGL surface. Those are drawn variously on
 * the GPU and on their own DOM layer; this SVG layer draws the selection outline
 * and handles, and hosts the select / move / resize / rotate pointer gestures
 * every kind shares.
 *
 * The overlay knows nothing about the kinds themselves. It consumes
 * {@link TransformableCanvasObject} — a rotated box plus an aspect-lock policy —
 * and reports gestures back as box updates. Kind-specific affordances arrive as
 * optional capability callbacks: `onToggleCrop` (an image's double-click puts its
 * handles into crop mode) and `onRequestEdit` (a text box's double-click opens
 * the inline editor, during which that box's chrome is suppressed so the Lexical
 * editor receives events).
 *
 * Handle positions are projected from each box's corners through the camera
 * affine for that object's space — {@link CpOverlayView} for model-space
 * annotations, the user-space affine for folded figures — so chrome matches the
 * object exactly under rotation and non-uniform zoom. The transform math runs in
 * object space (annotationTransform), so it is camera-agnostic.
 */

/** Rotation handle offset (CSS px) outward from each corner. */
const ROTATE_OFFSET_PX = 18;
/** Resize handle square size (CSS px). */
const HANDLE_SIZE_PX = 8;

/** A box update produced by a gesture. Partial: a move only reports a centre. */
export interface CanvasObjectBoxUpdate {
  center?: Vec2;
  width?: number;
  height?: number;
  rotation?: number;
}

type Drag =
  | { kind: 'move'; id: string; startClient: Vec2; startCenter: Vec2; moved: boolean }
  | {
      kind: 'resize';
      id: string;
      handle: AnnotationResizeHandle;
      startObject: TransformableCanvasObject;
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

function objectCornersCss(
  object: TransformableCanvasObject,
  views: { model: CpOverlayView; user: CpOverlayView }
): Vec2[] {
  const view = views[object.space];
  return boxCornersModel(object.box).map((corner) => overlayModelToCss(view, corner));
}

export function CanvasObjectOverlay({
  objects,
  selectedId,
  suppressedId,
  interactive,
  onSelect,
  onUpdate,
  onCropUpdate,
  onRequestEdit,
  onContextMenu,
  canCrop,
  onGestureStart,
  onGestureCommit,
}: {
  objects: readonly TransformableCanvasObject[];
  selectedId: string | null;
  /** Id whose chrome is hidden (a text box being inline-edited owns its events). */
  suppressedId: string | null;
  interactive: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: CanvasObjectBoxUpdate) => void;
  /**
   * Crop drag for a croppable object. Given the dragged handle and the pointer
   * in object space, the owner applies its own crop math (which needs the source
   * pixels the overlay knows nothing about).
   */
  onCropUpdate?: (id: string, handle: AnnotationResizeHandle, pointer: Vec2) => void;
  /** Double-click on an editable object (a text box) requests inline editing. */
  onRequestEdit?: (id: string) => void;
  /**
   * Right-click on an object. The overlay sits above the canvas and takes the
   * press first, so without this the canvas's own context-menu handling never
   * runs and the browser's native menu wins.
   */
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Whether this object supports crop mode (double-click toggles it). */
  canCrop?: (id: string) => boolean;
  /** Called at the start of a move/resize/rotate gesture (to snapshot for undo). */
  onGestureStart?: (id: string) => void;
  /** Called once a gesture actually changed the object, for undo/labeling. */
  onGestureCommit?: (id: string, kind: 'move' | 'resize' | 'rotate' | 'crop') => void;
}) {
  // Live camera, subscribed directly so only this overlay re-renders per frame.
  const views = useCpOverlayViews();
  const dragRef = useRef<Drag | null>(null);
  const containerRef = useRef<SVGSVGElement | null>(null);
  // Crop mode (croppable objects only): handles adjust the crop rect.
  const [cropMode, setCropMode] = useState(false);
  useEffect(() => setCropMode(false), [selectedId]);

  // Escape steps back one level: exit crop mode if cropping, else deselect.
  // Deselect via empty-canvas click is handled by the canvas background path
  // (CreasePatternPanel onSelect); this covers the keyboard. Ignored while
  // typing or inline-editing a text box.
  useEffect(() => {
    if (!interactive || !selectedId || suppressedId) return;
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
  }, [interactive, selectedId, suppressedId, cropMode, onSelect]);

  const pointerToObject = useCallback(
    (event: ReactPointerEvent, space: 'model' | 'user'): Vec2 | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !views) return null;
      return overlayCssToModel(views[space], {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [views]
  );

  const beginCapture = (event: ReactPointerEvent<SVGElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleBodyDown = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>, object: TransformableCanvasObject) => {
      if (!interactive || object.locked) return;
      // Only the primary button drags. A secondary press selects and lets the
      // context menu open: starting a move here would capture the pointer, and
      // the release that dismisses the menu lands outside this element — leaving
      // the drag live so the object then follows the cursor unbidden.
      if (event.button !== 0) {
        event.stopPropagation();
        onSelect(object.id);
        return;
      }
      beginCapture(event);
      onSelect(object.id);
      onGestureStart?.(object.id);
      dragRef.current = {
        kind: 'move',
        id: object.id,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter: { x: object.box.center.x, y: object.box.center.y },
        moved: false,
      };
    },
    [interactive, onSelect, onGestureStart]
  );

  const handleResizeDown = useCallback(
    (
      event: ReactPointerEvent<SVGRectElement>,
      object: TransformableCanvasObject,
      handle: AnnotationResizeHandle
    ) => {
      if (!interactive || object.locked || event.button !== 0) return;
      beginCapture(event);
      onGestureStart?.(object.id);
      dragRef.current = {
        kind: 'resize',
        id: object.id,
        handle,
        startObject: object,
        crop: cropMode && (canCrop?.(object.id) ?? false),
        moved: false,
      };
    },
    [interactive, onGestureStart, cropMode, canCrop]
  );

  const handleRotateDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, object: TransformableCanvasObject) => {
      if (!interactive || object.locked || event.button !== 0) return;
      beginCapture(event);
      onGestureStart?.(object.id);
      const pointer = pointerToObject(event, object.space);
      const angle = pointer
        ? Math.atan2(pointer.y - object.box.center.y, pointer.x - object.box.center.x)
        : object.box.rotation;
      dragRef.current = {
        kind: 'rotate',
        id: object.id,
        startRotation: object.box.rotation,
        startPointerAngle: angle,
        center: { x: object.box.center.x, y: object.box.center.y },
        moved: false,
      };
    },
    [interactive, pointerToObject, onGestureStart]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGElement>, object: TransformableCanvasObject) => {
      const drag = dragRef.current;
      if (!drag || !views) return;
      if (drag.kind === 'move') {
        const dCss = { x: event.clientX - drag.startClient.x, y: event.clientY - drag.startClient.y };
        const dObject = overlayCssDeltaToModel(views[object.space], dCss);
        if (!dObject) return;
        if (!drag.moved && Math.hypot(dCss.x, dCss.y) > 1) drag.moved = true;
        onUpdate(drag.id, {
          center: { x: drag.startCenter.x + dObject.x, y: drag.startCenter.y + dObject.y },
        });
        return;
      }
      const pointer = pointerToObject(event, object.space);
      if (!pointer) return;
      if (drag.kind === 'resize') {
        drag.moved = true;
        if (drag.crop) {
          onCropUpdate?.(drag.id, drag.handle, pointer);
          return;
        }
        const next = resizeAnnotationBox(
          drag.startObject.box,
          drag.handle,
          pointer,
          resizeAspectLock(drag.startObject.aspectLock, event.shiftKey)
        );
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
    [views, pointerToObject, onUpdate, onCropUpdate]
  );

  /**
   * A gesture that never gets its pointerup (pointer cancelled, capture lost)
   * must not stay live, or the object silently follows the cursor afterwards.
   * Drop it without recording — the store already holds the in-progress value,
   * and no history entry means the next real edit still has a sane baseline.
   */
  const handlePointerCancel = useCallback((event: ReactPointerEvent<SVGElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (drag?.moved) {
        onGestureCommit?.(
          drag.id,
          drag.kind === 'resize' && drag.crop ? 'crop' : drag.kind
        );
      }
    },
    [onGestureCommit]
  );

  const selected = objects.find((object) => object.id === selectedId) ?? null;

  // The interactive polygons/handles capture pointer events, which would
  // otherwise swallow the wheel and stop the canvas zooming while the cursor is
  // over an object. Forward the wheel to the sibling WebGL canvas so zoom keeps
  // working. A native, non-passive listener is used so preventDefault actually
  // suppresses the page scroll (React's onWheel is registered passive).
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

  if (!views) return null;

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
        // selection handles sit on top of every object kind.
        zIndex: 8,
      }}
      aria-hidden="true"
    >
      {objects.map((object) => {
        if (object.hidden) return null;
        // Suppress chrome for the box being inline-edited so the editor owns
        // pointer events.
        if (object.id === suppressedId) return null;
        const corners = objectCornersCss(object, views);
        const points = corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
        const isSelected = object.id === selectedId;
        const cropping = isSelected && cropMode && (canCrop?.(object.id) ?? false);
        return (
          <polygon
            key={object.id}
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
              pointerEvents: interactive && !object.locked ? 'auto' : 'none',
              cursor: interactive ? 'move' : 'default',
              vectorEffect: 'non-scaling-stroke',
            }}
            onPointerDown={(event) => handleBodyDown(event, object)}
            onPointerMove={(event) => handlePointerMove(event, object)}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(event) => {
              if (!interactive || object.locked || !onContextMenu) return;
              event.preventDefault();
              event.stopPropagation();
              onContextMenu(object.id, event.clientX, event.clientY);
            }}
            onDoubleClick={(event) => {
              if (!interactive || object.locked) return;
              event.stopPropagation();
              onSelect(object.id);
              if (canCrop?.(object.id)) setCropMode((mode) => !mode);
              else onRequestEdit?.(object.id);
            }}
          />
        );
      })}

      {interactive && selected && !selected.hidden && !selected.locked && (
        <SelectionHandles
          object={selected}
          views={views}
          cropMode={cropMode && (canCrop?.(selected.id) ?? false)}
          onResizeDown={handleResizeDown}
          onRotateDown={handleRotateDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      )}
    </svg>
  );
}

/** Resize squares + rotation handles for the selected object. */
function SelectionHandles({
  object,
  views,
  cropMode,
  onResizeDown,
  onRotateDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  object: TransformableCanvasObject;
  views: { model: CpOverlayView; user: CpOverlayView };
  cropMode: boolean;
  onResizeDown: (
    event: ReactPointerEvent<SVGRectElement>,
    object: TransformableCanvasObject,
    handle: AnnotationResizeHandle
  ) => void;
  onRotateDown: (
    event: ReactPointerEvent<SVGCircleElement>,
    object: TransformableCanvasObject
  ) => void;
  onPointerMove: (
    event: ReactPointerEvent<SVGElement>,
    object: TransformableCanvasObject
  ) => void;
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<SVGElement>) => void;
}) {
  // Crop handles use the warning accent; resize/rotate the primary accent.
  const handleStroke = cropMode ? '#e0a020' : 'var(--accent-primary, #4c9aff)';
  const [tl, tr, br, bl] = objectCornersCss(object, views);
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };

  const allHandles: { handle: AnnotationResizeHandle; at: Vec2 }[] = [
    { handle: 'nw', at: tl },
    { handle: 'n', at: mid(tl, tr) },
    { handle: 'ne', at: tr },
    { handle: 'e', at: mid(tr, br) },
    { handle: 'se', at: br },
    { handle: 's', at: mid(br, bl) },
    { handle: 'sw', at: bl },
    { handle: 'w', at: mid(bl, tl) },
  ];
  // An always-proportional object (a folded figure) gets corners only: eight
  // handles on something that cannot be stretched is misleading chrome. Crop is
  // per-axis by nature, so cropping always offers all eight.
  const resizePoints =
    object.aspectLock === 'always' && !cropMode
      ? allHandles.filter((point) => CORNER_RESIZE_HANDLES.includes(point.handle))
      : allHandles;

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
              onPointerDown={(event) => onRotateDown(event, object)}
              onPointerMove={(event) => onPointerMove(event, object)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
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
          onPointerDown={(event) => onResizeDown(event, object, handle)}
          onPointerMove={(event) => onPointerMove(event, object)}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      ))}
    </g>
  );
}

/** Re-exported so callers can type their own box types against the overlay's. */
export type { AnnotationBox };
