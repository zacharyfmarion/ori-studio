import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { IMAGE_ROTATION_SNAP_RADIANS, type CpImage, type CpImageUpdate } from './images/cpImage';
import {
  imageCornersModel,
  overlayCssDeltaToModel,
  overlayCssToModel,
  overlayModelToCss,
  resizeImage,
  snapAngle,
  type CpImageResizeHandle,
  type Vec2,
} from './images/cpImagePlacement';

/**
 * DOM overlay for editing reference images on the WebGL surface. The images
 * themselves are drawn on the GPU (below the creases); this SVG layer draws the
 * selection outline + handles and hosts all pointer interactions. Interaction is
 * gated on `interactive` (the Images tool) so it never steals crease clicks.
 *
 * Every handle position is derived by projecting the image's model-space quad
 * corners through the camera's {@link CpOverlayView}, so the chrome matches the
 * GPU quad exactly under rotation, flip, or non-uniform zoom. The transform math
 * itself runs in model space (see cpImagePlacement) so it is camera-agnostic.
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
      startImage: CpImage;
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

export function CpImageOverlay({
  images,
  selectedImageId,
  view,
  interactive,
  onSelectImage,
  onUpdateImage,
  onGestureStart,
  onGestureCommit,
}: {
  images: readonly CpImage[];
  selectedImageId: string | null;
  view: CpOverlayView;
  interactive: boolean;
  onSelectImage: (id: string | null) => void;
  onUpdateImage: (id: string, patch: CpImageUpdate) => void;
  /** Called at the start of a move/resize/rotate gesture (to snapshot for undo). */
  onGestureStart?: () => void;
  /** Called once a gesture actually changed the image, for undo/labeling. */
  onGestureCommit?: (id: string, label: string) => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const containerRef = useRef<SVGSVGElement | null>(null);

  const pointerToModel = useCallback(
    (event: ReactPointerEvent): Vec2 | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
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
    (event: ReactPointerEvent<SVGPolygonElement>, image: CpImage) => {
      if (!interactive || image.locked) return;
      beginCapture(event);
      onSelectImage(image.id);
      onGestureStart?.();
      dragRef.current = {
        kind: 'move',
        id: image.id,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter: { x: image.center.x, y: image.center.y },
        moved: false,
      };
    },
    [interactive, onSelectImage, onGestureStart]
  );

  const handleResizeDown = useCallback(
    (event: ReactPointerEvent<SVGRectElement>, image: CpImage, handle: CpImageResizeHandle) => {
      if (!interactive || image.locked) return;
      beginCapture(event);
      onGestureStart?.();
      dragRef.current = { kind: 'resize', id: image.id, handle, startImage: image, moved: false };
    },
    [interactive, onGestureStart]
  );

  const handleRotateDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, image: CpImage) => {
      if (!interactive || image.locked) return;
      beginCapture(event);
      onGestureStart?.();
      const pointer = pointerToModel(event);
      const angle = pointer
        ? Math.atan2(pointer.y - image.center.y, pointer.x - image.center.x)
        : image.rotation;
      dragRef.current = {
        kind: 'rotate',
        id: image.id,
        startRotation: image.rotation,
        startPointerAngle: angle,
        center: { x: image.center.x, y: image.center.y },
        moved: false,
      };
    },
    [interactive, pointerToModel, onGestureStart]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'move') {
        const dCss = { x: event.clientX - drag.startClient.x, y: event.clientY - drag.startClient.y };
        const dModel = overlayCssDeltaToModel(view, dCss);
        if (!dModel) return;
        if (!drag.moved && Math.hypot(dCss.x, dCss.y) > 1) drag.moved = true;
        onUpdateImage(drag.id, {
          center: { x: drag.startCenter.x + dModel.x, y: drag.startCenter.y + dModel.y },
        });
        return;
      }
      const pointer = pointerToModel(event);
      if (!pointer) return;
      if (drag.kind === 'resize') {
        drag.moved = true;
        const next = resizeImage(drag.startImage, drag.handle, pointer, event.shiftKey);
        onUpdateImage(drag.id, { center: next.center, width: next.width, height: next.height });
        return;
      }
      // rotate
      drag.moved = true;
      const angle = Math.atan2(pointer.y - drag.center.y, pointer.x - drag.center.x);
      let rotation = drag.startRotation + (angle - drag.startPointerAngle);
      if (event.shiftKey) rotation = snapAngle(rotation, IMAGE_ROTATION_SNAP_RADIANS);
      onUpdateImage(drag.id, { rotation });
    },
    [view, pointerToModel, onUpdateImage]
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
          drag.kind === 'move' ? 'Move image' : drag.kind === 'resize' ? 'Resize image' : 'Rotate image';
        onGestureCommit?.(drag.id, label);
      }
    },
    [onGestureCommit]
  );

  const selected = images.find((image) => image.id === selectedImageId) ?? null;

  return (
    <svg
      ref={containerRef}
      className="cp-image-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      {images.map((image) => {
        if (image.hidden) return null;
        const corners = imageCornersModel(image).map((corner) => overlayModelToCss(view, corner));
        const points = corners.map((corner) => `${corner.x},${corner.y}`).join(' ');
        const isSelected = image.id === selectedImageId;
        return (
          <polygon
            key={image.id}
            points={points}
            fill="transparent"
            stroke={isSelected ? 'var(--accent-primary, #4c9aff)' : 'transparent'}
            strokeWidth={isSelected ? 1.5 : 0}
            style={{
              pointerEvents: interactive && !image.locked ? 'auto' : 'none',
              cursor: interactive ? 'move' : 'default',
              vectorEffect: 'non-scaling-stroke',
            }}
            onPointerDown={(event) => handleBodyDown(event, image)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        );
      })}

      {interactive && selected && !selected.hidden && !selected.locked && (
        <SelectionHandles
          image={selected}
          view={view}
          onResizeDown={handleResizeDown}
          onRotateDown={handleRotateDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      )}
    </svg>
  );
}

