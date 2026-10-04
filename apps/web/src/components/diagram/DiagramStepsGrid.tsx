import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import {
  isTurn,
  type DiagramAsset,
  type DiagramEntry,
  type DiagramStep,
  type DiagramStyle,
  type DiagramTurn,
} from '../../diagram/document/diagramDocument';
import { GRID_DROP_TARGET } from '../../diagram/upload/useStepPictureDrop';
import { DIAGRAM_STEPS_ATTRIBUTE } from '../../diagram/actions/diagramShortcuts';
import type { DiagramCardLinks } from '../../diagram/capture/useCardLinks';
import { DiagramStepCard } from './DiagramStepCard';
import { DiagramTurnChip } from './DiagramTurnChip';
import styles from './DiagramStepsGrid.module.css';

/**
 * Every step, in order, as a grid of cards that is one listbox.
 *
 * The selection is the store's (`diagramSelectedStepId`); this only shows it
 * and reports clicks. Focus follows it — a roving tab stop on the selected
 * card — while focus is in the grid or nowhere at all, so a selection made from
 * a control elsewhere (the Step pane, Add step) never pulls focus out of it,
 * but deleting the focused card hands focus on to the card that took its place
 * rather than dropping it on the page. It scrolls the selected card into view,
 * wherever the selection came from.
 *
 * The listbox itself takes focus (not Tab) from a press on the space between
 * cards, so a press there keeps focus in the grid and the next arrow's
 * selection carries it back onto a card.
 *
 * After the last card, an empty card's outline adds a step at the end, and
 * the gap before every card — the first card's too — adds one there: on a
 * hover, a line and a "+" between the two cards. A listbox holds only its
 * options, so both are for a pointer alone — hidden from assistive tech and
 * never focused, the header's Add step and the card menu's Insert Before /
 * After being the way there from the keyboard. A press on either lands focus
 * on the listbox, so the new step's card takes it.
 *
 * A turn between two steps (D22) is no card: a round chip in the gap before
 * the step it comes before, or after the last card. It is an option of the
 * list all the same — selected, walked to with the arrows, moved and deleted
 * as a card is — and its number is none: the cards either side read 3 and 4.
 */
