import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type {
  DiagramAsset,
  DiagramStep,
  DiagramStyle,
} from '../../diagram/document/diagramDocument';
import { GRID_DROP_TARGET } from '../../diagram/upload/useStepPictureDrop';
import { DIAGRAM_STEPS_ATTRIBUTE } from '../../diagram/actions/diagramShortcuts';
import type { DiagramCardLinks } from '../../diagram/capture/useCardLinks';
import { DiagramStepCard } from './DiagramStepCard';
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
 * After the last card, an empty card's outline adds a step at the end. A
 * listbox holds only its options, so the tile is for a pointer alone: hidden
 * from assistive tech and never focused, the header's Add step being the way
 * there from the keyboard. A press on it lands focus on the listbox, so the
 * new step's card takes it.
 */
export function DiagramStepsGrid({
  steps,
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
  onOpenIn,
  onAppend,
}: {
  steps: readonly DiagramStep[];
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
  /** Open a step in Pose or Annotate, from the buttons over its picture. */
  onOpenIn: (stepId: string, mode: 'pose' | 'annotate') => void;
  /** Add an empty step at the end, from the trailing tile; absent on a diagram that cannot change. */
  onAppend?: () => void;
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

  const tabStop = selectedStepId ?? steps[0]?.id ?? null;

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
      {steps.map((step, index) => (
        <DiagramStepCard
          key={step.id}
          ref={(element) => {
            if (element) cards.current.set(step.id, element);
            else cards.current.delete(step.id);
          }}
          step={step}
          assets={assets}
          style={style}
          number={index + 1}
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
          waiting={links.awaitingReferences === step.id}
          onFromReferences={links.askReferences}
          onCancelWaiting={links.cancelAwaiting}
          onOpenIn={onOpenIn}
        />
      ))}
      {onAppend && (
        <div aria-hidden className={styles.addTile} data-add-step-tile="" onClick={onAppend}>
          <Plus size={18} aria-hidden />
          {t('panels:diagram.grid.addStep', 'Add step')}
        </div>
      )}
    </div>
  );
}
