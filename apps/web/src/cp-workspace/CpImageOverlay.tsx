import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import type { CpImage, CpImageUpdate } from './images/cpImage';
import {
  imageCornersModel,
  overlayCssDeltaToModel,
  overlayModelToCss,
} from './images/cpImagePlacement';

/**
 * DOM overlay for editing reference images on the WebGL surface. The images
 * themselves are drawn on the GPU (below the creases); this SVG layer draws the
 * selection outline and hosts the pointer interactions (select + move in this
 * phase; resize/rotate/crop handles come next). Interaction is gated on
 * `interactive` (the Images tool) so it never steals crease clicks otherwise.
 *
 * Each image's quad corners are projected straight through the camera's
 * {@link CpOverlayView}, so the outline matches the GPU quad exactly under any
 * rotation, flip, or non-uniform zoom.
 */

interface DragState {
  id: string;
  startClient: { x: number; y: number };
  startCenter: { x: number; y: number };
  moved: boolean;
}

export function CpImageOverlay({
  images,
  selectedImageId,
  view,
  interactive,
  onSelectImage,
  onUpdateImage,
  onMoveCommit,
}: {
  images: readonly CpImage[];
  selectedImageId: string | null;
  view: CpOverlayView;
  interactive: boolean;
  onSelectImage: (id: string | null) => void;
  onUpdateImage: (id: string, patch: CpImageUpdate) => void;
  /** Called once when a move gesture actually moved the image (for undo/labeling). */
  onMoveCommit?: (id: string) => void;
}) {
  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>, image: CpImage) => {
      if (!interactive || image.locked) return;
      event.stopPropagation();
      event.preventDefault();
      onSelectImage(image.id);
      dragRef.current = {
        id: image.id,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter: { x: image.center.x, y: image.center.y },
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [interactive, onSelectImage]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dCss = {
        x: event.clientX - drag.startClient.x,
        y: event.clientY - drag.startClient.y,
      };
      const dModel = overlayCssDeltaToModel(view, dCss);
      if (!dModel) return;
      if (!drag.moved && (Math.abs(dCss.x) > 1 || Math.abs(dCss.y) > 1)) drag.moved = true;
      onUpdateImage(drag.id, {
        center: { x: drag.startCenter.x + dModel.x, y: drag.startCenter.y + dModel.y },
      });
    },
    [view, onUpdateImage]
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGPolygonElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.moved) onMoveCommit?.(drag.id);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onMoveCommit]
  );

  return (
    <svg
      className="cp-image-overlay"
      // Container is click-through; only the per-image polygons capture events
      // (and only while the Images tool is active).
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
        const selected = image.id === selectedImageId;
        return (
          <polygon
            key={image.id}
            points={points}
            fill="transparent"
            stroke={selected ? 'var(--accent, #4c9aff)' : 'transparent'}
            strokeWidth={selected ? 1.5 : 0}
            style={{
              pointerEvents: interactive && !image.locked ? 'auto' : 'none',
              cursor: interactive ? 'move' : 'default',
              vectorEffect: 'non-scaling-stroke',
            }}
            onPointerDown={(event) => handlePointerDown(event, image)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        );
      })}
    </svg>
  );
}
