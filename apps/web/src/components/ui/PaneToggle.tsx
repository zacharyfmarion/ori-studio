import { forwardRef } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import styles from './PaneToggle.module.css';

/** One of the panes a phone shows one at a time. */
export interface PaneToggleOption<Id extends string = string> {
  id: Id;
  /** Its name, which is also the pill's label while it is the other one. */
  title: string;
}

export interface PaneToggleProps<Id extends string = string> {
  /** The two panes. With more, the pill offers the first that is not on screen. */
  options: readonly PaneToggleOption<Id>[];
  /** The one on screen. */
  active: Id;
  onShow: (id: Id) => void;
}

/**
 * Two panes on a phone, one at a time, and the pill that swaps them.
 *
 * Labelled with the pane you are *not* looking at: for two, the pill is the
 * switch, so getting there is one tap and the label says where it goes. A
 * segmented control would say the same at twice the width, on a screen that is
 * already spending a quarter of its height on chrome.
 *
 * A pill for `CanvasPillLane`, which exists only under a coarse pointer, and
 * the lane is where the caller mounts it. Presentation only: which panes, which
 * is on screen and what showing one means are the caller's.
 */
export function PaneToggle<Id extends string>({ options, active, onShow }: PaneToggleProps<Id>) {
  const other = options.find((option) => option.id !== active) ?? options[0];
  if (!other) return null;
  return (
    <PanePill onClick={() => onShow(other.id)}>
      <ArrowLeftRight size={15} aria-hidden="true" />
      {other.title}
    </PanePill>
  );
}

/**
 * The pill a pane switch wears in the canvas lane: the lane's shared
 * `canvas-pill` look, with a label capped so a long pane name truncates rather
 * than pushing the lane's other pills off the row. {@link PaneToggle}'s, and
 * the trigger of a list for a caller with more panes than a toggle can swap.
 */
export const PanePill = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'size' | 'variant' | 'className'>
>((props, ref) => (
  <Button
    ref={ref}
    size="md"
    variant="secondary"
    className={`canvas-pill ${styles.pill}`}
    {...props}
  />
));

PanePill.displayName = 'PanePill';
