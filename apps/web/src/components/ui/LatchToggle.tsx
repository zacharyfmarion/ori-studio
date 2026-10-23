import type { ReactNode } from 'react';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { Button } from './Button';
import styles from './LatchToggle.module.css';

/**
 * A modifier key as a latch, for a device without the key: on until switched
 * off, because there is no "held" on a touchscreen. Edit's Shift latch
 * ("Add to selection") and the Fold canvas's Alt latch ("Free point") are
 * this button; each names it for what it does, since a key's name means
 * nothing without a keyboard, and owns the latch state it shows.
 *
 * Coarse pointers only, and there is no fine-pointer counterpart: a keyboard
 * already has the key. Never a teardown here: both latches answer "a fine
 * pointer never sees a latch" in their own read, for every reader, whatever is
 * mounted (`shiftLatch.ts`).
 */
export function LatchToggle({
  label,
  icon,
  latched,
  onToggle,
  fill = false,
  data,
}: {
  label: string;
  icon: ReactNode;
  latched: boolean;
  onToggle: (next: boolean) => void;
  /** Across its row: a rail's touch header, a tool sheet. */
  fill?: boolean;
  /** The data attribute a test or a caller finds it by. */
  data?: Readonly<Record<`data-${string}`, string>>;
}) {
  const coarse = useIsCoarsePointerSurface();
  if (!coarse) return null;
  return (
    <Button
      size="md"
      variant="ghost"
      className={styles.latch}
      data-fill={fill || undefined}
      aria-pressed={latched}
      isActive={latched}
      onClick={() => onToggle(!latched)}
      {...data}
    >
      {icon}
      {label}
    </Button>
  );
}
