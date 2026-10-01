import { forwardRef, type HTMLAttributes } from 'react';
import styles from './Toolbar.module.css';

/**
 * A floating bar of controls: the bottom bar over a canvas
 * (`ViewportToolbar`), and the bars that float beside what they act on.
 *
 * The chrome is one thing, so every bar wears the same ground, border, shadow
 * and radius, and the radius stays concentric with the controls inside it. Where
 * a bar sits is its owner's: pass a `className`, which lands on the root and is
 * for placement only (`docs/styling.md`, rule 3).
 *
 * `role="toolbar"` by default, so a bar is found and named by its role.
 */
export const Toolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Toolbar({ className, role = 'toolbar', ...props }, ref) {
    return (
      <div
        ref={ref}
        role={role}
        className={className ? `${styles.bar} ${className}` : styles.bar}
        {...props}
      />
    );
  }
);

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
