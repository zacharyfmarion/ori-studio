/**
 * The phone layout's tool sheet: every tool, named, for a device that cannot
 * summon a tooltip and has no room for a rail. The chrome only — the dialog,
 * its backdrop, the header and the scrolling body. What the body lists is the
 * workspace's: Edit's catalogue with its line types and favorites, Simulate's
 * handful of tools.
 *
 * Rendered by a workspace's Tools pill (`ToolsTriggerButton`) and portaled to
 * `document.body` by it. See `useToolPickerSheet` for opening, closing and the
 * keyboard.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../IconButton';
import styles from './ToolPickerSheet.module.css';

export function ToolPickerSheet({
  pickerId,
  title,
  closeLabel,
  close,
  modes,
  children,
}: {
  /** DOM id the trigger points `aria-controls` at, and this dialog wears. */
  pickerId: string;
  title: string;
  closeLabel: string;
  close: () => void;
  /**
   * A mode rather than a tool (Edit's Shift latch), above the list and outside
   * it — and unlike a tool it does not close the sheet, because reaching it
   * costs two taps here and toggling it twice should not cost four.
   */
  modes?: ReactNode;
  children: ReactNode;
}) {
  // Focus the sheet itself, the way the View drawer does and for the same
  // reason: `aria-modal` hides everything outside this dialog from a screen
  // reader, so focus left on the trigger behind it sits on a node VoiceOver no
  // longer sees — nothing is announced and the tool list is reachable only by
  // exploring the screen. Focusing the container rather than the first row
  // announces what opened before it starts reading the list.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  return (
    <div
      id={pickerId}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={styles.picker}
      /*
        `click`, not `pointerdown` — the same retargeting hazard the View
        drawer documents. Dismissing on `pointerdown` unmounts the backdrop
        inside the commit, and the rest of the gesture is delivered to
        whatever is newly underneath: measured on an iPad, the tap that closed
        a sheet also changed the active tool on the rail behind it.
      */
      onClick={close}
    >
      <div
        ref={sheetRef}
        role="document"
        tabIndex={-1}
        className={styles.sheet}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.title}>{title}</span>
          <IconButton size="sm" aria-label={closeLabel} onClick={close}>
            <X size={15} />
          </IconButton>
        </header>
        {modes && <div className={styles.modes}>{modes}</div>}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
