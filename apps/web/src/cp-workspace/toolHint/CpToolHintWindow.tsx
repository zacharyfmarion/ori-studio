/**
 * The floating window the active tool's hint and settings are shown in — the
 * window only. What goes inside it is `CpContextToolPanel`'s business.
 *
 * # Why it is portaled and fixed
 *
 * It floats over the bottom right of the Edit workspace and deliberately
 * overhangs the seam between the crease-pattern viewport and the View pane; see
 * {@link cpToolHintPlacement} for why the overhang is the point rather than a
 * detail. Straddling that seam rules out being a child of either side —
 * `.cp-panel__viewport` is `overflow: hidden`, `.panel-body` is `overflow: auto`,
 * and Dockview panels trap `fixed` descendants. So it goes to `document.body`
 * and is positioned from a measured rect, the way every other floating surface
 * on this canvas already is.
 *
 * The hint used to portal into a slot *inside* the View pane, which made it a
 * section of that pane in everything but name: below the fold, indistinguishable
 * from the grid and line-width controls stacked above it, and gone entirely
 * whenever the pane was closed.
 *
 * # Why the window is separate from the content
 *
 * Positioning and collapse are one concern — a window — and they are the same
 * for whatever the tool has to say. Keeping them here means
 * `CpContextToolPanel` is the tool's content and nothing else, and it means the
 * placement rule, the collapse preference and the window that uses them sit
 * together in this directory rather than being spread across a panel file.
 *
 * How the window looks is `FloatingPanel`'s, shared with the other windows over
 * the canvas — the crease-angle popover offers the same presets the fold-angle
 * group does here, and has to read as the same kind of thing.
 */
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useCpToolHintAnchor } from './useCpToolHintAnchor';
import { useCpToolHintCollapsed } from './useCpToolHintCollapsed';
import styles from './CpToolHintWindow.module.css';
import { useAnimatedHeight } from '../../hooks/useAnimatedHeight';
import {
  FloatingPanel,
  FloatingPanelBody,
  FloatingPanelHeader,
} from '../../components/ui/FloatingPanel';

export function CpToolHintWindow({
  container,
  title,
  meta,
  ariaLabel,
  headerAction,
  children,
}: {
  /**
   * The crease-pattern viewport element the window anchors to. Its right edge is
   * the seam with the View pane, which is the whole placement rule.
   */
  container: HTMLElement | null;
  /** The active tool, named in the header so a collapsed window still says what it is for. */
  title: string;
  /** What is inside, in a word — a setting count, or "Instructions". */
  meta: string;
  ariaLabel: string;
  /**
   * Rendered as a sibling of the header, for chrome that belongs to the window
   * rather than to its content. The reset control is positioned into the
   * header's right-hand gutter this way.
   */
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useCpToolHintCollapsed();
  const placement = useCpToolHintAnchor(container);
  const { attachFrame, attachContent, attachScroller, closing } = useAnimatedHeight({
    collapsed,
  });

  // No rect yet, or a viewport that is laid out but not displayed. Rendering
  // unpositioned would park the window in the corner of the screen for a frame.
  if (!placement) return null;
  // A collapse keeps the body until the window has closed over it.
  const bodyMounted = !collapsed || closing;

  return createPortal(
    <FloatingPanel
      ref={attachFrame}
      className={styles.window}
      // Pinned by its bottom edge, so it grows and shrinks at the top.
      pin="bottom"
      data-collapsed={collapsed || undefined}
      style={{ left: placement.left, bottom: placement.bottom, width: placement.width }}
      aria-label={ariaLabel}
      // Portaled out of the panel, so these no longer shield the window from the
      // panel body — they shield the canvas from clicks landing on the window,
      // which is now directly over it.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <FloatingPanelHeader
        title={title}
        meta={meta}
        action={headerAction}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
      {bodyMounted && (
        <FloatingPanelBody
          ref={attachScroller}
          contentRef={attachContent}
          inert={closing}
          aria-hidden={closing || undefined}
        >
          {children}
        </FloatingPanelBody>
      )}
    </FloatingPanel>,
    document.body
  );
}
