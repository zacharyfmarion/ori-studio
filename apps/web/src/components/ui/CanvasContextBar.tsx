import type { HTMLAttributes } from 'react';
import styles from './CanvasContextBar.module.css';

type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className'>;

/**
 * A bar of fields floating at the top centre of a design canvas, for what is
 * selected on it: a box-pleating tree edge's length, a flap's name and size, a
 * stretch's pattern.
 *
 * A `group`, so pass the `aria-label` that says what it edits. The fields are
 * the owner's; the bar's own parts are the title and the labels below.
 */
export function CanvasContextBar(props: Omit<HTMLAttributes<HTMLDivElement>, 'className'>) {
  return <div role="group" className={styles.bar} {...props} />;
}

/**
 * What the bar edits: "Edge 1 to 2", "Stretch K and M". The one part that gives
 * way when the bar runs out of room, so where the text can be long (a flap is
 * named anything) pass the whole of it as `title` too.
 */
export function CanvasContextBarTitle(props: SpanProps) {
  return <span className={styles.title} {...props} />;
}

/** A field's name, beside it. */
export function CanvasContextBarLabel(props: SpanProps) {
  return <span className={styles.label} {...props} />;
}
