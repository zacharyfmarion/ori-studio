import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import type { TurnBetween, TurnKind } from '../../../lib/steps/turn';
import { turnCardWords, turnLabel, turnPlace } from '../../../lib/steps/turnWords';
import { StepCard, StepCardBadge, StepCardDeleteVerb, StepCardPlaceholder } from './StepCard';
import { TurnGlyph } from './TurnGlyph';
import styles from './TurnCard.module.css';

/**
 * A turn between two steps, in a Steps grid (D24): a card the size of a
 * step's, in its place in the order — its name where a step has its number,
 * a "No number" badge, its glyph — as a page prints it, or in the theme's ink
 * where nothing is printed — and how it turns and where it prints. The cards
 * around it keep their numbers. An option of the
 * grid's listbox as a step's card is, named by what it is and where; it opens
 * no detail. Its Delete is a pointer's shortcut, as a step's is.
 *
 * A turn a newer build wrote (`unknown`) is a stand-in: it shows no glyph,
 * says only that it is one, and can still be deleted.
 */
export const TurnCard = forwardRef<
  HTMLDivElement,
  {
    turn: TurnKind & { id: string; unknown?: unknown };
    /** The numbers of the steps either side; null at an end. */
    between: TurnBetween;
    /**
     * The glyph as an image's source, drawn as the surface's pages print it,
     * and shown on the paper they print on; null when there is none to draw.
     * Left out by a surface that prints no pages: the card draws the turn in
     * the theme's ink, on the well a step's crease pattern is shown on
     * (`TurnGlyph`).
     */
    glyph?: string | null;
    selected: boolean;
    tabStop: boolean;
    /** Its place among the grid's entries and how many there are (`StepCard`). */
    position?: number;
    total?: number;
    /** Something dragged over the grid would land here: after the turn. */
    dropTarget?: boolean;
    onSelect: (id: string) => void;
    /** Delete the turn, from its card's corner; absent where the sequence cannot change. */
    onDelete?: (id: string) => void;
    /**
     * What the corner's Delete says it takes. A Diagram turn is an entry of its
     * own and goes alone ("Delete Turn", the default); a surface whose turns
     * are steps the later steps fold from says what goes with it.
     */
    deleteLabel?: string;
  }
>(function TurnCard(
  { turn, between, glyph, selected, tabStop, position, total, dropTarget = false, onSelect, onDelete, deleteLabel },
  ref
) {
  const { t } = useTranslation();
  const locked = turn.unknown !== undefined;
  const printed = glyph !== undefined;
  const { title, how } = turnCardWords(turn, t);
  const where = turnPlace(between, t);
  return (
    <StepCard
      ref={ref}
      id={turn.id}
      label={turnLabel(turn, between, t)}
      selected={selected}
      tabStop={tabStop}
      position={position}
      total={total}
      dropTarget={dropTarget}
      attributes={{ 'data-turn-kind': locked ? 'locked' : turn.kind }}
      title={title}
      kind={<StepCardBadge>{t('panels:diagram.card.badgeNoNumber', 'No number')}</StepCardBadge>}
      paper={printed && !locked}
      verbs={
        onDelete && (
          <StepCardDeleteVerb
            label={deleteLabel ?? t('panels:diagram.turns.delete', 'Delete Turn')}
            onDelete={() => onDelete(turn.id)}
          />
        )
      }
      instruction={
        <>
          {how}
          {where && <span className={styles.where}>{where}</span>}
        </>
      }
      onSelect={onSelect}
    >
      {glyph ? (
        <img className={styles.turnGlyph} src={glyph} alt="" draggable={false} />
      ) : !printed && !locked ? (
        <TurnGlyph turn={turn} className={styles.turnGlyph} />
      ) : (
        <StepCardPlaceholder>
          <Lock size={18} aria-hidden="true" />
          {t('panels:diagram.card.lockedTurn', 'Made with a newer Ori Studio')}
        </StepCardPlaceholder>
      )}
    </StepCard>
  );
});
