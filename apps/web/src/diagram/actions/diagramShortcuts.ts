import type { DiagramAnnotateShortcutId, DiagramShortcutId } from '../../keyboard/shortcuts';
import { toolForShortcut, type AnnotateTool } from '../annotate/annotateTools';

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
  /** The step detail is open on the selected step. */
  detailOpen?: boolean;
  /**
   * The References browser is open in the centre (D20): the steps are not on
   * screen, so the arrows and Enter act on its cards instead, and Escape
   * closes it first.
   */
  browserOpen?: boolean;
  /** The detail is in Annotate: its tool, its selected annotation, and whether that is a fold arrow. */
  annotate?: { tool: AnnotateTool; selectedAnnotationId: string | null; selectedIsArrow: boolean } | null;
}

export interface DiagramKeyActions {
  select: (stepId: string | null) => void;
  /** Move a step so it lands at a 0-based index. */
  move: (stepId: string, toIndex: number) => void;
  /** Open a step in detail. */
  open: (stepId: string) => void;
  /** Leave the detail for the list. */
  close: () => void;
  /** Close the References browser, back to the steps. */
  closeBrowser?: () => void;
  /** The References browser's cards, while it is open and has a list on screen. */
  browser?: DiagramBrowserKeys | null;
  /** Annotate's verbs. */
  setTool?: (tool: AnnotateTool) => void;
  selectAnnotation?: (annotationId: string | null) => void;
  flipArc?: () => void;
  /** Drop the drag the canvas has in hand, if it has one; whether it had. */
  cancelGesture?: () => boolean;
}

/** What the step keys do in the References browser: walk its cards, select them, and add the selection. */
export interface DiagramBrowserKeys {
  move: (to: 'previous' | 'next' | 'first' | 'last') => void;
  /** Extend the range to the card the walk lands on (Shift with the walk). */
  extend: (to: 'previous' | 'next' | 'first' | 'last') => void;
  /** Add or take away the card the keyboard is on (Space). */
  toggle: () => void;
  add: () => void;
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
 * starts from the last step and → from the first, so either is a way in. In
 * the detail they move it: it is open on the selected step.
 *
 * Enter opens the selected (or focused) step in detail, and declines inside
 * one, where it belongs to whatever control has focus.
 */
export function runDiagramShortcut(
  id: DiagramShortcutId,
  state: DiagramKeyState,
  actions: DiagramKeyActions
): boolean {
  // The browser shows cards, not steps: a step key would act on one unseen.
  if (state.browserOpen) return runBrowserShortcut(id, actions.browser ?? null);
  const { stepIds, selectedStepId } = state;
  if (isAnnotateShortcut(id)) return runDiagramAnnotateShortcut(id, state, actions);
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
    case 'diagram.openStep':
      if (state.detailOpen || index < 0) return false;
      actions.open(stepIds[index]);
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
    // The steps grid selects one step: a range or a toggle is the browser's.
    case 'diagram.extendSelectionBack':
    case 'diagram.extendSelectionForward':
    case 'diagram.extendSelectionToFirst':
    case 'diagram.extendSelectionToLast':
    case 'diagram.toggleSelection':
      return false;
  }
}

/**
 * The step keys in the References browser, as the steps grid has them: the
 * arrows walk its cards one at a time, selecting each, Home and End go to the
 * ends, and Enter adds the selection; Shift with any of them extends the
 * range, and Space adds or takes away one card. Moving a step is claimed and
 * does nothing — there are none on screen, and Alt+← must not reach the
 * browser's Back — and annotating declines. All of it declines with no list
 * to walk.
 */
function runBrowserShortcut(id: DiagramShortcutId, keys: DiagramBrowserKeys | null): boolean {
  if (!keys) return false;
  switch (id) {
    case 'diagram.extendSelectionBack':
      keys.extend('previous');
      return true;
    case 'diagram.extendSelectionForward':
      keys.extend('next');
      return true;
    case 'diagram.extendSelectionToFirst':
      keys.extend('first');
      return true;
    case 'diagram.extendSelectionToLast':
      keys.extend('last');
      return true;
    case 'diagram.toggleSelection':
      keys.toggle();
      return true;
    case 'diagram.moveStepEarlier':
    case 'diagram.moveStepLater':
      return true;
    case 'diagram.previousStep':
      keys.move('previous');
      return true;
    case 'diagram.nextStep':
      keys.move('next');
      return true;
    case 'diagram.firstStep':
      keys.move('first');
      return true;
    case 'diagram.lastStep':
      keys.move('last');
      return true;
    case 'diagram.openStep':
      keys.add();
      return true;
    default:
      return false;
  }
}

