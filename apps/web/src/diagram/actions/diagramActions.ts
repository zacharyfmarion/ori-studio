import type { TFunction } from 'i18next';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import { MAX_STEP_ANNOTATIONS } from '../annotate/annotationModel';
import type { DiagramLinkStatus } from '../capture/linkStatus';
import { DIAGRAM_SHOW_AS, type DiagramShowAs } from '../document/diagramDocument';
import type { DiagramTurnActionId } from './diagramTurnActions';

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
  | 'insert-turn-over'
  | 'insert-rotate'
  | 'duplicate'
  | 'move-earlier'
  | 'move-later'
  | 'start-page'
  | 'upload-picture'
  | 'link-pattern'
  | 'from-references'
  | 'make-turn-over'
  | 'make-rotate'
  | 'refresh-picture'
  | 'open-in-edit'
  | 'open-in-references'
  | 'replace-from-references'
  | 'make-marks-editable'
  | 'adjust-pose'
  | 'annotate'
  | 'export-picture'
  | 'remove-picture'
  | 'delete';

export interface DiagramStepCommand {
  kind: 'command';
  /** A step's verb — or a turn's (`diagramTurnActions.ts`), which shares the shape. */
  id: DiagramStepActionId | DiagramTurnActionId;
  label: string;
  disabled: boolean;
  /** Why it is disabled, for a tooltip or a menu row's hint. */
  hint?: string;
  danger?: boolean;
  /** An on/off verb's state, for a surface that shows it as a check. */
  checked?: boolean;
  /** `checked` marks one of a set rather than an on/off verb: a menu draws a radio row. */
  radio?: true;
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
  /** The step's 0-based place among the steps and the turns between them (D22). */
  index: number;
  /** How many steps and turns the diagram has. */
  count: number;
  /** The step's number: its place among the steps alone. */
  number: number;
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
  /**
   * A flat fold captured before its faces on the paper were kept (Revision
   * 2), which an enlarged step's frame anchors to: Refresh keeps them, so it
   * is offered even while the picture shows its pattern as it is — the way
   * the "Refresh step N to anchor the frame" notice points.
   */
  facesMissing: boolean;
  /** A capture of this step is running. */
  capturing: boolean;
  /** A crease pattern is open to link to. */
  patternOpen: boolean;
  /** How a step linked to the pattern shows it (D19); null for any other step. */
  showAs: DiagramShowAs | null;
  /**
   * Shown Simulated above 0%: only Pose captures it again, so Refresh is
   * "Pose Again" and opens it (D19).
   */
  poseAgain: boolean;
  /**
   * A References step whose card's marks are part of its picture (17e): how
   * many marks it would lift, how many the step would hold with them, the
   * author's own beside them, and whether that fits — Make Marks Editable's
   * gate. Null for any other step, the verb then not offered.
   */
  cardMarks: CardMarksGate | null;
}

