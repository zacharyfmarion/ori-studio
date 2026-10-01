import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import styles from './Toolbar.module.css';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `overlay`: see-through, over a canvas — the bottom bar of view controls.
   * `raised`: solid, beside what it acts on — the selection toolbar and its kin.
   */
  tone?: 'overlay' | 'raised';
  /**
   * `touch`: one line on a pointer device, wrapping between groups on touch.
   * `always`: wraps wherever it has to, for a bar capped to a boundary.
   */
  wrap?: 'touch' | 'always';
  /** Sits on top of a frame: the edge it shares with it is square. */
  attach?: 'bottom';
  /**
   * The inset around the controls, in px, the same on every side. The corner
   * radius follows it, concentric with the controls at the bar's ends; 0 makes
   * the bar a plain panel at the shared radius. Text at an end brings its own
   * inset, since the bar's is sized for buttons.
   */
  inset?: number;
}

/**
 * A floating bar of controls: the bottom bar over a canvas
 * (`ViewportToolbar`), and the bars that float beside what they act on
 * (`FloatingToolbar`).
 *
 * The chrome is one thing, so every bar wears the same border, inset and
 * radius, and the radius stays concentric with the controls inside it. Where a
 * bar sits is its owner's: pass a `className`, which lands on the root and is
 * for placement only (`docs/styling.md`, rule 3).
 *
 * `role="toolbar"` by default, so a bar is found and named by its role.
 */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { className, role = 'toolbar', tone = 'overlay', wrap = 'touch', attach, inset, style, ...props },
  ref
) {
  const insetStyle =
    inset === undefined ? style : ({ ...style, '--pad': `${inset}px` } as CSSProperties);
  return (
    <div
      ref={ref}
      role={role}
      className={className ? `${styles.bar} ${className}` : styles.bar}
      data-tone={tone}
      data-wrap={wrap}
      data-attach={attach}
      style={insetStyle}
      {...props}
    />
  );
});

/**
 * A run of controls that wraps as a unit. On a pointer device it is structure
 * only; on a coarse one a line break may fall between groups, never inside one.
 */
export function ToolbarGroup(props: Omit<HTMLAttributes<HTMLDivElement>, 'className'>) {
  return <div className={styles.group} {...props} />;
}

/** The hairline between two groups. Gone on a coarse pointer, where the gap does its job. */
export function ToolbarSeparator() {
  return <span className={styles.separator} role="separator" aria-orientation="vertical" />;
}
