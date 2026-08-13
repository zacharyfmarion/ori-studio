import { useTranslation } from 'react-i18next';
import type { OristudioBpFlap, OristudioBpSheet } from '../../engine/oristudioBpTypes';
import {
  BP_FLAP_RESIZE_HANDLES,
  bpFlapHandlePoint,
  bpFlapOuterBox,
  type BpFlapResizeHandle,
} from '../../lib/bpFlapReshape';
import { bpPackingPointToSvg, bpPackingRectToSvg } from '../../lib/bpPackingViewport';
import { BP_FLAP_HANDLE_RADIUS, type BpFlapResize } from '../../hooks/useBpFlapResize';
import type { PlotRect } from '../../lib/geometry';

/**
 * Resize handles on the selected flap's drawn extent.
 *
 * They sit on the **clearance** box — the flap's rectangle grown by its radius —
 * because that is what a flap looks like, and for the ordinary flap (`0 × 0`
 * box) the rectangle is a single point with nothing to grab.
 *
 * Two layering rules, both load-bearing:
 *
 * - Above the flap shades. A shade is the flap's own click target and is drawn
 *   over the flap graphics, so a handle beneath one never receives a pointer.
 * - Outside the sheet clip. Every geometry layer is masked to the paper, the way
 *   upstream masks its own; a corner flap's handles would be cut away. The flap
 *   dots and labels escape the mask for the same reason.
 *
 * Sized in SVG units rather than screen pixels, so they scale with the camera
 * exactly as the flap dots and labels do. What keeps them usable is the pane's
 * too-small gate (`useBpFlapResize`), which is a test of *relative* size and so
 * is unaffected by zoom.
 */

/** Cursor per handle. Grid north is screen up, so the names map straight across. */
const HANDLE_CURSORS: Record<BpFlapResizeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export function BpFlapResizeHandles({
  flap,
  sheet,
  paperRect,
  resize,
}: {
  flap: OristudioBpFlap;
  sheet: OristudioBpSheet;
  paperRect: PlotRect;
  resize: BpFlapResize;
}) {
  const { t } = useTranslation();
  const outline = bpPackingRectToSvg(bpFlapOuterBox(flap), sheet, paperRect);
  const labels: Record<BpFlapResizeHandle, string> = {
    n: t('panels:bpPacking.resizeFlapTop', 'Resize flap from the top'),
    s: t('panels:bpPacking.resizeFlapBottom', 'Resize flap from the bottom'),
    e: t('panels:bpPacking.resizeFlapRight', 'Resize flap from the right'),
    w: t('panels:bpPacking.resizeFlapLeft', 'Resize flap from the left'),
    ne: t('panels:bpPacking.resizeFlapTopRight', 'Resize flap from the top-right corner'),
    nw: t('panels:bpPacking.resizeFlapTopLeft', 'Resize flap from the top-left corner'),
    se: t('panels:bpPacking.resizeFlapBottomRight', 'Resize flap from the bottom-right corner'),
    sw: t('panels:bpPacking.resizeFlapBottomLeft', 'Resize flap from the bottom-left corner'),
  };

  return (
    <g className="bp-packing-flap-resize">
      {/* Drawn only while dragging, and only as a guide: the clearance outline
          may be switched off as a layer, and without it the handles would be
          floating in space with nothing between them. */}
      {resize.active && (
        <rect
          className="bp-packing-flap-resize-outline"
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          pointerEvents="none"
        />
      )}
      {BP_FLAP_RESIZE_HANDLES.map((handle) => {
        const at = bpPackingPointToSvg(bpFlapHandlePoint(flap, handle), sheet, paperRect);
        return (
          <rect
            key={handle}
            className={
              resize.active === handle
                ? 'bp-packing-flap-handle bp-packing-flap-handle--active'
                : 'bp-packing-flap-handle'
            }
            x={at.x - BP_FLAP_HANDLE_RADIUS}
            y={at.y - BP_FLAP_HANDLE_RADIUS}
            width={BP_FLAP_HANDLE_RADIUS * 2}
            height={BP_FLAP_HANDLE_RADIUS * 2}
            style={{ cursor: HANDLE_CURSORS[handle] }}
            data-bp-flap-handle={handle}
            aria-label={labels[handle]}
            onPointerDown={(event) => resize.onHandlePointerDown(event, handle)}
            onPointerMove={resize.onHandlePointerMove}
            onPointerUp={resize.onHandlePointerUp}
            onPointerCancel={resize.onHandlePointerUp}
          />
        );
      })}
    </g>
  );
}
