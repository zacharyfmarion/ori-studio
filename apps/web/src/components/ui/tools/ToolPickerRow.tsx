/**
 * One tool in the phone tool sheet: a glyph, a name and a description, and
 * optionally something before them (Edit's favorite star).
 *
 * # Two buttons, not one
 *
 * The row was a single `<button>` end to end until Edit's star arrived. A
 * control nested inside a button is invalid HTML and the outer one takes the tap
 * in practice, so a star would select the tool it was meant to star. The `<li>`
 * is the flex container, `leading` and the select target are siblings in it,
 * and the active treatment lives on the row — otherwise its left bar would draw
 * between the star and the glyph rather than at the row's edge.
 *
 * No keyboard shortcut is shown: this is the phone surface, and a `kbd` badge
 * would spend width on the narrowest screen to name a chord nothing on the
 * device can press.
 */
import type { ReactNode } from 'react';
import type { LongPressReorder } from '../../../hooks/useLongPressReorder';
import styles from './ToolPickerRow.module.css';

export interface ToolPickerRowReorder {
  handlers: LongPressReorder['handlers'];
  dragging: boolean;
  /** True for the click that ends a drag — see {@link LongPressReorder.consumeClick}. */
  consumeClick: () => boolean;
}

export function ToolPickerRow({
  label,
  description,
  glyph,
  isActive,
  available,
  leading,
  onSelect,
  reorder,
  data,
}: {
  label: string;
  /** The one-line description a tooltip carries on a fine pointer. */
  description: string;
  glyph: ReactNode;
  isActive: boolean;
  available: boolean;
  /** Before the select target, as a sibling of it — never a child. */
  leading?: ReactNode;
  onSelect: () => void;
  /** Present only in a list that can be reordered. */
  reorder?: ToolPickerRowReorder;
  /** Data attributes for the row, such as the one a reorder hook finds rows by. */
  data?: Record<`data-${string}`, string | undefined>;
}) {
  return (
    <li
      className={styles.row}
      data-tool-row=""
      data-active={isActive || undefined}
      data-dragging={reorder?.dragging || undefined}
      {...data}
      {...reorder?.handlers}
    >
      {leading}
      <button
        type="button"
        className={styles.item}
        data-tool-item=""
        aria-disabled={!available}
        onClick={() => {
          // A press that became a drag is not also a selection. Without this,
          // holding a row to move it picks that tool and closes the sheet the
          // moment you let go.
          if (reorder?.consumeClick()) return;
          if (!available) return;
          onSelect();
        }}
      >
        <span className={styles.icon}>{glyph}</span>
        <span className={styles.text}>
          <span className={styles.label} data-tool-label="">
            {label}
          </span>
          <span className={styles.hint}>{description}</span>
        </span>
      </button>
    </li>
  );
}
