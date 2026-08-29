import { useRef, type MouseEvent } from 'react';

/** Any field whose whole value a click should replace. */
type SelectableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Make clicking into a text field select its whole value, so typing replaces it.
 *
 * `onFocus` + `select()` is enough for the keyboard — Tab arrives focused and
 * selected — and is silently undone by a mouse: the click focuses the field,
 * the selection is made, and then `mouseup` collapses it to a caret where the
 * pointer landed. Which is why a numeric readout you meant to overwrite ends up
 * appending to.
 *
 * So the repair belongs on `mouseup`, and only there. Two conditions keep it
 * from taking over the field:
 *
 * - **only the click that did the focusing**, so a second click inside an
 *   already-focused field places a caret like anywhere else; and
 * - **only when nothing was dragged**, so selecting three characters by hand is
 *   respected rather than being widened to everything.
 *
 * Mouse events rather than pointer ones on purpose: this repairs a
 * mouse-specific interaction, and a touch tap into a field has its own
 * platform-owned selection behaviour that is not ours to override.
 */
export function useSelectAllOnClick() {
  const focusedByThisClick = useRef(false);

  return {
    onMouseDown: (event: MouseEvent<SelectableField>) => {
      focusedByThisClick.current = document.activeElement !== event.currentTarget;
    },
    onMouseUp: (event: MouseEvent<SelectableField>) => {
      if (!focusedByThisClick.current) return;
      focusedByThisClick.current = false;
      const field = event.currentTarget;
      if (field.selectionStart !== field.selectionEnd) return;
      field.select();
    },
  };
}