export function DiagramStepsGrid({
  entries,
  assets,
  style,
  selectedStepId,
  dropTarget,
  readOnly,
  onSelect,
  onOpen,
  onUpload,
  links,
  textCut,
  patternOpen,
  onLink,
  onFromReferences,
  onOpenIn,
  onGoToEdit,
  onAppend,
  onInsertBefore,
}: {
  /** The diagram's order: its steps and the turns between them. */
  entries: readonly DiagramEntry[];
  assets: Readonly<Record<string, DiagramAsset>>;
  /** The pens a captured picture is painted in. */
  style: DiagramStyle;
  selectedStepId: string | null;
  /** Where a picture being dragged in would land: a step's id, the grid, or nowhere. */
  dropTarget: string | null;
  readOnly: boolean;
  onSelect: (stepId: string | null) => void;
  /** Open a step in detail (a double-click on its card). */
  onOpen: (stepId: string) => void;
  /** Pick a picture for a step, from a click on its card. */
  onUpload: (stepId: string) => void;
  /** Each card's link: how it stands, its capture, and a Stop. */
  links: DiagramCardLinks;
  /** The steps whose instruction the pages cut with "…". */
  textCut: ReadonlySet<string>;
  /** A crease pattern is open to link an empty step to. */
  patternOpen: boolean;
  /** Choose a pattern for a step, from a click on its card. */
  onLink: (stepId: string) => void;
  /** Fill an empty step from the References browser, from a click on its card. */
  onFromReferences: (stepId: string) => void;
  /** Open a step in Pose or Annotate, from the buttons over its picture. */
  onOpenIn: (stepId: string, mode: 'pose' | 'annotate') => void;
  /** Go to Edit, from an empty card when no crease pattern is open. */
  onGoToEdit: () => void;
  /** Add an empty step at the end, from the trailing tile; absent on a diagram that cannot change. */
  onAppend?: () => void;
  /** Add an empty step before one, from the gap before its card; absent on a diagram that cannot change. */
  onInsertBefore?: (stepId: string) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (selectedStepId === null) return;
    const card = cards.current.get(selectedStepId);
    if (!card) return;
    card.scrollIntoView?.({ block: 'nearest' });
    const active = document.activeElement;
    const nowhere = active === null || active === document.body;
    if ((nowhere || listRef.current?.contains(active)) && active !== card) {
      card.focus({ preventScroll: true });
    }
  }, [selectedStepId]);

  const tabStop = selectedStepId ?? entries[0]?.id ?? null;
  const { slots, trailing } = useMemo(() => slotsOf(entries), [entries]);
  /** A gap's turns, as chips; `between` the numbers of the steps either side. */
  const chips = (turns: readonly DiagramTurn[], place: string, between: { before: number | null; after: number | null }) =>
    turns.length > 0 && (
      <div className={styles.turns} data-turns={place}>
        {turns.map((turn) => (
          <DiagramTurnChip
            key={turn.id}
            ref={(element) => {
              if (element) cards.current.set(turn.id, element);
              else cards.current.delete(turn.id);
            }}
            turn={turn}
            between={between}
            selected={turn.id === selectedStepId}
            tabStop={turn.id === tabStop}
            onSelect={onSelect}
          />
        ))}
      </div>
    );

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('panels:diagram.grid.label', 'Steps')}
      tabIndex={-1}
      className={styles.grid}
      {...{ [DIAGRAM_STEPS_ATTRIBUTE]: '' }}
      data-drop-target={dropTarget === GRID_DROP_TARGET || undefined}
      onClick={(event) => {
        // A press between or below the cards drops the selection, as a press on
        // empty canvas does elsewhere.
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {slots.map(({ step, number, turnsBefore }) => (
        // A slot, so the gap before the card is placed against it.
        <div key={step.id} className={styles.slot}>
          {onInsertBefore && (
            <div
              aria-hidden
              className={styles.insert}
              data-insert-before={step.id}
              data-beside-turns={turnsBefore.length > 0 || undefined}
              title={t('panels:diagram.grid.insertHere', 'Add a step here')}
              onClick={() => onInsertBefore(step.id)}
            >
              <span className={styles.insertButton}>
                <Plus size={13} aria-hidden />
              </span>
            </div>
          )}
          {chips(turnsBefore, step.id, { before: number > 1 ? number - 1 : null, after: number })}
          <DiagramStepCard
            ref={(element) => {
              if (element) cards.current.set(step.id, element);
              else cards.current.delete(step.id);
            }}
            step={step}
            assets={assets}
            style={style}
            number={number}
            selected={step.id === selectedStepId}
            tabStop={step.id === tabStop}
            dropTarget={step.id === dropTarget}
            readOnly={readOnly}
            onSelect={onSelect}
            onOpen={onOpen}
            onUpload={onUpload}
            link={links.statuses.get(step.id) ?? null}
            textCut={textCut.has(step.id)}
            capture={links.captures[step.id] ?? null}
            patternOpen={patternOpen}
            onLink={onLink}
            onStop={links.stop}
            onFromReferences={onFromReferences}
            onOpenIn={onOpenIn}
            onGoToEdit={onGoToEdit}
          />
        </div>
      ))}
      {(onAppend || trailing.length > 0) && (
        // The place after the last card: the turns after it, and the tile that adds a step there.
        <div className={styles.slot} data-trailing="">
          {chips(trailing, 'end', { before: slots.length > 0 ? slots.length : null, after: null })}
          {onAppend && (
            <div aria-hidden className={styles.addTile} data-add-step-tile="" onClick={onAppend}>
              <Plus size={18} aria-hidden />
              {t('panels:diagram.grid.addStep', 'Add step')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Each step with its number and the turns before it, and the turns after the last (D22). */
function slotsOf(entries: readonly DiagramEntry[]): {
  slots: { step: DiagramStep; number: number; turnsBefore: DiagramTurn[] }[];
  trailing: DiagramTurn[];
} {
  const slots: { step: DiagramStep; number: number; turnsBefore: DiagramTurn[] }[] = [];
  let turns: DiagramTurn[] = [];
  for (const entry of entries) {
    if (isTurn(entry)) {
      turns.push(entry);
      continue;
    }
    slots.push({ step: entry, number: slots.length + 1, turnsBefore: turns });
    turns = [];
  }
  return { slots, trailing: turns };
}
