import type { ReferencesShortcutId } from '../../keyboard/shortcuts';

/** Every References-scope shortcut, in the order the transport strip shows them. */
export const REFERENCES_SHORTCUT_IDS: readonly ReferencesShortcutId[] = [
  'references.previousStep',
  'references.nextStep',
  'references.previousCandidate',
  'references.nextCandidate',
  'references.recompute',
  'references.toggleLandmarksFirst',
  'references.resetView',
  'references.zoomIn',
  'references.zoomOut',
  'references.clearTarget',
  'references.playFold',
];

/**
 * What the References workspace can be asked to do from the keyboard. Each is
 * one verb with no arguments; the panel binds them to its view and store hooks.
 */
export interface ReferencesShortcutActions {
  nextStep: () => void;
  previousStep: () => void;
  nextCandidate: () => void;
  previousCandidate: () => void;
  recompute: () => void;
  toggleLandmarksFirst: () => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Stop asking about the picked vertex or crease (`Escape`). */
  clearTarget: () => void;
  /** Play the step's fold, pause it, or play it back (`Space`). */
  playFold: () => void;
}

/**
 * Route a `references.*` shortcut to the action it names.
 *
 * React-free and store-free, so the executor the panel registers with
 * `registerReferencesShortcutExecutor` is this one line, and the mapping can be
 * tested without mounting anything. Exhaustive over {@link ReferencesShortcutId}:
 * a new id fails to compile here until it is given a verb.
 */
export function runReferencesShortcut(
  id: ReferencesShortcutId,
  actions: ReferencesShortcutActions
): void {
  switch (id) {
    case 'references.nextStep':
      actions.nextStep();
      return;
    case 'references.previousStep':
      actions.previousStep();
      return;
    case 'references.nextCandidate':
      actions.nextCandidate();
      return;
    case 'references.previousCandidate':
      actions.previousCandidate();
      return;
    case 'references.recompute':
      actions.recompute();
      return;
    case 'references.toggleLandmarksFirst':
      actions.toggleLandmarksFirst();
      return;
    case 'references.resetView':
      actions.resetView();
      return;
    case 'references.zoomIn':
      actions.zoomIn();
      return;
    case 'references.zoomOut':
      actions.zoomOut();
      return;
    case 'references.clearTarget':
      actions.clearTarget();
      return;
    case 'references.playFold':
      actions.playFold();
      return;
  }
}
