import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { useCpOverlayViews } from './cpOverlayViewStore';
import { useWheelPassthrough } from '../hooks/useWheelPassthrough';
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
import { withShiftLatch } from './touchModifiers/shiftLatch';
import { cpSurfaceGestures } from './gestures/cpSurfaceGestures';
import type { CpGesturePointer } from './gestures/cpTouchArbiter';
import type { TransformableCanvasObject } from './canvasObjects/transformableObject';
import {
  cpSurfacePress,
  type CpSurfacePressHandle,
} from './picking/cpSurfacePressRegistry';

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
  | {
      kind: 'move';
      id: string;
      startClient: Vec2;
      startCenter: Vec2;
      /**
       * What held the selection when this press landed, so a gesture that turns
       * out to be a pinch can put it back. Only a body press selects, which is
       * why only this variant carries it.
       */
      selectionBefore: string | null;
      moved: boolean;
    }
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

/**
 * The contacts this overlay has reported down for and not yet reported up for,
 * by pointer id.
 *
 * A map rather than a single slot for two reasons, both narrow and both ending
 * in the same stuck state: a release whose press landed elsewhere can still fire
 * on a polygon, and two fingers can land on this chrome at once (a body and a
 * handle). Either would clear the wrong entry.
 */
type ContactRef = MutableRefObject<Map<number, CpGesturePointer>>;

/**
 * The crease pattern, when this press is its business rather than the object's —
 * null when the object keeps it.
 *
 * Only asked for an object the creases are painted *over*, which in practice
 * means a reference image: it is drawn under the pattern so you can trace on top
 * of it, while its body polygon still sits above the canvas and is handed the
 * press first. That is why a crease drawn over an image used to be
 * unselectable — this layer took the press and the canvas' hit test never ran
 * at all.
 *
 * Nothing registered means no crease pattern is mounted, or WebGL was
 * unavailable; behaving exactly as before this existed is then the right answer.
 */
function surfaceClaiming(
  event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>,
  object: TransformableCanvasObject
): CpSurfacePressHandle | null {
  if (!object.paintedBehindCreases) return null;
  const surface = cpSurfacePress();
  return surface?.claimsPress(event.nativeEvent) ? surface : null;
}

/**
 * Take the press, and ask the surface whether it is ours to act on.
 *
 * The capture is unconditional and the drag is not. Even when a camera gesture
 * wins, this contact is one of the fingers *driving* it: holding the pointer is
 * what keeps its motion arriving here to be reported, and a pinch whose moving
 * finger is the one on the window would otherwise measure nothing at all. What
 * the verdict decides is only whether a drag starts.
 *
 * Outside the component on purpose. It reads a ref and module state and nothing
 * else, and the handlers that call it are memoised — so were it defined in the
 * body, adding a prop to it one day would go stale in a way nothing reports.
 */
function claimSurfacePress(
  event: ReactPointerEvent<SVGElement>,
  contactRef: ContactRef
): boolean {
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  contactRef.current.set(event.pointerId, {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clientX: event.clientX,
    clientY: event.clientY,
  });
  return cpSurfaceGestures.down(event, 'overlay') === 'forward';
}

