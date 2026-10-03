import type { ReactNode } from 'react';
import { FloatingPortal, type Placement } from '@floating-ui/react';
import { useWheelPassthrough } from '../../hooks/useWheelPassthrough';
import { CANVAS_COMPANION_PROPS } from '../../cp-workspace/canvasObjects/canvasCompanionSurface';
import { Toolbar } from './Toolbar';
import { useAnchoredFloating, type FloatingAnchorRect } from './useAnchoredFloating';
import styles from './FloatingToolbar.module.css';

export type { FloatingAnchorRect } from './useAnchoredFloating';

export interface FloatingToolbarProps {
  /** Anchor in viewport CSS px; the toolbar hides while this is null. */
  anchorRect: FloatingAnchorRect | null;
  /**
   * Preferred side; flips automatically on collision. Defaults to `'top-start'`
   * — the toolbar lines up with the object's leading edge rather than centring
   * on it, so it stays put as the object resizes and reads as belonging to it.
   */
  placement?: Placement;
  /** Gap between the anchor and the toolbar, in px. Defaults to 8. */
  offset?: number;
  /**
   * The element the toolbar must stay inside; omitted, the browser window. See
   * `useAnchoredFloating` for why a toolbar over a docked pane passes the pane.
   */
  boundary?: Element | null;
  /**
   * The surface this toolbar is floating over, for wheel gestures. Supplied, a
   * scroll or pinch that lands on the toolbar is forwarded there instead of
   * reaching the browser — which would otherwise zoom the whole page, since a
   * toolbar hovering over a canvas has nothing else to do with a wheel. Omitted,
   * the wheel is left entirely alone, so a toolbar over ordinary scrollable
   * content still scrolls it.
   */
  wheelTarget?: () => Element | null | undefined;
  ariaLabel?: string;
  className?: string;
  /**
   * The toolbar's inset around its controls, in px (see `Toolbar`). 0 for a
   * popover whose content brings its own padding: the corners then fall back to
   * the shared radius.
   */
  inset?: number;
  children: ReactNode;
}

/**
 * Narrowest the pill may be squeezed to before it is allowed to overflow its
 * boundary instead. Below this the controls stop being hittable, at which point
 * respecting the boundary has cost more than it bought.
 */
const MIN_TOOLBAR_WIDTH = 96;

/**
 * A generic floating toolbar: a portaled, collision-aware pill that hovers over
 * an arbitrary anchor rectangle. It flips to the opposite side and shifts along
 * the axis to stay inside its {@link FloatingToolbarProps.boundary}, so it works
 * against a pane edge as well as a screen edge — the placement is
 * `useAnchoredFloating`'s, and the chrome the shared `Toolbar`'s. Body-portaled
 * so it escapes transformed/`will-change` ancestors (e.g. Dockview panels),
 * matching {@link ContextMenu}'s rationale.
 *
 * Presentational only — compose the actual controls as children.
 */
export function FloatingToolbar({
  anchorRect,
  placement = 'top-start',
  offset = 8,
  boundary,
  wheelTarget,
  ariaLabel,
  className,
  inset,
  children,
}: FloatingToolbarProps) {
  const { setFloating, floating, style, visible } = useAnchoredFloating({
    anchorRect,
    placement,
    offset,
    boundary,
    minWidth: MIN_TOOLBAR_WIDTH,
  });

  useWheelPassthrough(floating, wheelTarget);

  if (!visible) return null;

  return (
    <FloatingPortal>
      <Toolbar
        ref={setFloating}
        tone="raised"
        wrap="always"
        inset={inset}
        className={className ? `${styles.placement} ${className}` : styles.placement}
        aria-label={ariaLabel}
        // A floating toolbar over the canvas edits what is selected there, so a
        // press or a focus move into it must not read as leaving the selection.
        {...CANVAS_COMPANION_PROPS}
        style={style}
      >
        {children}
      </Toolbar>
    </FloatingPortal>
  );
}
