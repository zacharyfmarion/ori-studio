import type { DiagramShortcutId } from '../../keyboard/shortcuts';

/** What the Diagram's keys act on: the steps in order, and which is selected. */
export interface DiagramKeyState {
  stepIds: readonly string[];
  selectedStepId: string | null;
  /**
   * The step whose card has focus, when one does. With nothing selected the
   * arrows start from it: Tab onto a card, or Escape out of a selection, and
   * the next arrow moves on from where the user is.
   */
  focusedStepId?: string | null;
  readOnly: boolean;
}

export interface DiagramKeyActions {
  select: (stepId: string | null) => void;
  /** Move a step so it lands at a 0-based index. */
  move: (stepId: string, toIndex: number) => void;
}

/**
 * Run one of the `diagram` scope's verbs. Returns whether it claimed the chord.
 *
 * With any steps at all the arrows always claim, at the ends too: an arrow that
 * fell through at the last step would scroll the page under a grid that had
 * just been navigating it. With none they decline — there is nothing to
 * navigate, and the key belongs to whatever else wants it.
 *
 * They move from the selected step, or the focused one; with neither, ←
 * starts from the last step and → from the first, so either is a way in.
 */
export function runDiagramShortcut(
  id: DiagramShortcutId,
  state: DiagramKeyState,
  actions: DiagramKeyActions
): boolean {
  const { stepIds, selectedStepId } = state;
  if (stepIds.length === 0) return false;
  const anchor = selectedStepId ?? state.focusedStepId ?? null;
  const index = anchor === null ? -1 : stepIds.indexOf(anchor);
  const last = stepIds.length - 1;
  switch (id) {
    case 'diagram.previousStep':
      actions.select(stepIds[index < 0 ? last : Math.max(0, index - 1)]);
      return true;
    case 'diagram.nextStep':
      actions.select(stepIds[index < 0 ? 0 : Math.min(last, index + 1)]);
      return true;
    case 'diagram.firstStep':
      actions.select(stepIds[0]);
      return true;
    case 'diagram.lastStep':
      actions.select(stepIds[last]);
      return true;
    case 'diagram.moveStepEarlier':
    case 'diagram.moveStepLater': {
      // Claimed even when there is nothing to move: Alt+← is the browser's Back
      // on Windows and Linux, and a press meant for a step must not leave the
      // workspace because the step was already first. Only the *selected* step
      // moves: a move is an edit, and edits act on the selection.
      const selected = selectedStepId === null ? -1 : stepIds.indexOf(selectedStepId);
      if (selected < 0 || state.readOnly) return true;
      const to = id === 'diagram.moveStepEarlier' ? selected - 1 : selected + 1;
      if (to >= 0 && to <= last) actions.move(stepIds[selected], to);
      return true;
    }
  }
}

/**
 * Escape in the Diagram: one ladder, each press undoing the innermost thing.
 * Phase 1 has one rung — deselect the step — and then declines, so Escape
 * reaches whatever is beneath. Later phases add the rungs above it: cancel a
 * drag, deselect an annotation, put the tool down, leave the step detail.
 */
export function runDiagramCancel(
  state: Pick<DiagramKeyState, 'selectedStepId'>,
  actions: Pick<DiagramKeyActions, 'select'>
): boolean {
  if (state.selectedStepId !== null) {
    actions.select(null);
    return true;
  }
  return false;
}

/**
 * Controls that use the arrow keys themselves. The Diagram's arrows decline
 * while one of these has focus, so a tab strip, a segmented control or a
 * slider keeps its own navigation. A plain button is not one: its arrows do
 * nothing, and declining there would leave ← dead after a press on Add step.
 *
 * Fields and open menus are not listed: the dispatcher stands down for them
 * before any executor runs (`isShortcutEditingTarget`, `isOpenLayerTarget`).
 */
const ARROW_OWNERS = [
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="toolbar"]',
  '[role="menubar"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(', ');

/** Whether the focused element keeps the arrow keys for itself. */
export function focusOwnsArrowKeys(element: Element | null): boolean {
  return element !== null && element.closest(ARROW_OWNERS) !== null;
}
