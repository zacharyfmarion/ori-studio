import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ControlVerb } from '../../lib/controlVerb';
import { IconButton } from './IconButton';
import styles from './Pager.module.css';

/**
 * What a pager steps through, its group's accessible name: the label of the
 * row it sits in, by that label's id, so a screen reader says it once
 * (`labelledBy`); or its own words, where nothing on screen names it (`label`).
 */
type PagerName = { labelledBy: string; label?: never } | { label: string; labelledBy?: never };

/**
 * ‹ where it stands ›: a value stepped through one at a time — a flat fold's
 * layer orders in the Diagram's Step pane and in Edit's Properties pane.
 *
 * A group named by what it steps, and its readout is announced as it
 * changes, so a press that lands on "3 of 5+" says so. Either verb may be
 * absent, which leaves its place empty. A verb that cannot act now is refused
 * rather than disabled (`aria-disabled`): it keeps the focus a press gave it
 * while what it started runs, or at either end, and its `run` is expected to
 * do nothing then. Its `hint` says why, in place of the label.
 */
export function Pager({
  previous,
  next,
  children,
  ...name
}: PagerName & {
  previous?: ControlVerb;
  next?: ControlVerb;
  /** Where it stands, between the two: "2 of 5+". */
  children: ReactNode;
}) {
  const naming = name.labelledBy ? { 'aria-labelledby': name.labelledBy } : { 'aria-label': name.label };
  return (
    <span className={styles.pager} role="group" {...naming}>
      {previous && <PagerButton verb={previous} icon={<ChevronLeft size={14} />} />}
      <span className={styles.label} aria-live="polite" aria-atomic="true">
        {children}
      </span>
      {next && <PagerButton verb={next} icon={<ChevronRight size={14} />} />}
    </span>
  );
}

function PagerButton({ verb, icon }: { verb: ControlVerb; icon: ReactNode }) {
  return (
    <IconButton
      size="sm"
      aria-label={verb.label}
      title={verb.disabled && verb.hint ? verb.hint : verb.label}
      aria-disabled={verb.disabled || undefined}
      onClick={verb.run}
    >
      {icon}
    </IconButton>
  );
}
