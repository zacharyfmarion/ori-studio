/**
 * Marks the tool window's layer controls — the layer picker and the flap
 * chips — where a fold's two steps meet: "Pick which layers move", then
 * "Press Enter to fold". Enter there is the canvas's, which commits
 * (`focusLeavesEnterToFold`); Space is the control's, which picks.
 *
 * One marker and one predicate, so the keys cannot disagree on where the
 * layer controls are.
 */
export const FOLD_LAYER_PICK_ATTRIBUTE = 'data-fold-layer-pick';

/** Whether focus is in the tool window's layer controls ({@link FOLD_LAYER_PICK_ATTRIBUTE}). */
export function focusInFoldLayerPick(element: Element | null): boolean {
  return element !== null && element.closest(`[${FOLD_LAYER_PICK_ATTRIBUTE}]`) !== null;
}
