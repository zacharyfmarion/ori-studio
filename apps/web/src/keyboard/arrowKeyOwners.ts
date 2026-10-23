/**
 * Whether the focused control keeps the arrow keys for itself: the one test a
 * workspace scope that moves between steps on ←/→ (the Diagram's, Fold's)
 * asks before it claims an arrow, so a tab strip, a segmented control or a
 * slider keeps its own navigation wherever it sits.
 *
 * Pure DOM queries: no store, no React.
 */

/**
 * Marks a control that moves with the arrow keys and Home and End without a
 * role that says so: the Diagram's pattern picker list. A listbox is not an
 * owner by its role, because a steps grid is one, and its arrows are its
 * workspace's.
 */
export const OWN_ARROWS_ATTRIBUTE = 'data-own-arrows';

/**
 * Controls that use the arrow keys themselves. A plain button is not one: its
 * arrows do nothing, and declining there would leave ← dead after a press on
 * Add step. Nor is a toolbar: none of the app's moves focus with the arrows,
 * and a slider or segmented control inside one declines through its own role.
 *
 * Fields and open menus are not listed: the dispatcher stands down for them
 * before any executor runs (`isShortcutEditingTarget`, `isOpenLayerTarget`).
 */
const ARROW_OWNERS = [
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="menubar"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  `[${OWN_ARROWS_ATTRIBUTE}]`,
].join(', ');

/** Whether the focused element keeps the arrow keys for itself. */
export function focusOwnsArrowKeys(element: Element | null): boolean {
  return element !== null && element.closest(ARROW_OWNERS) !== null;
}
