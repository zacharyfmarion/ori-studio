import { useLayoutEffect, useState, type ReactNode } from 'react';
import { FloatingPortal } from '@floating-ui/react';
import { useWheelPassthrough } from '../../hooks/useWheelPassthrough';
import { observeResizeDeferred } from '../../components/ui/observeResizeDeferred';
import { resolveCpViewportCanvas } from '../cpViewportCanvas';
import { useCanvasObjectAnchor } from '../canvasObjects/useCanvasObjectAnchor';
import type { AnnotationBox } from '../annotations/annotationTransform';
import { regionChipPlacement } from './regionChipPlacement';
import type { CpRegionChipDragHandlers } from './useCpRegionChipDrag';

/**
 * The bar a suppression region wears along its top edge.
 *
 * Chrome only: it decides *where* the controls go and *how wide* they are, and
 * hosts the region's move gesture. What is on it is the caller's business.
 *
 * It wears `.floating-toolbar` for its colour, border, radius and shadow, so it
 * matches every other floating control over the canvas by construction rather
 * than by copied values — the same borrowing `.cp-tool-option__header` does, and
 * for the same reason. Only its attachment to the region is local, and that is
 * {@link regionChipPlacement}. `box-sizing: border-box` is global, so the width
 * written here *is* the bar's outer width: it matches the region exactly, with
 * no allowance for the class's own padding to drift out of date.
 *
 * `flex-wrap` is the one rule it turns off. A pill wraps to a second row rather
 * than overflow its pane; a bar pinned to a box's edge must keep the box's
 * height relationship, so it ellipsizes its label instead. That also keeps the
 * height independent of the width, which is what makes the measurement below
 * safe.
 *
 * **The font size is set here, on the bar, and not on each text child.**
 * `.floating-toolbar` supplies colour and shape but no `font-size`, and nothing
 * above it does either — not `.cp-region-chip`, which has no stylesheet at all,
 * and not `html`/`body`/`#root` — so a child that does not name its own size
 * inherits the UA default and renders 16px beside its 11px siblings. That is not
 * hypothetical: `.cp-tool-option__header` records the same inheritance shipping
 * as a measured 39% size regression, and the hidden-findings count on this bar
 * did it again. Setting it once here is what stops the next child repeating it.
 *
 * Body-portaled like every other canvas toolbar, so it escapes transformed
 * Dockview ancestors — which is also why the wheel has to be forwarded by hand:
 * a scroll over the bar has no DOM path to the canvas it is hovering over, and
 * a trackpad pinch left unclaimed zooms the whole page.
 */
export interface CpRegionChipBarProps {
  /** The region's box, projected through the live camera to place the bar. */
  box: AnnotationBox;
  /** Element the canvas is positioned against — the anchor's viewport offset. */
  container: HTMLElement | null;
  ariaLabel: string;
  /** Press to select, drag to move. See {@link useCpRegionChipDrag}. */
  drag: CpRegionChipDragHandlers;
  children: ReactNode;
}

export function CpRegionChipBar({
  box,
  container,
  ariaLabel,
  drag,
  children,
}: CpRegionChipBarProps) {
  // Subscribed here, not in the panel: this bar re-renders per camera frame so
  // it tracks its box, while the (huge) panel does not.
  const anchorRect = useCanvasObjectAnchor(box, 'model', container);
  // State rather than a ref: the wheel listener and the height measurement both
  // have to re-run when the element arrives, which a ref would not report.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState<number | null>(null);

  // Measured, because the bar sits *above* its region and only its own height
  // says where that is. Deferred through `observeResizeDeferred` on principle —
  // this callback writes no size, but a resize callback that lands in the same
  // delivery pass is what produces the browser's undelivered-notifications
  // error, and that error reaches this app as a background-error toast.
  useLayoutEffect(() => {
    if (!bar) {
      setBarHeight(null);
      return undefined;
    }
    const measure = () => {
      const { height } = bar.getBoundingClientRect();
      setBarHeight((current) => (current === height ? current : height));
    };
    measure();
    return observeResizeDeferred(bar, measure);
  }, [bar]);

  useWheelPassthrough(bar, resolveCpViewportCanvas);

  const boundaryRect = container?.getBoundingClientRect();
  const placement =
    anchorRect && boundaryRect
      ? regionChipPlacement(anchorRect, boundaryRect, barHeight ?? 0)
      : null;
  // Gone with its region: once the box has left the pane, what is left is a bar
  // hovering over a neighbouring pane attached to nothing on screen.
  if (!placement) return null;

  return (
    <FloatingPortal>
      <div
        ref={setBar}
        className="floating-toolbar cp-region-chip"
        role="toolbar"
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          width: `${placement.width}px`,
          flexWrap: 'nowrap',
          gap: 6,
          // See the note above. Buttons are unaffected either way — `.ui-control--sm`
          // sizes in `rem`, so it is anchored to the root and not to this bar.
          fontSize: 11,
          lineHeight: 1.4,
          // The bar *is* the region's handle — see `useCpRegionChipDrag`.
          cursor: 'move',
          // A drag on the bar must not also scroll or select: `touch-action`
          // stops the browser claiming the gesture on a touch device, and
          // `user-select` stops a move turning the label blue on the way.
          touchAction: 'none',
          userSelect: 'none',
          // Hidden for the single frame before the height lands, so the bar is
          // never seen at the unplaced offset.
          visibility: barHeight === null ? 'hidden' : 'visible',
        }}
        {...drag}
      >
        {children}
      </div>
    </FloatingPortal>
  );
}
