/**
 * The floating window the active tool's hint and settings are shown in — the
 * chrome only. What goes inside it is the workspace's business: Edit's
 * `CpContextToolPanel`, Simulate's `SimulatorToolWindow`.
 *
 * # Why it is portaled and fixed
 *
 * It floats over the bottom right of a workspace's viewport and deliberately
 * overhangs the seam between the viewport and the side pane docked beside it;
 * see {@link toolHintPlacement} for why the overhang is the point rather than a
 * detail. Straddling that seam rules out being a child of either side — Edit's
 * `.cp-panel__viewport` is `overflow: hidden`, `.panel-body` is `overflow: auto`,
 * and Dockview panels trap `fixed` descendants. So it goes to `document.body`
 * and is positioned from a measured rect, the way every other floating surface
 * on a canvas already is.
 *
 * Portal events still bubble through the React tree, and the window stops only
 * `pointerdown` and `click`. Mount it outside any element with a handler that
 * should not hear the rest — a viewport's `onContextMenu`, say.
 *
 * # Why the chrome is separate from the content
 *
 * Positioning, collapse and the header are one concern — a window — and they are
 * the same for whatever the tool has to say. Keeping them here means each
 * workspace's content component is the tool's content and nothing else.
 */
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useToolHintAnchor } from './useToolHintAnchor';
import { useToolHintCollapsed } from './useToolHintCollapsed';
import styles from './ToolHintWindow.module.css';
import { useAnimatedHeight } from '../../../hooks/useAnimatedHeight';

export function ToolHintWindow({
  container,
  collapseKey,
  title,
  meta,
  ariaLabel,
  headerAction,
  children,
}: {
  /**
   * The viewport element the window anchors to. Its right edge is the seam with
   * the side pane, which is the whole placement rule.
   */
  container: HTMLElement | null;
  /**
   * The `STORAGE_KEYS` entry the collapsed state is kept under — one per
   * workspace, so collapsing Edit's window leaves Simulate's alone.
   */
  collapseKey: string;
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
  const [collapsed, setCollapsed] = useToolHintCollapsed(collapseKey);
  const placement = useToolHintAnchor(container);
  const { attachFrame, attachContent, attachScroller, closing } = useAnimatedHeight({
    collapsed,
  });

  // No rect yet, or a viewport that is laid out but not displayed. Rendering
  // unpositioned would park the window in the corner of the screen for a frame.
  if (!placement) return null;
  // A collapse keeps the body until the window has closed over it.
  const bodyMounted = !collapsed || closing;

  return createPortal(
    <section
      ref={attachFrame}
      className={styles.window}
      data-collapsed={collapsed || undefined}
      style={{ left: placement.left, bottom: placement.bottom, width: placement.width }}
      aria-label={ariaLabel}
      // Portaled out of the panel, so these no longer shield the window from the
      // panel body — they shield the canvas from clicks landing on the window,
      // which is now directly over it.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className={styles.header}
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{meta}</span>
      </button>
      {/* Always mounted, so the header reserves its gutter only while the
          action actually renders something (`:has()` in the module). */}
      <div className={styles.action} data-header-action="">
        {headerAction}
      </div>
      {bodyMounted && (
        <div
          ref={attachScroller}
          className={styles.body}
          inert={closing}
          aria-hidden={closing || undefined}
        >
          <div ref={attachContent} className={styles.content}>
            {children}
          </div>
        </div>
      )}
    </section>,
    document.body
  );
}
