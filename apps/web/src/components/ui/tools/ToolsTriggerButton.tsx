/**
 * The phone layout's Tools pill: where a workspace's tools go once the rail is
 * gone, opening its `ToolPickerSheet`.
 *
 * The glyph is the **active tool's**, not a generic wrench, because that is the
 * question the button has to answer without being pressed: on a rail you can
 * see which button is lit, and with the rail gone the only place left to say
 * what the next tap on the canvas will do is here.
 *
 * It wears the pill look the other touch pills share (`canvas-pill`), so it
 * reads as one of them beside View or Settings wherever a workspace seats it.
 */
import type { ReactNode, RefObject } from 'react';
import { Button } from '../Button';
import styles from './ToolsTriggerButton.module.css';

export function ToolsTriggerButton({
  label,
  glyph,
  open,
  pickerId,
  onOpen,
  triggerRef,
}: {
  label: string;
  /** The active tool's mark; drawn in a fixed box so any glyph sits on the label's line. */
  glyph: ReactNode;
  open: boolean;
  /** The sheet's id, which `aria-controls` points at. */
  pickerId: string;
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Button
      ref={triggerRef}
      size="md"
      variant="secondary"
      className="canvas-pill"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={pickerId}
      onClick={onOpen}
    >
      {glyph && (
        <span className={styles.glyph} data-tool-trigger-glyph="">
          {glyph}
        </span>
      )}
      {label}
    </Button>
  );
}
