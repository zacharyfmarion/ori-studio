import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { StepsGrid, type StepsGridDropTarget } from '../ui/steps/StepsGrid';
import { DiagramStepCard, DiagramTurnCard } from './DiagramStepCard';

/**
 * The Diagram's steps, in order, on the shared Steps grid (`ui/steps/StepsGrid`):
 * one listbox of cards, the selection the store's (`diagramSelectedStepId`),
 * a turn between two steps (D22) a card of its own in its place (D24) — its
 * own entry, selected, walked to with the arrows, moved, inserted before and
 * deleted as a step's is, but numbered none.
 *
 * What the Diagram adds to the grid: each step's card (`DiagramStepCard`) and
 * turn's glyph, the steps grid's mark that the Diagram's Enter acts on, where
 * a picture dragged in would land, and — on a diagram that can change — the
 * gap before every card and the tile after the last that add an empty step.
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
  // An enlarged step's chip names the step its area is on (Revision 2), and its well's whether it changed (review fix 4).
  const enlarged = useMemo(() => enlargedChips(entries), [entries]);
  const drop: StepsGridDropTarget | null =
    dropTarget === null ? null : dropTarget === GRID_DROP_TARGET ? { kind: 'grid' } : { kind: 'card', id: dropTarget };

  return (
    <StepsGrid<DiagramStep, DiagramTurn>
      entries={entries}
      isTurn={isTurn}
      label={t('panels:diagram.grid.label', 'Steps')}
      selectedId={selectedStepId}
      onSelect={onSelect}
      attributes={{ [DIAGRAM_STEPS_ATTRIBUTE]: '' }}
      dropTarget={drop}
      insert={onInsertBefore && { label: t('panels:diagram.grid.insertHere', 'Add a step here'), onInsertBefore }}
      append={onAppend && { label: t('panels:diagram.grid.addStep', 'Add step'), onAppend }}
      renderCard={(slot, card) =>
        slot.kind === 'turn' ? (
          <DiagramTurnCard
            {...card}
            turn={slot.entry}
            between={slot.between}
            style={style}
            readOnly={readOnly}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ) : (
          <DiagramStepCard
            {...card}
            step={slot.entry}
            assets={assets}
            style={style}
            number={slot.number}
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
        )
      }
    />
  );
}
