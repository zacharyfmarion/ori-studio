import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
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
 */
export function DiagramStepsGrid({
  steps,
  selectedStepId,
  onSelect,
}: {
  steps: readonly DiagramStep[];
  selectedStepId: string | null;
  onSelect: (stepId: string | null) => void;
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
          number={index + 1}
          selected={step.id === selectedStepId}
          tabStop={step.id === tabStop}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