/** End a contact {@link claimSurfacePress} reported, and drop the capture. */
function releaseSurfaceContact(
  event: ReactPointerEvent<SVGElement>,
  contactRef: ContactRef
): void {
  contactRef.current.delete(event.pointerId);
  // Reported even for a pointer this overlay never claimed: the arbiter routes
  // an unknown release the same way the canvas does, and a release whose press
  // landed on another layer genuinely can arrive here.
  cpSurfaceGestures.up(event);
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

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
  inertBodyIds,
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
  /**
   * Ids whose *body* takes no pointer events, while their handles still do.
   *
   * For an object whose content is itself interactive — a focused inline
   * simulation, which orbits on drag — the body polygon sits above that content
   * and would otherwise swallow every gesture meant for it, moving the object
   * instead. Distinct from {@link suppressedId}, which removes the chrome
   * altogether: here the selection outline and the resize/rotate handles remain,
   * so the object can still be sized and turned.
   */
  inertBodyIds?: ReadonlySet<string>;
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
  /**
   * The contacts this overlay has reported to the surface arbiter and not yet
   * reported the release of.
   *
   * Held so unmounting mid-gesture cannot strand one. A contact the arbiter
   * still believes is down makes every later single touch look like the second
   * finger of a pinch, so the canvas would stop drawing entirely — a leak that
   * outlives the component that caused it, and the one failure here worth the
   * bookkeeping.
   */
  const contactRef = useRef<Map<number, CpGesturePointer>>(new Map());
  // State rather than a ref: the wheel listener below has to re-attach when this
  // element arrives, which a ref would not tell anyone about.
  const [overlay, setOverlay] = useState<SVGSVGElement | null>(null);
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
      const rect = overlay?.getBoundingClientRect();
      if (!rect || !views) return null;
      return overlayCssToModel(views[space], {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [overlay, views]
  );

  const claimPress = (event: ReactPointerEvent<SVGElement>) =>
    claimSurfacePress(event, contactRef);
  const releaseContact = (event: ReactPointerEvent<SVGElement>) =>
    releaseSurfaceContact(event, contactRef);

  const handleBodyDown = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>, object: TransformableCanvasObject) => {
      if (!interactive || object.locked) return;
      // Before anything else, including the arbiter: the creases are drawn over
      // this object, and this press landed on one of them (or is a pan, which
      // nothing may claim). Hand the *native* event over — the canvas calls
      // `preventDefault()` on it and takes capture for the real pointer id,
      // which is what redirects the rest of the gesture there, overriding the
      // implicit capture a touch or pen press gives this polygon.
      //
      // Nothing else may happen on this path. No selection, no capture, and in
      // particular no contact reported to the touch arbiter: the canvas reports
      // its own with origin 'canvas', and two layers reporting one press would
      // leave the arbiter believing a finger is still down — after which every
      // later touch looks like the second finger of a pinch and the canvas
      // stops drawing entirely.
      const surface = surfaceClaiming(event, object);
      if (surface) {
        surface.press(event.nativeEvent);
        return;
      }
      // Only the primary button drags. A secondary press selects and lets the
      // context menu open: starting a move here would capture the pointer, and
      // the release that dismisses the menu lands outside this element — leaving
      // the drag live so the object then follows the cursor unbidden.
      if (event.button !== 0) {
        event.stopPropagation();
        onSelect(object.id);
        return;
      }
      if (!claimPress(event)) return;
      // Selected on press, not on release: the outline has to be up while the
      // object is being dragged. What makes that safe when the press turns out
      // to be the first finger of a pinch is `selectionBefore` — see `abortDrag`.
      onSelect(object.id);
      onGestureStart?.(object.id);
      dragRef.current = {
        kind: 'move',
        id: object.id,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter: { x: object.box.center.x, y: object.box.center.y },
        selectionBefore: selectedId,
        moved: false,
      };
    },
    [interactive, onSelect, onGestureStart, selectedId]
  );

  const handleResizeDown = useCallback(
    (
      event: ReactPointerEvent<SVGRectElement>,
      object: TransformableCanvasObject,
      handle: AnnotationResizeHandle
    ) => {
      if (!interactive || object.locked || event.button !== 0) return;
      if (!claimPress(event)) return;
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
      if (!claimPress(event)) return;
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
      // Reported whether or not this overlay is dragging: while a camera gesture
      // owns the surface this is where one of its fingers is, and the sample it
      // produces goes straight to the canvas' camera.
      const action = cpSurfaceGestures.move(event);
      const drag = dragRef.current;
      if (action !== 'forward' || !drag || !views) return;
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
          // Shift, or the rail's latch standing in for it. Without the latch a
          // touch device cannot escape the aspect lock at all: a reference image
          // is `default-on`, so it can never be distorted, and a text box is
          // `default-off`, so it can never be constrained.
          resizeAspectLock(drag.startObject.aspectLock, withShiftLatch(event.shiftKey))
        );
        onUpdate(drag.id, { center: next.center, width: next.width, height: next.height });
        return;
      }
      // rotate
      drag.moved = true;
      const angle = Math.atan2(pointer.y - drag.center.y, pointer.x - drag.center.x);
      let rotation = drag.startRotation + (angle - drag.startPointerAngle);
      if (withShiftLatch(event.shiftKey)) rotation = snapAngle(rotation, IMAGE_ROTATION_SNAP_RADIANS);
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
    releaseContact(event);
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      releaseContact(event);
      if (drag?.moved) {
        onGestureCommit?.(
          drag.id,
          drag.kind === 'resize' && drag.crop ? 'crop' : drag.kind
        );
      }
    },
    [onGestureCommit]
  );

  /**
   * Leave no trace of the press, because a camera gesture has claimed the
   * surface — the second finger of a pinch landed, or a Pencil preempted the
   * hand.
   *
   * Symmetrical with the canvas' `abortInFlightGesture`, and for the same
   * reason: a pinch that nudges a folded figure a few pixels every time is a
   * document edit nobody asked for. The gesture is dropped without committing,
   * so the store lands back on the value it started from with no history entry —
   * exactly what a cancelled gesture already did.
   *
   * **Selection is taken back too, and unlike the geometry it is taken back even
   * when nothing moved.** Fingers of a pinch land tens of milliseconds apart, so
   * the first one has already selected whatever it came down on — reported from
   * a tablet as "it no longer moves the window, but it still selects it". A
   * pinch is a camera gesture and should change nothing else, so the selection
   * goes back to whatever held it, which is usually nothing.
   *
   * A crop drag is the one thing that cannot be restored: the crop rect lives
   * with the owner that applies it, and {@link TransformableCanvasObject} — all
   * this overlay ever sees — carries no trace of it. Dropped uncommitted, as
   * `pointercancel` has always dropped it.
   */
  const abortDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'move') {
      if (drag.selectionBefore !== drag.id) onSelect(drag.selectionBefore);
      if (drag.moved) onUpdate(drag.id, { center: drag.startCenter });
      return;
    }
    // Resize and rotate never selected anything: their handles only exist on the
    // object that already held the selection.
    if (!drag.moved) return;
    if (drag.kind === 'rotate') {
      onUpdate(drag.id, { rotation: drag.startRotation });
    } else if (!drag.crop) {
      const { center, width, height } = drag.startObject.box;
      onUpdate(drag.id, { center, width, height });
    }
  }, [onUpdate, onSelect]);

  useEffect(() => cpSurfaceGestures.onAbort('overlay', abortDrag), [abortDrag]);

  // A gesture that outlives the overlay would otherwise leave a contact the
  // arbiter believes is still down. See `contactRef`.
  useEffect(() => {
    const contacts = contactRef.current;
    return () => {
      for (const contact of contacts.values()) cpSurfaceGestures.up(contact);
      contacts.clear();
    };
  }, []);

  const selected = objects.find((object) => object.id === selectedId) ?? null;

  // The interactive polygons/handles capture pointer events, which would
  // otherwise swallow the wheel and stop the canvas zooming while the cursor is
  // over an object. Resolved as a sibling rather than through
  // `resolveCpViewportCanvas`, which the portaled toolbars need: this overlay is
  // mounted next to its own canvas and can name it exactly.
  useWheelPassthrough(
    overlay,
    useCallback(() => overlay?.parentElement?.querySelector('canvas'), [overlay])
  );

  if (!views) return null;

  return (
    <svg
      ref={setOverlay}
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
        const bodyInert = inertBodyIds?.has(object.id) ?? false;
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
            // A focused body is inert to this overlay and its interior is taking
            // drags — orbiting a 3D figure, running a simulation. Doubling the
            // outline is the only thing on screen that says so, and without it
            // "press again to focus" is a rule with no feedback.
            strokeWidth={isSelected ? (bodyInert ? 3 : 1.5) : 0}
            strokeDasharray={cropping ? '4 3' : undefined}
            style={{
              pointerEvents: interactive && !object.locked && !bodyInert ? 'auto' : 'none',
              cursor: interactive && !bodyInert ? 'move' : 'default',
              vectorEffect: 'non-scaling-stroke',
            }}
            onPointerDown={(event) => handleBodyDown(event, object)}
            onPointerMove={(event) => handlePointerMove(event, object)}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(event) => {
              if (!interactive || object.locked || !onContextMenu) return;
              // A right-click on a crease drawn over this object belongs to the
              // crease — the press that preceded this already went to the canvas
              // and armed its erase. All that is left here is to swallow the
              // browser's native menu, which the canvas' own `contextmenu`
              // listener would have done had the event reached it.
              if (surfaceClaiming(event, object)) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onContextMenu(object.id, event.clientX, event.clientY);
            }}
            onDoubleClick={(event) => {
              if (!interactive || object.locked) return;
              // Both underlying presses went to the canvas, so this object is
              // not even selected. Toggling its crop mode or opening its editor
              // from a double-click aimed at a crease would be a surprise.
              if (surfaceClaiming(event, object)) return;
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
