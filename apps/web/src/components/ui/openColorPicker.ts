/**
 * Open the engine's colour picker for `input`. `showPicker()` is the way to ask
 * for it; a synthetic click is what older engines answer to. Both need the user
 * activation the press that asked for it just supplied.
 *
 * `focusInput` puts the focus on the input first, for a caller that listens
 * for it to leave: a context menu's colour row commits on the input's blur
 * (`ContextMenuColorItem`). Without it the focus stays where the caller left
 * it. A hidden colour input types nothing, yet a focused input owns every key
 * (`isShortcutEditingTarget`), and the picker leaves the focus on it when it
 * closes: a caller with nothing to hear from a blur keeps the focus on its own
 * control (`DiagramColorSelect`).
 */
export function openColorPicker(input: HTMLInputElement, { focusInput = true }: { focusInput?: boolean } = {}): void {
  if (focusInput) input.focus();
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return;
    } catch {
      // Fall through to the click.
    }
  }
  input.click();
}