/** Resize squares (8) + rotation handles (4) for the selected image. */
function SelectionHandles({
  image,
  view,
  onResizeDown,
  onRotateDown,
  onPointerMove,
  onPointerUp,
}: {
  image: CpImage;
  view: CpOverlayView;
  onResizeDown: (
    event: ReactPointerEvent<SVGRectElement>,
    image: CpImage,
    handle: CpImageResizeHandle
  ) => void;
  onRotateDown: (event: ReactPointerEvent<SVGCircleElement>, image: CpImage) => void;
  onPointerMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointerUp: (event: ReactPointerEvent<SVGElement>) => void;
}) {
  const [tl, tr, br, bl] = imageCornersModel(image).map((corner) => overlayModelToCss(view, corner));
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
    return { x: corner.x + (dx / len) * ROTATE_OFFSET_PX, y: corner.y + (dy / len) * ROTATE_OFFSET_PX };
  };
  const rotateCorners = [tl, tr, br, bl];

  const half = HANDLE_SIZE_PX / 2;
  return (
    <g>
      {rotateCorners.map((corner, i) => {
        const at = outward(corner);
        return (
          <circle
            key={`rot-${i}`}
            cx={at.x}
            cy={at.y}
            r={HANDLE_SIZE_PX / 2 + 1}
            fill="var(--bg-primary, #202430)"
            stroke="var(--accent-primary, #4c9aff)"
            strokeWidth={1.5}
            style={{ pointerEvents: 'auto', cursor: 'grab', vectorEffect: 'non-scaling-stroke' }}
            onPointerDown={(event) => onRotateDown(event, image)}
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
          stroke="var(--accent-primary, #4c9aff)"
          strokeWidth={1.5}
          style={{ pointerEvents: 'auto', cursor: 'pointer', vectorEffect: 'non-scaling-stroke' }}
          onPointerDown={(event) => onResizeDown(event, image, handle)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </g>
  );
}
