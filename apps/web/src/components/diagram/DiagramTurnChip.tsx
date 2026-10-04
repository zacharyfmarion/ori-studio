import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { turnName } from '../../diagram/actions/diagramTurnActions';
import type { DiagramTurn } from '../../diagram/document/diagramDocument';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';
import styles from './DiagramTurnChip.module.css';

/**
 * A turn between two steps in the steps grid (D22): a round chip with the
 * glyph it prints, in the gap between the cards it turns the model between.
 * An option of the grid's listbox, as a card is: a press selects it, and the
 * grid's keys, menu and Delete act on it; it opens no detail. Its name says
 * what it is and where ("Turn over, side to side, between steps 3 and 4").
 *
 * The glyph shows how it turns: a turn-over about the horizontal axis lies on
 * its side, and an anticlockwise rotation is the clockwise one mirrored.
 */
export const DiagramTurnChip = forwardRef<
  HTMLDivElement,
  {
    turn: DiagramTurn;
    /** The numbers of the steps either side; null at an end. */
    between: { before: number | null; after: number | null };
    selected: boolean;
    tabStop: boolean;
    onSelect: (id: string) => void;
  }
>(function DiagramTurnChip({ turn, between, selected, tabStop, onSelect }, ref) {
  const { t } = useTranslation();
  const name = turnName(turn, t);
  const where =
    between.before !== null && between.after !== null
      ? t('panels:diagram.turns.between', 'between steps {{before}} and {{after}}', between)
      : between.after !== null
        ? t('panels:diagram.turns.beforeFirst', 'before step {{after}}', between)
        : between.before !== null
          ? t('panels:diagram.turns.afterLast', 'after step {{before}}', between)
          : '';
  const label = where ? t('panels:diagram.turns.chipLabel', '{{name}}, {{where}}', { name, where }) : name;
  const turned =
    turn.kind === 'turn-over' ? (turn.axis === 'horizontal' ? 'quarter' : undefined) : turn.rotate.direction === 'ccw' ? 'mirror' : undefined;
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={label}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      className={styles.chip}
      data-step-id={turn.id}
      data-turn-kind={turn.kind}
      data-selected={selected || undefined}
      onClick={() => onSelect(turn.id)}
    >
      <span className={styles.glyph} data-turned={turned}>
        <DiagramAnnotateToolGlyph tool={turn.kind} />
      </span>
    </div>
  );
});
