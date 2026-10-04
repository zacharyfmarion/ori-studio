import type { TFunction } from 'i18next';
import { DEFAULT_ROTATION } from '../annotate/annotationModel';
import type { DiagramRotation, DiagramTurnKind } from '../document/diagramDocument';
import type { DiagramStepAction, DiagramStepCommand } from './diagramActions';

/**
 * The verbs a turn between steps offers (D22), in the order its context menu
 * shows them: what it is — a turn-over or a rotation — and how it turns, then
 * moving it and deleting it. The step verbs' shape (`diagramActions.ts`), so
 * the menu draws them the same way; the Step pane shows what a turn is as
 * controls of its own, from the same labels (`turnLabels`).
 */
export type DiagramTurnActionId =
  | 'turn-over'
  | 'rotate'
  | 'axis-vertical'
  | 'axis-horizontal'
  | 'rotate-eighth'
  | 'rotate-quarter'
  | 'rotate-half'
  | 'rotate-cw'
  | 'rotate-ccw';

export interface DiagramTurnActionState {
  /** The turn; a newer build's (`unknown`) offers only its moves and Delete. */
  turn: DiagramTurnKind & { unknown?: unknown };
  /** Its 0-based place among the steps and turns, and how many there are. */
  index: number;
  count: number;
  readOnly: boolean;
}

export interface DiagramTurnActionDeps {
  t: TFunction;
  /** Make the turn this one. */
  set: (kind: DiagramTurnKind) => void;
  move: (direction: 'earlier' | 'later') => void;
  remove: () => void;
}

/** The words for what a turn is and how it turns: the menu's rows and the Step pane's controls. */
export function turnLabels(t: TFunction) {
  return {
    kind: {
      'turn-over': t('panels:diagram.turns.turnOver', 'Turn Over'),
      rotate: t('panels:diagram.turns.rotate', 'Rotate'),
    },
    axis: {
      vertical: t('panels:diagram.annotations.sideToSide', 'Side to Side'),
      horizontal: t('panels:diagram.annotations.topToBottom', 'Top to Bottom'),
    },
    amount: {
      eighth: t('panels:diagram.turns.eighth', '1/8 Turn'),
      quarter: t('panels:diagram.turns.quarter', '1/4 Turn'),
      half: t('panels:diagram.turns.half', '1/2 Turn'),
    },
    direction: {
      cw: t('panels:diagram.annotations.clockwise', 'Clockwise'),
      ccw: t('panels:diagram.annotations.counterclockwise', 'Counterclockwise'),
    },
  } as const;
}

/** What a turn says it is, in a few words: "Turn over", or "Rotate 1/4 turn clockwise". */
export function turnName(turn: DiagramTurnKind & { unknown?: unknown }, t: TFunction): string {
  if (turn.unknown !== undefined) return t('panels:diagram.turns.newer', 'Turn from a newer Ori Studio');
  if (turn.kind === 'turn-over') {
    return turn.axis === 'horizontal'
      ? t('panels:diagram.turns.turnOverTopToBottom', 'Turn over, top to bottom')
      : t('panels:diagram.turns.turnOverSideToSide', 'Turn over, side to side');
  }
  const { amount, direction } = turn.rotate;
  const fraction = { eighth: '1/8', quarter: '1/4', half: '1/2' }[amount];
  return direction === 'cw'
    ? t('panels:diagram.turns.rotateClockwise', 'Rotate {{fraction}} turn clockwise', { fraction })
    : t('panels:diagram.turns.rotateCounterclockwise', 'Rotate {{fraction}} turn counterclockwise', { fraction });
}

export function buildDiagramTurnActions(
  state: DiagramTurnActionState,
  deps: DiagramTurnActionDeps
): DiagramStepAction[] {
  const { t } = deps;
  const labels = turnLabels(t);
  const readOnlyHint = t(
    'panels:diagram.actions.readOnlyHint',
    'This diagram was made with a newer Ori Studio and opens read-only'
  );
  const { turn } = state;
  const choose = (id: DiagramTurnActionId, label: string, checked: boolean, next: DiagramTurnKind): DiagramStepCommand => ({
    kind: 'command',
    id,
    label,
    checked,
    radio: true,
    disabled: state.readOnly,
    ...(state.readOnly ? { hint: readOnlyHint } : {}),
    run: () => deps.set(next),
  });
  const rotation: DiagramRotation = turn.kind === 'rotate' ? turn.rotate : DEFAULT_ROTATION;
  const axis = turn.kind === 'turn-over' ? turn.axis : 'vertical';
  const how: DiagramStepAction[] =
    turn.kind === 'turn-over'
      ? (['vertical', 'horizontal'] as const).map((value) =>
          choose(`axis-${value}`, labels.axis[value], axis === value, { kind: 'turn-over', axis: value })
        )
      : [
          ...(['eighth', 'quarter', 'half'] as const).map((amount) =>
            choose(`rotate-${amount}`, labels.amount[amount], rotation.amount === amount, {
              kind: 'rotate',
              rotate: { ...rotation, amount },
            })
          ),
          { kind: 'separator', id: 'after-amount' },
          ...(['cw', 'ccw'] as const).map((direction) =>
            choose(`rotate-${direction}`, labels.direction[direction], rotation.direction === direction, {
              kind: 'rotate',
              rotate: { ...rotation, direction },
            })
          ),
        ];
  const command = (
    id: 'move-earlier' | 'move-later' | 'delete',
    label: string,
    run: () => void,
    blocked: boolean,
    hint?: string
  ): DiagramStepCommand => ({
    kind: 'command',
    id,
    label,
    disabled: state.readOnly || blocked,
    ...(state.readOnly ? { hint: readOnlyHint } : blocked && hint ? { hint } : {}),
    ...(id === 'delete' ? { danger: true, shortcutId: 'edit.delete' as const } : {}),
    ...(id === 'move-earlier' ? { shortcutId: 'diagram.moveStepEarlier' as const } : {}),
    ...(id === 'move-later' ? { shortcutId: 'diagram.moveStepLater' as const } : {}),
    run,
  });
  // A newer build's turn is not this build's to change: what it is is a stand-in.
  const what: DiagramStepAction[] =
    turn.unknown !== undefined
      ? []
      : [
          choose('turn-over', labels.kind['turn-over'], turn.kind === 'turn-over', { kind: 'turn-over', axis }),
          choose('rotate', labels.kind.rotate, turn.kind === 'rotate', { kind: 'rotate', rotate: rotation }),
          { kind: 'separator', id: 'after-kind' },
          ...how,
          { kind: 'separator', id: 'after-how' },
        ];
  return [
    ...what,
    command(
      'move-earlier',
      t('panels:diagram.actions.moveEarlier', 'Move Earlier'),
      () => deps.move('earlier'),
      state.index <= 0,
      t('panels:diagram.turns.firstHint', 'Already first')
    ),
    command(
      'move-later',
      t('panels:diagram.actions.moveLater', 'Move Later'),
      () => deps.move('later'),
      state.index >= state.count - 1,
      t('panels:diagram.turns.lastHint', 'Already last')
    ),
    { kind: 'separator', id: 'after-move' },
    command('delete', t('panels:diagram.turns.delete', 'Delete Turn'), deps.remove, false),
  ];
}
