import type { TFunction } from 'i18next';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import type { DiagramLinkStatus } from '../capture/linkStatus';

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
  | 'link-pattern'
  | 'refresh-picture'
  | 'open-in-edit'
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
  /** The step has a picture or a link to a pattern, which Remove picture takes away. */
  hasSource: boolean;
  /** How the step's link to the crease pattern stands; null for a step that is not linked. */
  link: DiagramLinkStatus | null;
  /** A capture of this step is running. */
  capturing: boolean;
  /** A crease pattern is open to link to. */
  patternOpen: boolean;
}

export interface DiagramStepActionDeps {
  t: TFunction;
  insert: (where: 'before' | 'after') => void;
  duplicate: () => void;
  move: (direction: 'earlier' | 'later') => void;
  /** Pick a file for the step's picture: its first, or in place of the one it has. */
  uploadPicture: () => void;
  /** Choose the pattern the step shows: the picker, in the Step pane. */
  linkPattern: () => void;
  /** Capture a linked step's picture again from its pattern as it is now. */
  refreshPicture: () => void;
  /** Show a linked step's pattern in Edit. */
  openInEdit: () => void;
  exportPicture: () => void;
  removePicture: () => void;
  remove: () => void;
}

/** The verbs that change nothing, offered on a read-only diagram too. */
const READ_ONLY_VERBS: ReadonlySet<DiagramStepActionId> = new Set(['export-picture', 'open-in-edit']);

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
  const lockedEditHint = t(
    'panels:diagram.actions.lockedEditHint',
    'Made with a newer Ori Studio: it can be moved or deleted, not changed'
  );
  const capturingHint = t('panels:diagram.actions.capturingHint', 'Its picture is being captured');
  const command = (
    id: DiagramStepActionId,
    label: string,
    run: () => void,
    blocked: boolean,
    hint?: string,
    danger?: boolean
  ): DiagramStepCommand => {
    // A verb that only reads the diagram is not held back by its being read-only.
    const gated = state.readOnly && !READ_ONLY_VERBS.has(id);
    const disabled = gated || blocked;
    const shortcutId = STEP_ACTION_SHORTCUTS[id];
    return {
      kind: 'command',
      id,
      label,
      disabled,
      hint: gated ? readOnlyHint : blocked ? hint : undefined,
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
      state.locked || state.capturing,
      state.locked ? lockedEditHint : capturingHint
    ),
    command(
      'link-pattern',
      state.link === null
        ? t('panels:diagram.actions.linkPattern', 'Link Pattern…')
        : t('panels:diagram.actions.relinkPattern', 'Relink Pattern…'),
      deps.linkPattern,
      state.locked || !state.patternOpen || state.capturing,
      state.locked
        ? lockedEditHint
        : !state.patternOpen
          ? t('panels:diagram.actions.noPatternHint', 'Open a crease pattern in Edit to link it')
          : capturingHint
    ),
    // Only a linked step can be refreshed: on any other the verb is noise.
    ...(state.link === null
      ? []
      : [
          command(
            'refresh-picture',
            t('panels:diagram.actions.refreshPicture', 'Refresh Picture'),
            deps.refreshPicture,
            state.capturing || !refreshable(state.link, state.patternOpen),
            state.capturing ? capturingHint : refreshHint(state.link, state.patternOpen, t)
          ),
          command(
            'open-in-edit',
            t('panels:diagram.actions.openInEdit', 'Open in Edit'),
            deps.openInEdit,
            !state.patternOpen,
            t('panels:diagram.actions.noPatternOpenHint', 'Its crease pattern isn’t open')
          ),
        ]),
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
      !state.hasSource || state.capturing,
      state.capturing ? capturingHint : t('panels:diagram.actions.noPictureHint', 'This step has no picture yet')
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

/**
 * Whether Refresh can do anything: the pattern changed, or a pattern is open
 * and the link cannot be checked yet (its segmentation is still coming), where
 * a capture finds out. Not for a link that is current, or whose pattern is gone.
 */
function refreshable(link: DiagramLinkStatus, patternOpen: boolean): boolean {
  return link === 'stale' || (link === 'unknown' && patternOpen);
}

function refreshHint(link: DiagramLinkStatus, patternOpen: boolean, t: TFunction): string | undefined {
  switch (link) {
    case 'current':
      return t('panels:diagram.actions.currentHint', 'Already shows its pattern as it is');
    case 'missing':
      return t('panels:diagram.actions.missingHint', 'Its pattern is gone: relink it to another');
    case 'unknown':
      return patternOpen
        ? undefined
        : t('panels:diagram.actions.noPatternRefreshHint', 'Open its crease pattern in Edit to refresh it');
    case 'stale':
      return undefined;
  }
}

/** The command with this id, for a surface that places verbs one by one. */
export function diagramStepCommand(
  actions: readonly DiagramStepAction[],
  id: DiagramStepActionId
): DiagramStepCommand | null {
  const action = actions.find((candidate) => candidate.kind === 'command' && candidate.id === id);
  return action?.kind === 'command' ? action : null;
}
