import { memo, useCallback, useEffect, useMemo, useRef, type ComponentPropsWithoutRef } from 'react';
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
import type { StepPageFit } from '../../diagram/pages/pageOverflow';
import { enlargedChips } from '../../diagram/zoom/zoomActions';
import { DiagramStepCard, DiagramTurnCard } from './DiagramStepCard';
import styles from './DiagramStepsGrid.module.css';
import { useVirtualStepRows } from '../../diagram/useVirtualStepRows';

type CardMount = (id: string, element: HTMLDivElement | null) => void;

// Keep each card's ref stable across edits to other entries. Otherwise every
// picture edit changes all refs, defeats memoization and remounts dense SVGs.
const StepCard = memo(function StepCard({
  onElement,
  ...props
}: ComponentPropsWithoutRef<typeof DiagramStepCard> & { onElement: CardMount }) {
  const id = props.step.id;
  const ref = useCallback((element: HTMLDivElement | null) => onElement(id, element), [id, onElement]);
  return <DiagramStepCard {...props} ref={ref} />;
});
const TurnCard = memo(function TurnCard({
  onElement,
  ...props
}: ComponentPropsWithoutRef<typeof DiagramTurnCard> & { onElement: CardMount }) {
  const id = props.turn.id;
  const ref = useCallback((element: HTMLDivElement | null) => onElement(id, element), [id, onElement]);
  return <DiagramTurnCard {...props} ref={ref} />;
});

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
 * A turn between two steps (D22) is a card of its own in its place (D24),
 * selected, walked to with the arrows, moved, inserted before and deleted as a
 * step's is — but numbered none: the cards either side read 3 and 4.
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
  pageFits,
  patternOpen,
  onLink,
  onFromReferences,
  onOpenIn,
  onGoToEdit,
  onAppend,
  onInsertBefore,
  onMakeTurn,
  onDelete,
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
  /** What the pages say of each step's place, by its id: its instruction cut with "…". */
  pageFits: ReadonlyMap<string, StepPageFit>;
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
  /** Make an empty step a turn in its place (D24), from its card. */
  onMakeTurn: (stepId: string, kind: 'turn-over' | 'rotate') => void;
  /** Delete a step or a turn, from its card's Delete. */
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());

  const rowIds = useMemo(
    () => [...entries.map((entry) => `entry:${entry.id}`), ...(onAppend ? ['append'] : [])],
    [entries, onAppend]
  );
  const { columns, margin, virtualizer } = useVirtualStepRows(listRef, rowIds);
  const pendingFocus = useRef<string | null>(null);
  const selectedIndex = entries.findIndex((entry) => entry.id === selectedStepId);
  useEffect(() => {
    pendingFocus.current = null;
    if (selectedStepId === null) return;
    const card = cards.current.get(selectedStepId);
    if (!card) {
      const index = selectedIndex;
      if (index >= 0) {
        const active = document.activeElement;
        pendingFocus.current =
          active === document.body || listRef.current?.contains(active) ? selectedStepId : null;
        virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
      }
      return;
    }
    card.scrollIntoView?.({ block: 'nearest' });
    const active = document.activeElement;
    const nowhere = active === null || active === document.body;
    if ((nowhere || listRef.current?.contains(active)) && active !== card) {
      card.focus({ preventScroll: true });
    }
  }, [selectedStepId, selectedIndex, columns, virtualizer]);

  const tabStop = selectedStepId ?? entries[0]?.id ?? null;
  const slots = useMemo(() => slotsOf(entries), [entries]);
  // An enlarged step's chip names the step its area is on (Revision 2), and its well's whether it changed (review fix 4).
  const enlarged = useMemo(() => enlargedChips(entries), [entries]);
  const keep = useCallback<CardMount>((id, element) => {
    if (element) {
      cards.current.set(id, element);
      if (pendingFocus.current === id) {
        pendingFocus.current = null;
        const active = document.activeElement;
        if (active === document.body || listRef.current?.contains(active))
          element.focus({ preventScroll: true });
      }
    } else cards.current.delete(id);
  }, []);
  const rows = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('panels:diagram.grid.label', 'Steps')}
      tabIndex={rows.some((row) => row.index === Math.floor(Math.max(0, selectedIndex) / columns)) ? -1 : 0}
      className={styles.grid}
      {...{ [DIAGRAM_STEPS_ATTRIBUTE]: '' }}
      data-drop-target={dropTarget === GRID_DROP_TARGET || undefined}
      onClick={(event) => {
        // A press between or below the cards drops the selection, as a press on
        // empty canvas does elsewhere.
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      <div
        className={styles.canvas}
        style={{ height: virtualizer.getTotalSize() }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelect(null);
        }}
      >
        {rows.map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={styles.row}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              transform: `translateY(${row.start - margin}px)`,
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) onSelect(null);
            }}
          >
            {slots.slice(row.index * columns, (row.index + 1) * columns).map((slot, column) => (
              // A slot, so the gap before the card is placed against it.
              <div key={slot.entry.id} className={styles.slot}>
                {onInsertBefore && (
                  <div
                    aria-hidden
                    className={styles.insert}
                    data-insert-before={slot.entry.id}
                    title={t('panels:diagram.grid.insertHere', 'Add a step here')}
                    onClick={() => onInsertBefore(slot.entry.id)}
                  >
                    <span className={styles.insertButton}>
                      <Plus size={13} aria-hidden />
                    </span>
                  </div>
                )}
                {slot.kind === 'turn' ? (
                  <TurnCard
                    onElement={keep}
                    position={row.index * columns + column + 1}
                    total={entries.length}
                    turn={slot.entry}
                    between={slot.between}
                    style={style}
                    selected={slot.entry.id === selectedStepId}
                    tabStop={slot.entry.id === tabStop}
                    dropTarget={slot.entry.id === dropTarget}
                    readOnly={readOnly}
                    onSelect={onSelect}
                    onDelete={onDelete}
                  />
                ) : (
                  <StepCard
                    onElement={keep}
                    position={row.index * columns + column + 1}
                    total={entries.length}
                    step={slot.entry}
                    assets={assets}
                    style={style}
                    number={slot.number}
                    selected={slot.entry.id === selectedStepId}
                    tabStop={slot.entry.id === tabStop}
                    dropTarget={slot.entry.id === dropTarget}
                    readOnly={readOnly}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    onUpload={onUpload}
                    link={links.statuses.get(slot.entry.id) ?? null}
                    pageFit={pageFits.get(slot.entry.id) ?? null}
                    enlargedFrom={enlarged.get(slot.entry.id)?.from}
                    areaChanged={enlarged.get(slot.entry.id)?.changed === true}
                    capture={links.captures[slot.entry.id] ?? null}
                    patternOpen={patternOpen}
                    onLink={onLink}
                    onStop={links.stop}
                    onFromReferences={onFromReferences}
                    onOpenIn={onOpenIn}
                    onGoToEdit={onGoToEdit}
                    onMakeTurn={onMakeTurn}
                    onDelete={onDelete}
                  />
                )}
              </div>
            ))}
            {onAppend && row.index === Math.floor(slots.length / columns) && (
              // The place after the last card: the tile that adds a step there.
              <div className={styles.slot} data-trailing="">
                <div
                  aria-hidden
                  className={styles.addTile}
                  data-add-step-tile=""
                  // A double-click's second click, after a Delete moved this tile under the pointer, adds nothing.
                  onClick={(event) => {
                    if (event.detail <= 1) onAppend();
                  }}
                >
                  <Plus size={18} aria-hidden />
                  {t('panels:diagram.grid.addStep', 'Add step')}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Slot =
  | { kind: 'step'; entry: DiagramStep; number: number }
  /** A turn, and the numbers of the steps either side of it; null at an end. */
  | { kind: 'turn'; entry: DiagramTurn; between: { before: number | null; after: number | null } };

/** Each entry in order: a step with its number, a turn with the numbers either side of it (D22). */
function slotsOf(entries: readonly DiagramEntry[]): Slot[] {
  const total = entries.filter((entry) => !isTurn(entry)).length;
  let number = 0;
  return entries.map((entry): Slot => {
    if (isTurn(entry)) {
      return {
        kind: 'turn',
        entry,
        between: { before: number > 0 ? number : null, after: number < total ? number + 1 : null },
      };
    }
    number += 1;
    return { kind: 'step', entry, number };
  });
}
