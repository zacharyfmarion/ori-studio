import type { TFunction } from 'i18next';
import type { ShortcutActionId } from '../../keyboard/shortcuts';

/**
 * The verbs a diagram step offers, in the order every surface presents them:
 * the Step pane's header, and the card's context menu.
 *
 * `foldedFigureActions.ts`'s shape: React-free and store-free, taking the
 * step's position plus bound callbacks and returning plain data, so the
 * surfaces cannot drift (a verb added here appears in each) and the gating is
 * testable on its own. Each surface owns only its rendering.
 */

/** Icon names, resolved to components by each surface (this module stays JSX-free). */
export type DiagramStepActionId =
  | 'insert-before'
  | 'insert-after'
  | 'duplicate'
  | 'move-earlier'
  | 'move-later'
  | 'upload-picture'
  | 'export-picture'
  | 'remove-picture'
  | 'delete';

export interface DiagramStepCommand {
  kind: 'command';
  id: DiagramStepActionId;
  label: string;
  disabled: boolean;
  /** Why it is disabled, for a tooltip or a menu row's hint. */
  hint?: string;
  danger?: boolean;
  /**
   * The key that runs the same verb, for a surface that shows chords (a menu
   * row). Its own path: the key goes through the shortcut runtime, the row
   * through `run`; both end at the same store action.
   */
  shortcutId?: ShortcutActionId;
  run: () => void;
}

export interface DiagramStepSeparator {
  kind: 'separator';
  id: string;
}

export type DiagramStepAction = DiagramStepCommand | DiagramStepSeparator;

/** What the verbs are gated on. */
export interface DiagramStepActionState {
  /** The step's 0-based position. */
  index: number;
  /** How many steps the diagram has. */
  count: number;
  /**
   * Made by a newer build and carried verbatim. It can move and go, but not be
   * copied: its stored form names its own id.
   */
  locked: boolean;
  /** The whole diagram came from a newer build and nothing may change it. */
  readOnly: boolean;
  /** The step has a picture this build can draw. */
  hasPicture: boolean;
}

export interface DiagramStepActionDeps {
  t: TFunction;
  insert: (where: 'before' | 'after') => void;
  duplicate: () => void;
  move: (direction: 'earlier' | 'later') => void;
  /** Pick a file for the step's picture: its first, or in place of the one it has. */
  uploadPicture: () => void;
  exportPicture: () => void;
  removePicture: () => void;
  remove: () => void;
}

/** The verbs that have a key of their own. */
const STEP_ACTION_SHORTCUTS: Partial<Record<DiagramStepActionId, ShortcutActionId>> = {
  'move-earlier': 'diagram.moveStepEarlier',
  'move-later': 'diagram.moveStepLater',
  delete: 'edit.delete',
};

export function buildDiagramStepActions(
  state: DiagramStepActionState,
  deps: DiagramStepActionDeps
): DiagramStepAction[] {
  const { t } = deps;
  const readOnlyHint = t(
    'panels:diagram.actions.readOnlyHint',
    'This diagram was made with a newer Ori Studio and opens read-only'
  );
  const command = (
    id: DiagramStepActionId,
    label: string,
    run: () => void,
    blocked: boolean,
    hint?: string,
    danger?: boolean
  ): DiagramStepCommand => {
    const disabled = state.readOnly || blocked;
    const shortcutId = STEP_ACTION_SHORTCUTS[id];
    return {
      kind: 'command',
      id,
      label,
      disabled,
      hint: state.readOnly ? readOnlyHint : blocked ? hint : undefined,
      ...(danger ? { danger } : {}),
      ...(shortcutId ? { shortcutId } : {}),
      run,
    };
  };

  return [
    command(
      'insert-before',
      t('panels:diagram.actions.insertBefore', 'Insert Step Before'),
      () => deps.insert('before'),
      false
    ),
    command(
      'insert-after',
      t('panels:diagram.actions.insertAfter', 'Insert Step After'),
      () => deps.insert('after'),
      false
    ),
    command(
      'duplicate',
      t('panels:diagram.actions.duplicate', 'Duplicate Step'),
      deps.duplicate,
      state.locked,
      t(
        'panels:diagram.actions.lockedHint',
        'Made with a newer Ori Studio: it can be moved or deleted, not copied'
      )
    ),
    { kind: 'separator', id: 'after-add' },
    command(
      'move-earlier',
      t('panels:diagram.actions.moveEarlier', 'Move Earlier'),
      () => deps.move('earlier'),
      state.index <= 0,
      t('panels:diagram.actions.firstHint', 'Already the first step')
    ),
    command(
      'move-later',
      t('panels:diagram.actions.moveLater', 'Move Later'),
      () => deps.move('later'),
      state.index >= state.count - 1,
      t('panels:diagram.actions.lastHint', 'Already the last step')
    ),
    { kind: 'separator', id: 'after-move' },
    command(
      'upload-picture',
      state.hasPicture
        ? t('panels:diagram.actions.replacePicture', 'Replace Picture…')
        : t('panels:diagram.actions.uploadPicture', 'Upload Picture…'),
      deps.uploadPicture,
      state.locked,
      t('panels:diagram.actions.lockedEditHint', 'Made with a newer Ori Studio: it can be moved or deleted, not changed')
    ),
    command(
      'export-picture',
      t('panels:diagram.actions.exportPicture', 'Export Picture…'),
      deps.exportPicture,
      !state.hasPicture,
      t('panels:diagram.actions.noPictureHint', 'This step has no picture yet')
    ),
    command(
      'remove-picture',
      t('panels:diagram.actions.removePicture', 'Remove Picture'),
      deps.removePicture,
      !state.hasPicture,
      t('panels:diagram.actions.noPictureHint', 'This step has no picture yet')
    ),
    { kind: 'separator', id: 'after-picture' },
    command(
      'delete',
      t('panels:diagram.actions.delete', 'Delete Step'),
      deps.remove,
      false,
      undefined,
      true
    ),
  ];
}

/** The command with this id, for a surface that places verbs one by one. */
export function diagramStepCommand(
  actions: readonly DiagramStepAction[],
  id: DiagramStepActionId
): DiagramStepCommand | null {
  const action = actions.find((candidate) => candidate.kind === 'command' && candidate.id === id);
  return action?.kind === 'command' ? action : null;
}
