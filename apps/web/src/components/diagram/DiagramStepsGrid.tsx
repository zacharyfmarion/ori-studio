import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramAsset, DiagramStep } from '../../diagram/document/diagramDocument';
import { GRID_DROP_TARGET } from '../../diagram/upload/useStepPictureDrop';
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
  assets,
  selectedStepId,
  dropTarget,
  readOnly,
  onSelect,
  onOpen,
  onUpload,
}: {
  steps: readonly DiagramStep[];
  assets: Readonly<Record<string, DiagramAsset>>;
  selectedStepId: string | null;
  /** Where a picture being dragged in would land: a step's id, the grid, or nowhere. */
  dropTarget: string | null;
  readOnly: boolean;
  onSelect: (stepId: string | null) => void;
  /** Open a step in detail (a double-click on its card). */
  onOpen: (stepId: string) => void;
  /** Pick a picture for a step, from a click on its card. */
  onUpload: (stepId: string) => void;
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
          number={index + 1}
          selected={step.id === selectedStepId}
          tabStop={step.id === tabStop}
          dropTarget={step.id === dropTarget}
          readOnly={readOnly}
          onSelect={onSelect}
          onOpen={onOpen}
          onUpload={onUpload}
        />
      ))}
    </div>
  );
}
