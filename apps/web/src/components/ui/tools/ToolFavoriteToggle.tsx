/**
 * The star beside a tool row in the phone tool sheet (`ToolPickerRow`'s
 * `leading`), for a workspace whose tools can be favorited: Edit's and Fold's.
 *
 * # Not an `IconButton`
 *
 * Which looks like the obvious reuse and is the wrong call twice over.
 * `IconButton` carries `useTouchLabel` internally, so it answers a press-and-
 * hold by naming itself — and this star sits four pixels from a row that already
 * spells the tool's name in plain text, so there is nothing to reveal. Worse, on
 * the favorites list that same hold is the reorder gesture, and two hold
 * handlers on overlapping targets is a race rather than a feature.
 *
 * # A sibling of the row's button, never a child
 *
 * The row used to be one `<button>` end to end. A control nested inside it is
 * invalid HTML and, in practice, the outer button takes the tap — so the star
 * would silently select the tool it was meant to star. The row is a flex
 * container now, and this and the select target are siblings inside it.
 *
 * `stopPropagation` on `pointerdown` for the same reason `DesignTabStrip`'s
 * close button does it: the row above owns a press-and-hold, and a press that
 * begins on the star is not the beginning of a drag.
 */
import { Star } from 'lucide-react';
import styles from './ToolFavoriteToggle.module.css';

export function ToolFavoriteToggle({
  label,
  favorited,
  onToggle,
}: {
  /**
   * The button's name, already localized and naming the tool ("Add Valley fold
   * to favorites"). Interpolated by the workspace, because icon-only means this
   * label is the only name the button has — and a sheet of rows would otherwise
   * hold a button per row all announcing "Add to favorites".
   */
  label: string;
  favorited: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.star}
      data-favorite-toggle=""
      aria-label={label}
      aria-pressed={favorited}
      data-favorited={favorited || undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        // The row behind this is also clickable, and selecting a tool closes the
        // sheet — so without this, starring anything ends the visit.
        event.stopPropagation();
        onToggle();
      }}
    >
      {/* One icon, two states. An outline that fills is the whole vocabulary
          here, and swapping between two different glyphs would read as two
          different controls. */}
      <Star size={16} fill={favorited ? 'currentColor' : 'none'} />
    </button>
  );
}
