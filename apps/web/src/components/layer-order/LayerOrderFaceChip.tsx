import type { ButtonHTMLAttributes } from 'react';
import styles from './LayerOrderFaceChip.module.css';

/** What a face chip says beside its letter: a pick (`--face-pick`), a clash (danger, with its dot), or nothing. */
export type LayerFaceChipTone = 'plain' | 'pick' | 'danger';

interface ChipLook {
  /** The face's letter; empty for a face that no longer exists, whose chip keeps its place. */
  readonly letter: string;
  readonly tone?: LayerFaceChipTone;
  /** The face no longer exists: a quieter chip with no letter. */
  readonly gone?: boolean;
  /** Under the inspector's quiet rows: a saved row that is not applied (Round4-States). */
  readonly dim?: boolean;
}

/**
 * A face's letter as text in the inspector (A3's face chip): the chip the
 * panes draw, in theme tokens, at the approved 24 × 20 px. A clash's carries
 * the list's dot before its letter, so it reads without hue (D20).
 */
export function LayerOrderFaceChip({ letter, tone = 'plain', gone = false, dim = false }: ChipLook) {
  return (
    <span className={styles.chip} data-tone={tone} data-gone={gone || undefined} data-dim={dim || undefined} aria-hidden="true">
      {tone === 'danger' && <span className={styles.dot} />}
      {letter}
    </span>
  );
}

/**
 * A face chip that is a button: an object in the builder (A5), whose press
 * removes it. On hover or focus a diagonal strike crosses it, over a quieter
 * letter, and its size never changes. Named by what it does ("Remove H").
 */
export function LayerOrderFaceChipButton({
  letter,
  tone = 'pick',
  ...props
}: ChipLook & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  return (
    <button type="button" className={styles.chip} data-tone={tone} data-button="" {...props}>
      {tone === 'danger' && <span className={styles.dot} aria-hidden="true" />}
      {letter}
    </button>
  );
}