export interface DiagramStepActionDeps {
  t: TFunction;
  insert: (where: 'before' | 'after') => void;
  /** Add a turn after the step (D22). */
  insertTurn: (kind: 'turn-over' | 'rotate') => void;
  /** Make the empty step a turn in its place (D24). */
  makeTurn: (kind: 'turn-over' | 'rotate') => void;
  duplicate: () => void;
  move: (direction: 'earlier' | 'later') => void;
  /** Start a new page at the step, or stop doing so. */
  toggleBreak: () => void;
  /** Pick a file for the step's picture: its first, or in place of the one it has. */
  uploadPicture: () => void;
  /** Choose the pattern the step shows: the picker, in the Step pane. */
  linkPattern: () => void;
  /**
   * Capture a linked step's picture again from its pattern as it is now — or,
   * for a step that only Pose captures (`poseAgain`), open it in Pose.
   */
  refreshPicture: () => void;
  /** Show a linked step's pattern in Edit. */
  openInEdit: () => void;
  /** Show the sheet a References step was sent from, in References. */
  openInReferences: () => void;
  /** Fill an empty step from the References browser. */
  fromReferences: () => void;
  /** Replace a References step's card from the References browser, its own card marked. */
  replaceFromReferences: () => void;
  /** Lift a References step's card's marks out of its picture into annotations (17e). */
  makeMarksEditable: () => void;
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
      'insert-turn-over',
      t('panels:diagram.actions.insertTurnOver', 'Insert Turn Over After'),
      () => deps.insertTurn('turn-over'),
      false
    ),
    command(
      'insert-rotate',
      t('panels:diagram.actions.insertRotate', 'Insert Rotate After'),
      () => deps.insertTurn('rotate'),
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
        state.locked || state.number <= 1,
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
    // the cards would go after it, which the header's From References…
    // already does.
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
    // An empty step can be a turn instead (D24): the verbs are noise on any other.
    ...(state.hasSource || state.locked
      ? []
      : [
          command(
            'make-turn-over',
            t('panels:diagram.actions.makeTurnOver', 'Make Turn Over'),
            () => deps.makeTurn('turn-over'),
            false
          ),
          command('make-rotate', t('panels:diagram.actions.makeRotate', 'Make Rotate'), () => deps.makeTurn('rotate'), false),
        ]),
    // Only a linked pattern can be refreshed: on any other step the verb is noise.
    ...(state.linkKind !== 'cp' || state.link === null
      ? []
      : [
          command(
            'refresh-picture',
            state.poseAgain
              ? t('panels:diagram.actions.poseAgain', 'Pose Again')
              : t('panels:diagram.actions.refreshPicture', 'Refresh Picture'),
            deps.refreshPicture,
            state.capturing || !refreshable(state.link, stillBehind(state), state.patternOpen),
            state.capturing ? capturingHint : refreshHint(state.link, stillBehind(state), state.patternOpen, t)
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
            'replace-from-references',
            t('panels:diagram.actions.replaceFromReferences', 'Replace from References…'),
            deps.replaceFromReferences,
            state.locked || !state.patternOpen || state.capturing,
            state.locked
              ? lockedEditHint
              : !state.patternOpen
                ? t('panels:diagram.actions.noPatternOpenHint', 'Its crease pattern isn’t open')
                : capturingHint
          ),
          // A step made before marks were lifted keeps them in its picture until asked (17e, RM8).
          ...(state.cardMarks === null
            ? []
            : [
                command(
                  'make-marks-editable',
                  t('panels:diagram.actions.makeMarksEditable', 'Make Marks Editable'),
                  deps.makeMarksEditable,
                  state.locked || !state.cardMarks.fits,
                  state.locked ? lockedEditHint : tooManyMarksHint(state.cardMarks, t)
                ),
              ]),
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

/** Make Marks Editable's gate (17e): the marks it would lift, the step's total with them, and whether that fits. */
export interface CardMarksGate {
  lifted: number;
  total: number;
  fits: boolean;
}

/**
 * Why Make Marks Editable cannot lift a step's card's marks (17e): with them,
 * the step would hold `total` marks — the author's among them, when it has
 * any, which deleting would make room for — and a step holds no more than
 * `MAX_STEP_ANNOTATIONS`.
 */
export function tooManyMarksHint({ lifted, total }: CardMarksGate, t: TFunction): string {
  const max = MAX_STEP_ANNOTATIONS;
  return total > lifted
    ? t('panels:diagram.actions.tooManyMarksWithYoursHint', '{{count}} marks with yours: a step holds {{max}}', {
        count: total,
        max,
        defaultValue_one: '{{count}} mark with yours: a step holds {{max}}',
      })
    : t('panels:diagram.actions.tooManyMarksHint', '{{count}} marks: a step holds {{max}}', {
        count: total,
        max,
        defaultValue_one: '{{count}} mark: a step holds {{max}}',
      });
}

/**
 * A picture that shows its pattern as it is but still gains from a capture:
 * a 3D picture's light is not the diagram's, or a flat fold has no faces on
 * the paper.
 */
function stillBehind(state: DiagramStepActionState): boolean {
  return state.lightingChanged || state.facesMissing;
}

/**
 * Whether Refresh can do anything: the pattern changed, a current picture is
 * {@link stillBehind}, or a pattern is open and the link cannot be checked
 * yet (its segmentation is still coming), where a capture finds out. Not for
 * a current link with nothing to gain, or one whose pattern is gone.
 */
function refreshable(link: DiagramLinkStatus, behind: boolean, patternOpen: boolean): boolean {
  return link === 'stale' || (link === 'current' && behind) || (link === 'unknown' && patternOpen);
}

function refreshHint(
  link: DiagramLinkStatus,
  behind: boolean,
  patternOpen: boolean,
  t: TFunction
): string | undefined {
  switch (link) {
    case 'current':
      return behind ? undefined : t('panels:diagram.actions.currentHint', 'Already shows its pattern as it is');
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
  switch (way) {
    case 'crease-pattern':
      return t('panels:diagram.pose.showCreasePattern', 'Crease Pattern');
    case 'folded':
      return t('panels:diagram.pose.showFolded', 'Folded');
    case 'simulated':
      return t('panels:diagram.pose.showSimulated', 'Simulated');
  }
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
