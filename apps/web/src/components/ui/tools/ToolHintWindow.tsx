/**
 * The floating window the active tool's hint and settings are shown in — the
 * window only. What goes inside it is the workspace's business: Edit's
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
 * # Why the window is separate from the content
 *
 * Positioning and collapse are one concern — a window — and they are the same
 * for whatever the tool has to say. Keeping them here means each workspace's
 * content component is the tool's content and nothing else, and it means the
 * placement rule, the collapse preference and the window that uses them sit
 * together in this directory rather than being spread across panel files.
 *
 * How the window looks is `FloatingPanel`'s, shared with the other windows over
 * the canvas — the crease-angle popover offers the same presets the fold-angle
 * group does in Edit's window, and has to read as the same kind of thing.
 */
import { createPortal } from 'react-dom';
import { useCallback, useState, type ReactNode } from 'react';
import { useToolHintAnchor } from './useToolHintAnchor';
import { useToolHintCollapsed } from './useToolHintCollapsed';
import styles from './ToolHintWindow.module.css';
import { useAnimatedHeight } from '../../../hooks/useAnimatedHeight';
import { FloatingPanel, FloatingPanelBody, FloatingPanelHeader } from '../FloatingPanel';

export function ToolHintWindow({
  container,
  collapseKey,
  title,
  meta,
  ariaLabel,
  headerAction,
  inside = false,
  startsCollapsed = false,
  collapsible = true,
  needsAttention = false,
  height = 'default',
  onFrame,
  startKey,
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
  /**
   * Kept on the viewport's side of the seam rather than over it, where the
   * pane beyond has fields the overhang would cover (`toolHintPlacement`).
   */
  inside?: boolean;
  /**
   * Collapsed until someone opens it, rather than open until someone closes it
   * (`useToolHintCollapsed`'s fallback): for a window that would otherwise
   * cover what the tool works on.
   */
  startsCollapsed?: boolean;
  /** Required decision surfaces remain open. */
  collapsible?: boolean;
  /**
   * The tool has something to decide that is in the body — a fold ready to
   * commit. A window collapsed by preference opens for it, and a toggle while
   * it lasts opens or closes the window for this decision only, never the
   * preference; once the need passes, the window is as the preference says.
   */
  needsAttention?: boolean;
  /**
   * How tall the open window may grow: `default`, most of the viewport;
   * `capped`, about a third of it, the body scrolling — for a tool whose
   * work is on the canvas beneath, so the paper stays in view while the
   * window is open (a phone's Fold canvas).
   */
  height?: 'default' | 'capped';
  /**
   * Handed the window's frame as it mounts, and null as it goes: for a
   * workspace that keeps what it draws out from under the window — Fold's
   * phone pane fits its paper above it. Stable, or the frame is handed over
   * again on every render.
   */
  onFrame?: (frame: HTMLElement | null) => void;
  /**
   * What the window is showing — Fold's tool and the step it is at. A new
   * one, and the window opening, show the body from its top, its first
   * instruction in view (`useAnimatedHeight`). Without one, a body that
   * outgrows the window keeps its bottom in view, as it always has.
   */
  startKey?: string;
  children: ReactNode;
}) {
  const [preferCollapsed, setPreferCollapsed] = useToolHintCollapsed(collapseKey, startsCollapsed);
  // Closed again for the decision in hand; forgotten with it.
  const [dismissed, setDismissed] = useState(false);
  if (!needsAttention && dismissed) setDismissed(false);
  const attending = needsAttention && preferCollapsed;
  const collapsed = collapsible && (attending ? dismissed : preferCollapsed);
  const setCollapsed = (next: boolean) => {
    if (attending) {
      setDismissed(next);
      return;
    }
    setPreferCollapsed(next);
    // Collapsed mid-decision from open: closed for this decision too, or the
    // decision would open it again the moment the preference changed.
    if (needsAttention) setDismissed(next);
  };
  const placement = useToolHintAnchor(container, inside);
  const { attachFrame, attachContent, attachScroller, closing } = useAnimatedHeight({
    collapsed,
    ...(startKey !== undefined ? { startKey } : {}),
  });
  const frameRef = useCallback(
    (frame: HTMLElement | null) => {
      attachFrame(frame);
      onFrame?.(frame);
    },
    [attachFrame, onFrame]
  );

  // No rect yet, or a viewport that is laid out but not displayed. Rendering
  // unpositioned would park the window in the corner of the screen for a frame.
  if (!placement) return null;
  // A collapse keeps the body until the window has closed over it.
  const bodyMounted = !collapsed || closing;

  return createPortal(
    <FloatingPanel
      ref={frameRef}
      className={styles.window}
      // Pinned by its bottom edge, so it grows and shrinks at the top.
      pin="bottom"
      data-collapsed={collapsed || undefined}
      data-height={height === 'default' ? undefined : height}
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
        onCollapsedChange={collapsible ? setCollapsed : undefined}
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
