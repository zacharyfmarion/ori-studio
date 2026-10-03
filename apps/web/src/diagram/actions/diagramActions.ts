import type { TFunction } from 'i18next';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import type { DiagramLinkStatus } from '../capture/linkStatus';
import { DIAGRAM_SHOW_AS, type DiagramShowAs } from '../document/diagramDocument';

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
  | 'start-page'
  | 'upload-picture'
  | 'link-pattern'
  | 'from-references'
  | 'refresh-picture'
  | 'open-in-edit'
  | 'open-in-references'
  | 'adjust-pose'
  | 'annotate'
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
  /** An on/off verb's state, for a surface that shows it as a check. */
  checked?: boolean;
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

/**
 * A verb with a choice of ways (D19): Show as and Duplicate as, one option per
 * way a linked pattern is shown. A menu draws it as a submenu; the Step pane
 * draws Show as as a segmented row.
 */
export interface DiagramStepChoice {
  kind: 'choice';
  id: 'show-as' | 'duplicate-as';
  label: string;
  disabled: boolean;
  hint?: string;
  options: { id: DiagramShowAs; label: string; checked?: boolean; run: () => void }[];
}

export type DiagramStepAction = DiagramStepCommand | DiagramStepSeparator | DiagramStepChoice;

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
  /**
   * What the step is linked to: a pattern of the crease pattern (`cp`), which
   * Refresh captures again, or the sheet it was sent from in References,
   * which it never follows (D6). Null for a step that is not linked.
   */
  linkKind: 'cp' | 'references' | null;
  /** The step starts a new page ("Start a new page here"). */
  breakBefore: boolean;
  /** A 3D picture whose light is not the diagram's style's any more: Refresh relights it. */
  lightingChanged: boolean;
  /** A capture of this step is running. */
  capturing: boolean;
  /** A crease pattern is open to link to. */
  patternOpen: boolean;
  /** How a step linked to the pattern shows it (D19); null for any other step. */
  showAs: DiagramShowAs | null;
}

export interface DiagramStepActionDeps {
  t: TFunction;
  insert: (where: 'before' | 'after') => void;
  duplicate: () => void;
  move: (direction: 'earlier' | 'later') => void;
  /** Start a new page at the step, or stop doing so. */
  toggleBreak: () => void;
  /** Pick a file for the step's picture: its first, or in place of the one it has. */
  uploadPicture: () => void;
  /** Choose the pattern the step shows: the picker, in the Step pane. */
  linkPattern: () => void;
  /** Capture a linked step's picture again from its pattern as it is now. */
  refreshPicture: () => void;
  /** Show a linked step's pattern in Edit. */
  openInEdit: () => void;
  /** Show the sheet a References step was sent from, in References. */
  openInReferences: () => void;
  /** Ask References for this step's picture: its next Send to diagram fills the step. */
  fromReferences: () => void;
  /** Show a linked step's pattern another way (D19). */
  showAs: (way: DiagramShowAs) => void;
  /** A copy of a linked step after it, shown another way (D19). */
  duplicateAs: (way: DiagramShowAs) => void;
  /** Open the step in Pose (D5). */
  adjustPose: () => void;
  /** Open the step in Annotate (D8). */
  annotate: () => void;
  exportPicture: () => void;
  removePicture: () => void;
  remove: () => void;
}

