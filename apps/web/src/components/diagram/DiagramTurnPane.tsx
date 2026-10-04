import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Trash2, type LucideIcon } from 'lucide-react';
import { turnLabels, turnName } from '../../diagram/actions/diagramTurnActions';
import type { DiagramStepAction } from '../../diagram/actions/diagramActions';
import { DEFAULT_ROTATION } from '../../diagram/annotate/annotationModel';
import { isLockedTurn, type DiagramTurn, type DiagramTurnKind } from '../../diagram/document/diagramDocument';
import { ActionList, type ActionListItem } from '../ui/ActionList';
import { SegmentedRow } from '../ui/fieldRows';
import styles from './DiagramTurnPane.module.css';

const VERB_ICONS: Readonly<Record<string, LucideIcon>> = {
  'move-earlier': ArrowUp,
  'move-later': ArrowDown,
  delete: Trash2,
};

/**
 * The Step pane for a turn between steps (D22): what it is and between which
 * steps, the controls that change how it turns — a turn-over's axis, a
 * rotation's amount and direction, or the one for the other — and its verbs.
 * The words are its menu's (`diagramTurnActions.ts`). A newer build's turn
 * says so, and offers only its moves and Delete.
 */
export function DiagramTurnPane({
  turn,
  between,
  actions,
  readOnly,
  onSet,
}: {
  turn: DiagramTurn;
  between: { before: number | null; after: number | null };
  /** Its verbs, as its menu has them: the moves and Delete are listed here. */
  actions: readonly DiagramStepAction[];
  readOnly: boolean;
  onSet: (kind: DiagramTurnKind) => void;
}) {
  const { t } = useTranslation();
  const where =
    between.before !== null && between.after !== null
      ? t('panels:diagram.turns.betweenSteps', 'Between steps {{before}} and {{after}}', between)
      : between.after !== null
        ? t('panels:diagram.turns.beforeStep', 'Before step {{after}}', between)
        : between.before !== null
          ? t('panels:diagram.turns.afterStep', 'After step {{before}}', between)
          : null;
  const verbs: ActionListItem[] = actions.flatMap((action) =>
    action.kind === 'command' && VERB_ICONS[action.id]
      ? [
          {
            id: action.id,
            label: action.label,
            icon: VERB_ICONS[action.id]!,
            disabled: action.disabled,
            hint: action.hint,
            ...(action.danger ? { tone: 'danger' as const } : {}),
            run: action.run,
          },
        ]
      : []
  );
  return (
    <div className={styles.pane}>
      <div className={styles.heading}>
        <h3 className={styles.title}>{turnName(turn, t)}</h3>
        {where && <p className={styles.where}>{where}</p>}
        <p className={styles.note}>
          {isLockedTurn(turn)
            ? t(
                'panels:diagram.turns.lockedNote',
                'Made with a newer Ori Studio: it can be moved or deleted here, is saved exactly as it came, and isn’t printed.'
              )
            : t('panels:diagram.turns.note', 'Printed between the steps, with no number of its own.')}
        </p>
      </div>
      {!isLockedTurn(turn) && <TurnControls turn={turn} readOnly={readOnly} onSet={onSet} />}
      <ActionList groups={[verbs]} aria-label={t('panels:diagram.turns.actions', 'Turn actions')} />
    </div>
  );
}

/** What a turn is and how it turns, as controls: a turn-over's axis, a rotation's amount and direction. */
function TurnControls({
  turn,
  readOnly,
  onSet,
}: {
  turn: DiagramTurn;
  readOnly: boolean;
  onSet: (kind: DiagramTurnKind) => void;
}) {
  const { t } = useTranslation();
  const labels = turnLabels(t);
  const rotation = turn.kind === 'rotate' ? turn.rotate : DEFAULT_ROTATION;
  const axis = turn.kind === 'turn-over' ? turn.axis : 'vertical';
  return (
    <>
      <SegmentedRow
        label={t('panels:diagram.turns.kind', 'Turn')}
        value={turn.kind}
        disabled={readOnly}
        options={[
          { id: 'turn-over', label: labels.kind['turn-over'] },
          { id: 'rotate', label: labels.kind.rotate },
        ]}
        onChange={(kind) =>
          onSet(kind === 'turn-over' ? { kind: 'turn-over', axis } : { kind: 'rotate', rotate: rotation })
        }
      />
      {turn.kind === 'turn-over' ? (
        <SegmentedRow
          label={t('panels:diagram.annotations.axis', 'Turns')}
          value={turn.axis}
          disabled={readOnly}
          options={[
            { id: 'vertical', label: labels.axis.vertical },
            { id: 'horizontal', label: labels.axis.horizontal },
          ]}
          onChange={(value) => onSet({ kind: 'turn-over', axis: value as 'vertical' | 'horizontal' })}
        />
      ) : (
        <>
          <SegmentedRow
            label={t('panels:diagram.turns.amount', 'Amount')}
            value={turn.rotate.amount}
            disabled={readOnly}
            options={[
              { id: 'eighth', label: '1/8' },
              { id: 'quarter', label: '1/4' },
              { id: 'half', label: '1/2' },
            ]}
            onChange={(amount) =>
              onSet({ kind: 'rotate', rotate: { ...turn.rotate, amount: amount as 'eighth' | 'quarter' | 'half' } })
            }
          />
          <SegmentedRow
            label={t('panels:diagram.annotations.direction', 'Direction')}
            value={turn.rotate.direction}
            disabled={readOnly}
            options={[
              { id: 'cw', label: labels.direction.cw },
              { id: 'ccw', label: labels.direction.ccw },
            ]}
            onChange={(direction) =>
              onSet({ kind: 'rotate', rotate: { ...turn.rotate, direction: direction as 'cw' | 'ccw' } })
            }
          />
        </>
      )}
    </>
  );
}
