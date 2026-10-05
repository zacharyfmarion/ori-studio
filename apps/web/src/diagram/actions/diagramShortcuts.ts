import type { DiagramAnnotateShortcutId, DiagramPathShortcutId, DiagramShortcutId } from '../../keyboard/shortcuts';
import { EDIT_PATH, toolForShortcut, type AnnotateTool } from '../annotate/annotateTools';
import { NUDGE_STEP } from '../annotate/annotationActions';

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
   * The References browser is open (D20): a modal over the steps, whose keys
   * are its own. Escape closes it first.
   */
  browserOpen?: boolean;
  /**
   * The detail is in Annotate: its tool, its selected annotation, whether
   * that offers Flip arc, and the node Edit Path has selected on it.
   */
  annotate?: {
    tool: AnnotateTool;
    selectedAnnotationId: string | null;
    canFlipArc: boolean;
    selectedPathNode?: number | null;
  } | null;
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
  /** Annotate's verbs. */
  setTool?: (tool: AnnotateTool) => void;
  selectAnnotation?: (annotationId: string | null) => void;
  /** Select a node of the selected arrow in Edit Path, or none. */
  selectPathNode?: (node: number | null) => void;
  /** Move Edit Path's selected node by `delta`, in picture units. */
  nudgePathNode?: (delta: [number, number]) => void;
  flipArc?: () => void;
  /** Drop the drag the canvas has in hand, if it has one; whether it had. */
  cancelGesture?: () => boolean;
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
  // The browser is a modal with keys of its own: one that reaches here, with
  // focus slipped out of it, must not act on a step behind it. Moving a step
  // is claimed all the same — Alt+← is the browser's Back.
  if (state.browserOpen) return id === 'diagram.moveStepEarlier' || id === 'diagram.moveStepLater';
  const { stepIds, selectedStepId } = state;
  if (isAnnotateShortcut(id)) return runDiagramAnnotateShortcut(id, state, actions);
  if (isPathShortcut(id)) return runDiagramPathShortcut(id, state, actions);
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
  }
}

/** Annotate's keys: a record, so a new one is a compile error here until it is listed. */
const ANNOTATE_SHORTCUT_IDS: Readonly<Record<DiagramAnnotateShortcutId, true>> = {
  'diagram.toolEditPath': true,
  'diagram.toolValleyArrow': true,
  'diagram.toolMountainArrow': true,
  'diagram.toolFoldUnfoldArrow': true,
  'diagram.toolPushArrow': true,
  'diagram.toolWhiteArrow': true,
  'diagram.toolTurnOver': true,
  'diagram.toolRotate': true,
  'diagram.toolValleyLine': true,
  'diagram.toolMountainLine': true,
  'diagram.toolHiddenLine': true,
  'diagram.toolLabel': true,
  'diagram.toolCircle': true,
  'diagram.flipArc': true,
};

const ANNOTATE_SHORTCUTS: ReadonlySet<string> = new Set(Object.keys(ANNOTATE_SHORTCUT_IDS));

export function isAnnotateShortcut(id: DiagramShortcutId): id is DiagramAnnotateShortcutId {
  return ANNOTATE_SHORTCUTS.has(id);
}

/** Each nudge key's move, in picture units, y down. */
const NUDGES: Readonly<Record<DiagramPathShortcutId, [number, number]>> = {
  'diagram.nudgeNodeLeft': [-NUDGE_STEP.small, 0],
  'diagram.nudgeNodeRight': [NUDGE_STEP.small, 0],
  'diagram.nudgeNodeUp': [0, -NUDGE_STEP.small],
  'diagram.nudgeNodeDown': [0, NUDGE_STEP.small],
  'diagram.nudgeNodeLeftLarge': [-NUDGE_STEP.large, 0],
  'diagram.nudgeNodeRightLarge': [NUDGE_STEP.large, 0],
  'diagram.nudgeNodeUpLarge': [0, -NUDGE_STEP.large],
  'diagram.nudgeNodeDownLarge': [0, NUDGE_STEP.large],
};

export function isPathShortcut(id: DiagramShortcutId): id is DiagramPathShortcutId {
  return Object.prototype.hasOwnProperty.call(NUDGES, id);
}

/**
 * Edit Path's arrow keys (decision 6): with a node selected they nudge it —
 * Shift ten times as far — and otherwise decline, so the same arrows walk
 * the steps (`diagram-path` sits ahead of `diagram` for exactly this). On a
 * diagram that cannot change they decline too: there is nothing to nudge.
 */
export function runDiagramPathShortcut(
  id: DiagramPathShortcutId,
  state: Pick<DiagramKeyState, 'annotate' | 'readOnly'>,
  actions: Pick<DiagramKeyActions, 'nudgePathNode'>
): boolean {
  const annotate = state.annotate;
  if (!annotate || state.readOnly || annotate.tool !== EDIT_PATH) return false;
  if ((annotate.selectedPathNode ?? null) === null || !actions.nudgePathNode) return false;
  actions.nudgePathNode(NUDGES[id]);
  return true;
}

/**
 * Annotate's keys: a tool's letter picks it — pressed again, back to Select;
 * A is Edit Path's —
 * and F flips the selected annotation's arc, when it offers Flip arc
 * (`annotationActions.ts`). Outside Annotate, and on a diagram
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
    if (!annotate.canFlipArc || !actions.flipArc) return false;
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
 * (D12) — close the References browser, drop the drag in progress; in Edit
 * Path deselect the node, then put Edit Path down, back to Select with the
 * arrow still selected; deselect the annotation, put the tool down, leave the
 * step detail, deselect the step — and then it declines, so Escape reaches
 * whatever is beneath.
 */
export function runDiagramCancel(
  state: Pick<DiagramKeyState, 'selectedStepId' | 'detailOpen' | 'annotate' | 'browserOpen'>,
  actions: Pick<
    DiagramKeyActions,
    'select' | 'close' | 'cancelGesture' | 'selectAnnotation' | 'selectPathNode' | 'setTool' | 'closeBrowser'
  >
): boolean {
  if (state.browserOpen && actions.closeBrowser) {
    actions.closeBrowser();
    return true;
  }
  if (state.annotate) {
    if (actions.cancelGesture?.()) return true;
    if (state.annotate.tool === EDIT_PATH) {
      if ((state.annotate.selectedPathNode ?? null) !== null && actions.selectPathNode) {
        actions.selectPathNode(null);
        return true;
      }
      if (actions.setTool) {
        actions.setTool(null);
        return true;
      }
    }
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

/** Marks the steps grid: the surface where Enter acts on the selection, opening the step. */
export const DIAGRAM_STEPS_ATTRIBUTE = 'data-diagram-steps';

/**
 * Whether Enter at this focus acts on the selection: focus on nothing, on the
 * steps grid, or on one of its cards. Anything else that holds focus — a
 * link, a tab, a button, a dock tab — keeps its own Enter.
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