/** The verbs that change nothing, offered on a read-only diagram too. */
const READ_ONLY_VERBS: ReadonlySet<DiagramStepActionId> = new Set([
  'export-picture',
  'open-in-edit',
  'open-in-references',
]);

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

  // A way to show the pattern needs a capture: the pattern open, the region there, no capture running.
  const showBlocked = state.locked || !state.patternOpen || state.capturing || state.link === 'missing';
  const showHint = state.locked
    ? lockedEditHint
    : !state.patternOpen
      ? t('panels:diagram.actions.noPatternOpenHint', 'Its crease pattern isn’t open')
      : state.capturing
        ? capturingHint
        : t('panels:diagram.actions.missingHint', 'Its pattern is gone: relink it to another');
  const choice = (
    id: DiagramStepChoice['id'],
    label: string,
    run: (way: DiagramShowAs) => () => void,
    current: DiagramShowAs | null
  ): DiagramStepChoice => {
    const gated = state.readOnly;
    const disabled = gated || showBlocked;
    return {
      kind: 'choice',
      id,
      label,
      disabled,
      ...(disabled ? { hint: gated ? readOnlyHint : showHint } : {}),
      options: DIAGRAM_SHOW_AS.map((way) => ({
        id: way,
        label: showAsName(way, t),
        ...(current === null ? {} : { checked: way === current }),
        run: run(way),
      })),
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
    ...(state.showAs === null
      ? []
      : [
          choice(
            'duplicate-as',
            t('panels:diagram.actions.duplicateAs', 'Duplicate As'),
            (way) => () => deps.duplicateAs(way),
            null
          ),
        ]),
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
    {
      ...command(
        'start-page',
        t('panels:diagram.actions.startPage', 'Start a New Page Here'),
        deps.toggleBreak,
        state.locked || state.index <= 0,
        state.locked ? lockedEditHint : t('panels:diagram.actions.firstPageHint', 'The first step always starts a page')
      ),
      checked: state.breakBefore,
    },
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
      state.linkKind !== 'cp'
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
    // An empty step's way to a picture from References: on a step with one,
    // a send would add a step after it, which the header's From References…
    // already says.
    ...(state.hasSource
      ? []
      : [
          command(
            'from-references',
            t('panels:diagram.actions.fromReferences', 'From References…'),
            deps.fromReferences,
            state.locked || !state.patternOpen || state.capturing,
            state.locked
              ? lockedEditHint
              : !state.patternOpen
                ? t(
                    'panels:diagram.actions.noPatternReferencesHint',
                    'Open a crease pattern in Edit to plan its folds'
                  )
                : capturingHint
          ),
        ]),
    // Only a linked pattern can be refreshed: on any other step the verb is noise.
    ...(state.linkKind !== 'cp' || state.link === null
      ? []
      : [
          command(
            'refresh-picture',
            t('panels:diagram.actions.refreshPicture', 'Refresh Picture'),
            deps.refreshPicture,
            state.capturing || !refreshable(state.link, state.lightingChanged, state.patternOpen),
            state.capturing ? capturingHint : refreshHint(state.link, state.lightingChanged, state.patternOpen, t)
          ),
          command(
            'open-in-edit',
            t('panels:diagram.actions.openInEdit', 'Open in Edit'),
            deps.openInEdit,
            !state.patternOpen,
            t('panels:diagram.actions.noPatternOpenHint', 'Its crease pattern isn’t open')
          ),
        ]),
    // A References step is never refreshed (D6): it leads back to its sheet.
    ...(state.linkKind !== 'references'
      ? []
      : [
          command(
            'open-in-references',
            t('panels:diagram.actions.openInReferences', 'Open in References'),
            deps.openInReferences,
            !state.patternOpen,
            t('panels:diagram.actions.noPatternOpenHint', 'Its crease pattern isn’t open')
          ),
        ]),
    // How a linked pattern is shown: the Step pane's Show as row, as a submenu here.
    ...(state.showAs === null
      ? []
      : [
          choice(
            'show-as',
            t('panels:diagram.actions.showAs', 'Show As'),
            (way) => () => deps.showAs(way),
            state.showAs
          ),
        ]),
    // Pose needs something to pose: a picture, or a link whose picture it
    // chooses how to show.
    command(
      'adjust-pose',
      t('panels:diagram.actions.adjustPose', 'Adjust Pose'),
      deps.adjustPose,
      state.locked || !state.hasSource,
      state.locked ? lockedEditHint : t('panels:diagram.actions.poseNeedsPicture', 'Give the step a picture to pose')
    ),
    command(
      'annotate',
      t('panels:diagram.actions.annotate', 'Annotate'),
      deps.annotate,
      state.locked || !state.hasPicture,
      state.locked ? lockedEditHint : t('panels:diagram.detail.annotateNeedsPicture', 'Give the step a picture to annotate')
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
 * Whether Refresh can do anything: the pattern changed, a 3D picture's light
 * is not the diagram's, or a pattern is open and the link cannot be checked
 * yet (its segmentation is still coming), where a capture finds out. Not for a
 * current link in its light, or one whose pattern is gone.
 */
function refreshable(link: DiagramLinkStatus, lighting: boolean, patternOpen: boolean): boolean {
  return link === 'stale' || (link === 'current' && lighting) || (link === 'unknown' && patternOpen);
}

function refreshHint(
  link: DiagramLinkStatus,
  lighting: boolean,
  patternOpen: boolean,
  t: TFunction
): string | undefined {
  switch (link) {
    case 'current':
      return lighting ? undefined : t('panels:diagram.actions.currentHint', 'Already shows its pattern as it is');
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

/** A way of showing a linked pattern, by name, as every surface says it (D19). */
export function showAsName(way: DiagramShowAs, t: TFunction): string {
  return way === 'folded'
    ? t('panels:diagram.pose.showFolded', 'Folded')
    : t('panels:diagram.pose.showCreasePattern', 'Crease Pattern');
}

/** The choice with this id, for a surface that places it on its own. */
export function diagramStepChoice(
  actions: readonly DiagramStepAction[],
  id: DiagramStepChoice['id']
): DiagramStepChoice | null {
  const action = actions.find((candidate) => candidate.kind === 'choice' && candidate.id === id);
  return action?.kind === 'choice' ? action : null;
}

/** The command with this id, for a surface that places verbs one by one. */
export function diagramStepCommand(
  actions: readonly DiagramStepAction[],
  id: DiagramStepActionId
): DiagramStepCommand | null {
  const action = actions.find((candidate) => candidate.kind === 'command' && candidate.id === id);
  return action?.kind === 'command' ? action : null;
}