const ANNOTATE_SHORTCUTS: ReadonlySet<string> = new Set<DiagramAnnotateShortcutId>([
  'diagram.toolValleyArrow',
  'diagram.toolMountainArrow',
  'diagram.toolFoldUnfoldArrow',
  'diagram.toolPushArrow',
  'diagram.toolTurnOver',
  'diagram.toolRotate',
  'diagram.toolValleyLine',
  'diagram.toolMountainLine',
  'diagram.toolHiddenLine',
  'diagram.toolLabel',
  'diagram.flipArc',
]);

export function isAnnotateShortcut(id: DiagramShortcutId): id is DiagramAnnotateShortcutId {
  return ANNOTATE_SHORTCUTS.has(id);
}

/**
 * Annotate's keys: a tool's letter picks it — pressed again, back to Select —
 * and F flips the selected fold arrow. Outside Annotate, and on a diagram
 * that cannot change, they decline: the letters are a crease-pattern tool's
 * too, and nothing here should eat them.
 */
export function runDiagramAnnotateShortcut(
  id: DiagramAnnotateShortcutId,
  state: Pick<DiagramKeyState, 'annotate' | 'readOnly'>,
  actions: Pick<DiagramKeyActions, 'setTool' | 'flipArc'>
): boolean {
  const annotate = state.annotate;
  if (!annotate || state.readOnly) return false;
  if (id === 'diagram.flipArc') {
    if (!annotate.selectedIsArrow || !actions.flipArc) return false;
    actions.flipArc();
    return true;
  }
  const tool = toolForShortcut(id);
  if (tool === undefined || !actions.setTool) return false;
  actions.setTool(annotate.tool === tool ? null : tool);
  return true;
}

/**
 * Escape in the Diagram: one ladder, each press undoing the innermost thing
 * (D12) — close the References browser, drop the drag in progress, deselect
 * the annotation, put the tool down, leave the step detail, deselect the
 * step — and then it declines, so Escape reaches whatever is beneath.
 */
export function runDiagramCancel(
  state: Pick<DiagramKeyState, 'selectedStepId' | 'detailOpen' | 'annotate' | 'browserOpen'>,
  actions: Pick<
    DiagramKeyActions,
    'select' | 'close' | 'cancelGesture' | 'selectAnnotation' | 'setTool' | 'closeBrowser'
  >
): boolean {
  if (state.browserOpen && actions.closeBrowser) {
    actions.closeBrowser();
    return true;
  }
  if (state.annotate) {
    if (actions.cancelGesture?.()) return true;
    if (state.annotate.selectedAnnotationId !== null && actions.selectAnnotation) {
      actions.selectAnnotation(null);
      return true;
    }
    if (state.annotate.tool !== null && actions.setTool) {
      actions.setTool(null);
      return true;
    }
  }
  if (state.detailOpen) {
    actions.close();
    return true;
  }
  if (state.selectedStepId !== null) {
    actions.select(null);
    return true;
  }
  return false;
}

/**
 * Marks a control of the Diagram's own that moves with the arrow keys and
 * Home and End: the pattern picker's list. A listbox is not an owner by its
 * role, because the steps grid is one, and its arrows are the Diagram's.
 */
export const DIAGRAM_OWN_ARROWS_ATTRIBUTE = 'data-own-arrows';

/**
 * Controls that use the arrow keys themselves. The Diagram's arrows decline
 * while one of these has focus, so a tab strip, a segmented control or a
 * slider keeps its own navigation. A plain button is not one: its arrows do
 * nothing, and declining there would leave ← dead after a press on Add step.
 * Nor is a toolbar: none of the app's moves focus with the arrows, and a
 * slider or segmented control inside one declines through its own role.
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
  `[${DIAGRAM_OWN_ARROWS_ATTRIBUTE}]`,
].join(', ');

/**
 * Marks the steps grid and the References browser's cards: the surfaces where
 * Enter acts on the selection — opens the step, or adds the cards.
 */
export const DIAGRAM_STEPS_ATTRIBUTE = 'data-diagram-steps';

/**
 * Whether Enter at this focus acts on the selection: focus on nothing, on the
 * steps grid or the browser's cards, or on one of their cards. Anything else
 * that holds focus — a link, a tab, a button, a dock tab — keeps its own Enter.
 */
export function focusLeavesEnterToSteps(element: Element | null): boolean {
  if (element === null || element === element.ownerDocument.body) return true;
  return element.matches(
    `[${DIAGRAM_STEPS_ATTRIBUTE}], [${DIAGRAM_STEPS_ATTRIBUTE}] [role="option"]`
  );
}

/** Whether the focused element keeps the arrow keys for itself. */
export function focusOwnsArrowKeys(element: Element | null): boolean {
  return element !== null && element.closest(ARROW_OWNERS) !== null;
}
